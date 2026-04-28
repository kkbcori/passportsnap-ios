/**
 * PassportProcessor.swift
 * PassportSnap iOS Native Module
 *
 * Pipeline mirrors the working web + Android versions:
 *
 * prepare():
 *   1. Load + fix EXIF orientation
 *   2. Vision face detection → eye Y, face centre X
 *   3. VNGeneratePersonSegmentationRequest → white background
 *   4. Scan white-bg image for headTop (first non-white row, ≥10px wide)
 *      and chinBottom (last skin-tone row in central band)  — mirrors web detectSubjectInWhiteBg()
 *   5. headHeight = chinBottom - headTop  → scale to country spec
 *   6. Pad + compute auto-crop
 *   7. Resolve
 *
 * crop():   pad → crop → resize → brightness → watermark / clean
 * makeSheet4x6(): 2-up print sheet
 */

import Foundation
import UIKit
import Vision
import CoreImage
import CoreGraphics

@objc(PassportProcessor)
class PassportProcessor: NSObject {

    private let queue = DispatchQueue(label: "com.passportsnap.processor", qos: .userInitiated)
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private var pixelFormat: UIGraphicsImageRendererFormat {
        let f = UIGraphicsImageRendererFormat(); f.scale = 1.0; return f
    }
    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: ── Country Specs ───────────────────────────────────────────────────
    // Specs mirror Android PassportProcessorModule.kt exactly.
    // oval_fill:    head fills this fraction of oval height (same as Android)
    // topGap:       fraction of oval height for top gap — US only
    // headTopMm:    absolute mm from top of photo to crown — UK/AUS/CAN
    // hairMult:     hair above Vision forehead bbox (same as Android)

    struct Spec {
        let outW: Int; let outH: Int
        let photoHeightMm: Double
        let ovalOuterTop: Int      // px: where green line is in output image
        let ovalOuterBottom: Int   // px: bottom of oval
        let headMinPx: Int         // minimum head height in output
        let headMaxPx: Int         // maximum head height in output
        let ovalFill: Double       // head fills this % of oval height
        let topGap: Double         // % of oval height above head (US only)
        let headTopMm: Double?     // absolute mm from top edge (UK/AUS/CAN)
        let hairMult: Double
    }

    // Values copied directly from Android PassportProcessorModule.kt companion object:
    private static let US_SPEC  = Spec(outW:600,  outH:600,  photoHeightMm:51.0,
        ovalOuterTop:55,  ovalOuterBottom:467,  headMinPx:300, headMaxPx:412,
        ovalFill:0.8567, topGap:0.10, headTopMm:nil,  hairMult:1.12)
    private static let UK_SPEC  = Spec(outW:933,  outH:1200, photoHeightMm:45.0,
        ovalOuterTop:133, ovalOuterBottom:997,  headMinPx:820, headMaxPx:907,
        ovalFill:0.9595, topGap:0.0,  headTopMm:6.1,  hairMult:1.22)
    private static let AUS_SPEC = Spec(outW:933,  outH:1200, photoHeightMm:45.0,
        ovalOuterTop:133, ovalOuterBottom:997,  headMinPx:820, headMaxPx:907,
        ovalFill:0.9595, topGap:0.0,  headTopMm:6.1,  hairMult:1.22)
    private static let CAN_SPEC = Spec(outW:1200, outH:1680, photoHeightMm:70.0,
        ovalOuterTop:170, ovalOuterBottom:1116, headMinPx:614, headMaxPx:870,
        ovalFill:0.8550, topGap:0.06, headTopMm:12.9, hairMult:1.075)

    private func getSpec(_ country: String) -> Spec {
        switch country {
        case "GBR","SCH","DEU","ZAF": return PassportProcessor.UK_SPEC
        case "AUS":                   return PassportProcessor.AUS_SPEC
        case "CAN":                   return PassportProcessor.CAN_SPEC
        default:                      return PassportProcessor.US_SPEC
        }
    }

    // MARK: ── Image Utilities ─────────────────────────────────────────────────

    private func loadImage(from uri: String) -> UIImage? {
        var path = uri
        if path.hasPrefix("file://") { path = String(path.dropFirst(7)) }
        if let d = path.removingPercentEncoding { path = d }
        guard let img = UIImage(contentsOfFile: path) else { return nil }
        return fixOrientation(img)
    }

    private func fixOrientation(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let sz = CGSize(width: image.size.width * image.scale,
                        height: image.size.height * image.scale)
        return UIGraphicsImageRenderer(size: sz, format: pixelFormat)
            .image { _ in image.draw(in: CGRect(origin: .zero, size: sz)) }
    }

    private func downscale(_ image: UIImage, maxDim: CGFloat) -> (UIImage, CGFloat) {
        let w = image.size.width * image.scale
        let h = image.size.height * image.scale
        let longer = max(w, h)
        guard longer > maxDim else { return (image, 1.0) }
        let scale = maxDim / longer
        let sz = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        let out = UIGraphicsImageRenderer(size: sz, format: pixelFormat)
            .image { _ in image.draw(in: CGRect(origin: .zero, size: sz)) }
        return (out, scale)
    }

    private func extractPixels(_ cgImage: CGImage) -> [UInt8] {
        let w = cgImage.width; let h = cgImage.height
        var pixels = [UInt8](repeating: 255, count: w * h * 4)
        guard let ctx = CGContext(data: &pixels, width: w, height: h,
                                  bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return [] }
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
        return pixels
    }

    private func rebuildImage(pixels: [UInt8], width: Int, height: Int) -> UIImage? {
        var px = pixels
        guard let ctx = CGContext(data: &px, width: width, height: height,
                                  bitsPerComponent: 8, bytesPerRow: width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
              let cg = ctx.makeImage() else { return nil }
        return UIImage(cgImage: cg)
    }

    private func padImage(_ image: UIImage, padX: Int, padY: Int) -> (UIImage, Int, Int) {
        let ow = Int(image.size.width * image.scale)
        let oh = Int(image.size.height * image.scale)
        let nw = ow + 2 * padX; let nh = oh + 2 * padY
        let padded = UIGraphicsImageRenderer(size: CGSize(width: nw, height: nh), format: pixelFormat)
            .image { ctx in
                UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: nw, height: nh))
                image.draw(at: CGPoint(x: padX, y: padY))
            }
        return (padded, nw, nh)
    }

    private func cropImage(_ image: UIImage, to rect: CGRect) -> UIImage? {
        let s = image.scale
        let sr = CGRect(x: rect.minX * s, y: rect.minY * s,
                        width: rect.width * s, height: rect.height * s)
        guard let cg = image.cgImage, let c = cg.cropping(to: sr) else { return nil }
        return UIImage(cgImage: c)
    }

    private func resizeImage(_ image: UIImage, toPixelSize size: CGSize) -> UIImage? {
        return UIGraphicsImageRenderer(size: size, format: pixelFormat)
            .image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    // MARK: ── Face Detection (Vision) ────────────────────────────────────────
    // Only used for eye Y and face centre X.
    // Crown/chin positions come from pixel scanning after bg removal.

    struct FaceData {
        let eyeY: Int      // average Y of both eyes (for compliance reference)
        let faceCx: Int    // horizontal face centre
        let fy: Int        // Vision face box top (fallback crown estimate)
        let fh: Int        // Vision face box height
    }

    // Returns nil instead of throwing when no face found —
    // prepare() handles the no-face case with a graceful centre-crop fallback.
    private func detectFace(in image: UIImage) -> FaceData? {
        // Try cgImage directly first; if nil (HEIF/ProRAW), render via UIGraphicsImageRenderer
        let cgImage: CGImage
        if let cg = image.cgImage {
            cgImage = cg
        } else {
            // Force render to bitmap — handles HEIF, ProRAW, HDR formats from iPhone 17 Pro
            let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1.0
            let renderer = UIGraphicsImageRenderer(size: image.size, format: fmt)
            let rendered = renderer.image { _ in image.draw(at: .zero) }
            guard let cg = rendered.cgImage else { return nil }
            cgImage = cg
        }
        let w = cgImage.width; let h = cgImage.height
        var result: FaceData?
        let sem = DispatchSemaphore(value: 0)

        let req = VNDetectFaceLandmarksRequest { r, e in
            defer { sem.signal() }
            guard e == nil,
                  let observations = r.results as? [VNFaceObservation],
                  let obs = observations.max(by: {
                      $0.boundingBox.width * $0.boundingBox.height <
                      $1.boundingBox.width * $1.boundingBox.height
                  }) else { return }

            let bb = obs.boundingBox
            let wF = CGFloat(w); let hF = CGFloat(h)
            let fx = Int(bb.minX * wF)
            let fy = Int((1.0 - bb.maxY) * hF)
            let fw = Int(bb.width  * wF)
            let fh = Int(bb.height * hF)
            let fhF = CGFloat(fh)
            let cx = fx + fw / 2

            var eyeY = fy + Int(Double(fh) * 0.37) // fallback
            if let lm = obs.landmarks,
               let le = lm.leftEye,
               let re = lm.rightEye {
                let lePts = le.normalizedPoints
                let rePts = re.normalizedPoints
                if !lePts.isEmpty && !rePts.isEmpty {
                    let baseY = (1.0 - bb.maxY) * hF
                    var leSum: CGFloat = 0
                    for pt in lePts { leSum += baseY + (1.0 - pt.y) * fhF }
                    var reSum: CGFloat = 0
                    for pt in rePts { reSum += baseY + (1.0 - pt.y) * fhF }
                    let leAvg = leSum / CGFloat(lePts.count)
                    let reAvg = reSum / CGFloat(rePts.count)
                    eyeY = Int((leAvg + reAvg) / 2.0)
                }
            }

            result = FaceData(eyeY: eyeY, faceCx: cx, fy: fy, fh: fh)
        }

        try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([req])
        sem.wait()
        return result
    }

    // MARK: ── Background Removal ─────────────────────────────────────────────

    private func whitenBackground(image: UIImage, faceCx: Int) -> UIImage {
        if #available(iOS 15.0, *) {
            return segmentationRemoval(image: image)
        }
        return toneCurveFallback(image: image)
    }

    // MARK: ── ML Segmentation (iOS 15+) ──────────────────────────────────────
    // Complete rewrite using CIImage pipeline — avoids all manual pixel/mask issues.
    // 
    // Key decisions:
    // 1. Feed CIImage(image:) to Vision — CIImage respects UIImage.imageOrientation
    //    automatically, so no manual orientation handling needed at all.
    // 2. Use CIFilter("CIBlendWithMask") for compositing — Apple's own API, correct
    //    coordinate space, no manual upsampling or pixel loops.
    // 3. The mask pixel buffer is converted to CIImage directly — Core Image
    //    handles all the scaling/coordinate mapping internally.

    @available(iOS 15.0, *)
    private func segmentationRemoval(image: UIImage) -> UIImage {
        // Pure CIImage pipeline — eliminates BFS [Float]/[Bool] arrays
        // that caused ~3GB peak memory → Jetsam per-process-limit OOM kill.
        let inputCI = CIImage(image: image) ?? CIImage(cgImage: image.cgImage!)
        var maskBuffer: CVPixelBuffer?
        let sem = DispatchSemaphore(value: 0)
        let request = VNGeneratePersonSegmentationRequest { req, _ in
            defer { sem.signal() }
            guard let obs = req.results?.first as? VNPixelBufferObservation else { return }
            maskBuffer = obs.pixelBuffer
        }
        request.qualityLevel = .accurate
        try? VNImageRequestHandler(ciImage: inputCI, options: [:]).perform([request])
        sem.wait()
        guard let buf = maskBuffer else { return toneCurveFallback(image: image) }
        var maskCI = CIImage(cvPixelBuffer: buf)
        let sX = inputCI.extent.width  / maskCI.extent.width
        let sY = inputCI.extent.height / maskCI.extent.height
        maskCI = maskCI.transformed(by: CGAffineTransform(scaleX: sX, y: sY))
        let white = CIImage(color: CIColor.white).cropped(to: inputCI.extent)
        guard let blend = CIFilter(name: "CIBlendWithMask") else {
            return toneCurveFallback(image: image)
        }
        blend.setValue(inputCI, forKey: "inputImage")
        blend.setValue(white,   forKey: "inputBackgroundImage")
        blend.setValue(maskCI,  forKey: "inputMaskImage")
        guard let outCI = blend.outputImage,
              let cg    = ciContext.createCGImage(outCI, from: outCI.extent) else {
            return toneCurveFallback(image: image)
        }
        return UIImage(cgImage: cg)
    }
    // MARK: ── Tone Curve Fallback (iOS 14) ───────────────────────────────────

    private func toneCurveFallback(image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        var ci = CIImage(cgImage: cgImage)
        if let f = CIFilter(name: "CIToneCurve") {
            f.setValue(ci, forKey: kCIInputImageKey)
            f.setValue(CIVector(x: 0.00, y: 0.00), forKey: "inputPoint0")
            f.setValue(CIVector(x: 0.50, y: 0.50), forKey: "inputPoint1")
            f.setValue(CIVector(x: 0.75, y: 0.82), forKey: "inputPoint2")
            f.setValue(CIVector(x: 0.88, y: 0.97), forKey: "inputPoint3")
            f.setValue(CIVector(x: 1.00, y: 1.00), forKey: "inputPoint4")
            if let out = f.outputImage { ci = out }
        }
        guard let cg = ciContext.createCGImage(ci, from: ci.extent) else { return image }
        return UIImage(cgImage: cg)
    }

    // MARK: ── Gaussian Blur (for mask softening) ──────────────────────────────

    private func gaussianBlurMask(_ mask: [Float], w: Int, h: Int, radius: Int) -> [Float] {
        guard radius > 0 else { return mask }
        let ksz = radius * 2 + 1
        var kernel = [Float](repeating: 0, count: ksz)
        let sigma = Float(radius) / 2.0
        var ksum: Float = 0
        for i in 0..<ksz {
            let x = Float(i - radius)
            kernel[i] = exp(-x*x / (2*sigma*sigma))
            ksum += kernel[i]
        }
        for i in 0..<ksz { kernel[i] /= ksum }
        var temp = [Float](repeating: 0, count: w*h)
        for y in 0..<h { for x in 0..<w {
            var v: Float = 0
            for k in 0..<ksz {
                let sx = min(max(x+k-radius, 0), w-1)
                v += mask[y*w+sx] * kernel[k]
            }
            temp[y*w+x] = v
        }}
        var result = [Float](repeating: 0, count: w*h)
        for y in 0..<h { for x in 0..<w {
            var v: Float = 0
            for k in 0..<ksz {
                let sy = min(max(y+k-radius, 0), h-1)
                v += temp[sy*w+x] * kernel[k]
            }
            result[y*w+x] = min(max(v, 0), 1)
        }}
        return result
    }

    // MARK: ── Scan White-BG Image for Head Position ───────────────────────────
    // Mirrors web detectSubjectInWhiteBg() exactly.
    // After background removal we have pure white bg + person pixels.
    // headTop  = first row in centre 60% with ≥10 non-white pixels
    // chinBottom = last skin-tone row in central band

    struct HeadBounds {
        let headTop: Int
        let chinBottom: Int
        let faceCx: Int
        var headHeight: Int { chinBottom - headTop }
    }

    private func scanHeadBounds(in image: UIImage, faceCx: Int) -> HeadBounds? {
        guard let cgImage = image.cgImage else { return nil }
        let w = cgImage.width; let h = cgImage.height
        let pixels = extractPixels(cgImage)
        let STEP = 2

        let isNonWhite = { (i: Int) -> Bool in
            return pixels[i] < 245 || pixels[i+1] < 245 || pixels[i+2] < 245
        }

        // Skin tone in YCbCr — matches web version exactly, including dark skin
        let isSkin = { (i: Int) -> Bool in
            let r=Float(pixels[i]), g=Float(pixels[i+1]), b=Float(pixels[i+2])
            let Y  =  0.299*r + 0.587*g + 0.114*b
            let Cb = -0.169*r - 0.331*g + 0.500*b + 128
            let Cr =  0.500*r - 0.419*g - 0.081*b + 128
            return Y > 30 && Y < 242 && Cb > 60 && Cb < 140 && Cr > 128 && Cr < 190
        }

        // Step 1: headTop — find the very topmost pixel of the head.
        // Handles: dark hair, bald/light scalp, headscarves, turbans, hijabs, caps.
        //
        // KEY INSIGHT: After ML segmentation + CIBlendWithMask the person boundary
        // has a soft alpha blend. Pixels 1-4 rows ABOVE the actual head top are
        // blended with white, producing near-white grey (dist-from-white ≈ 15-30).
        // We must NOT trigger on these — they are NOT the head.
        //
        // We use distance-from-white as the metric (not luma):
        //   dist = sqrt((255-R)² + (255-G)² + (255-B)²)
        //   dist > 40, ≥3 px per row → "strong" head pixel (dark hair, coloured scarf, skin)
        //   dist > 20, ≥5 px per row → "weak" head pixel (light bald scalp, off-white scarf)
        //   dist ≤ 20 → soft ML edge or background — IGNORE
        //
        // After finding the first qualifying row, walk back UP to catch sparse
        // wisps (fine hair, flyaways) that are 1-2 rows above the solid band.
        let htL = w * 10 / 100; let htR = w * 90 / 100
        var headTop = -1

        for y in stride(from: 0, to: h, by: STEP) {
            var strong = 0; var weak = 0
            for x in stride(from: htL, to: htR, by: STEP) {
                let i = (y*w+x)*4
                let dr = Int(255) - Int(pixels[i])
                let dg = Int(255) - Int(pixels[i+1])
                let db = Int(255) - Int(pixels[i+2])
                let dist2 = dr*dr + dg*dg + db*db   // squared — avoid sqrt in inner loop
                if dist2 > 1600 { strong += 1 }      // dist > 40  (40² = 1600)
                else if dist2 > 400 { weak += 1 }    // dist > 20  (20² = 400)
            }
            if strong >= 3 || weak >= 5 { headTop = y; break }
        }
        guard headTop != -1 else { return nil }

        // Walk back up from headTop to catch sparse wisps above the solid band
        for y in stride(from: headTop - STEP, through: 0, by: -STEP) {
            var weak = 0
            for x in stride(from: htL, to: htR, by: STEP) {
                let i = (y*w+x)*4
                let dr = Int(255)-Int(pixels[i]); let dg = Int(255)-Int(pixels[i+1])
                let db = Int(255)-Int(pixels[i+2])
                if dr*dr + dg*dg + db*db > 400 { weak += 1 }
            }
            if weak >= 2 { headTop = y } // sparse wisp — extend up
            else { break }               // gap → stop
        }

        // Step 2: face centre X via skin centroid in top 45%
        let scanBot = min(h * 45 / 100, h)
        var sumX=0, sumY=0, skinCount=0
        for y in stride(from: headTop, to: scanBot, by: STEP) {
            for x in stride(from: 0, to: w, by: STEP) {
                if isSkin((y*w+x)*4) { sumX += x; sumY += y; skinCount += 1 }
            }
        }
        guard skinCount >= 20 else { return nil }
        let estCX = sumX / skinCount

        // Step 3: chinBottom via central band skin scan
        // Require 5 consecutive empty rows (STEP-scaled) to confirm chin
        let bandHalf = w * 12 / 100
        let colL = max(0, estCX - bandHalf); let colR = min(w, estCX + bandHalf)
        let chinLimit = min(headTop + h * 50 / 100, h)
        let faceCY_est = sumY / skinCount
        let CHIN_GAP_REQ = 5 * STEP

        var chinBottom = headTop + h * 20 / 100
        var emptyStreak = 0

        for y in stride(from: headTop, to: chinLimit, by: STEP) {
            var rowHasSkin = false
            for x in stride(from: colL, to: colR, by: STEP) {
                if isSkin((y*w+x)*4) { rowHasSkin = true; break }
            }
            if rowHasSkin {
                chinBottom = y; emptyStreak = 0
            } else if y > faceCY_est {
                emptyStreak += STEP
                if emptyStreak >= CHIN_GAP_REQ { break }
            }
        }

        let useCX = faceCx > 0 ? faceCx : estCX
        return HeadBounds(headTop: headTop, chinBottom: chinBottom, faceCx: useCX)
    }

    // MARK: ── Watermark + Brightness ─────────────────────────────────────────

    private func addWatermark(_ image: UIImage) -> UIImage {
        let w = image.size.width * image.scale
        let h = image.size.height * image.scale
        return UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: pixelFormat)
            .image { ctx in
                image.draw(at: .zero)
                let fs = max(28, w/5) * 0.70
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.boldSystemFont(ofSize: fs),
                    .foregroundColor: UIColor(white: 0.55, alpha: 0.35),
                ]
                let text = "PassportSnap" as NSString
                let ts = text.size(withAttributes: attrs)
                let cg = ctx.cgContext
                cg.saveGState()
                cg.translateBy(x: w/2, y: h/2); cg.rotate(by: -30 * .pi / 180)
                text.draw(at: CGPoint(x: -ts.width/2, y: -ts.height/2), withAttributes: attrs)
                cg.restoreGState()
            }
    }

    /// En1: subtle 1–2% saturation/vibrance boost to make face colours more vivid.
    /// Uses CIVibrance — boosts less-saturated colours more than already-vivid ones,
    /// so skin tones pop without over-saturating the background or clothing.
    private func applyVibrance(_ image: UIImage, amount: Float) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let ci = CIImage(cgImage: cgImage)
        guard let f = CIFilter(name: "CIVibrance") else { return image }
        f.setValue(ci,     forKey: kCIInputImageKey)
        f.setValue(amount, forKey: "inputAmount")   // 0.015 = 1.5% boost
        guard let out = f.outputImage,
              let cg  = ciContext.createCGImage(out, from: out.extent) else { return image }
        return UIImage(cgImage: cg)
    }

    private func applyBrightness(_ image: UIImage, amount: Int) -> UIImage {
        guard let cg = image.cgImage else { return image }
        var px = extractPixels(cg)
        let shift = Int(Float(amount) * 1.6)
        for i in stride(from: 0, to: px.count, by: 4) {
            let r=Int(px[i]),g=Int(px[i+1]),b=Int(px[i+2])
            if r>248 && g>248 && b>248 { continue }
            px[i]   = UInt8((r+shift).clamped(to: 0...255))
            px[i+1] = UInt8((g+shift).clamped(to: 0...255))
            px[i+2] = UInt8((b+shift).clamped(to: 0...255))
        }
        return rebuildImage(pixels: px, width: cg.width, height: cg.height) ?? image
    }

    // MARK: ── 4×6 Sheet ───────────────────────────────────────────────────────

    private func build4x6Sheet(photo: UIImage, country: String) -> UIImage? {
        let sW: CGFloat=1200, sH: CGFloat=1800, border: CGFloat=2
        let (pw,ph): (CGFloat,CGFloat)
        switch country {
        case "GBR","SCH","DEU","ZAF","AUS": (pw,ph)=(413,531)
        case "CAN":                         (pw,ph)=(591,827)
        default:                            (pw,ph)=(600,600)
        }
        let sheetImg = UIGraphicsImageRenderer(size: CGSize(width: sW, height: sH), format: pixelFormat)
            .image { ctx in
                UIColor.white.setFill(); ctx.fill(CGRect(x:0,y:0,width:sW,height:sH))
                let slotW=pw+2*border, slotH=ph+2*border
                let startX=(sW-slotW)/2, gap: CGFloat=40
                let startY=(sH-(2*slotH+gap))/2
                UIColor.black.setStroke()
                for i in 0...1 {
                    let sy=startY+CGFloat(i)*(slotH+gap)
                    photo.draw(in: CGRect(x:startX+border, y:sy+border, width:pw, height:ph))
                    UIBezierPath(rect: CGRect(x:startX, y:sy, width:slotW, height:slotH)).stroke()
                }
            }
        return sheetImg
    }

    // MARK: ── prepare() ───────────────────────────────────────────────────────

    @objc func prepare(_ photoUri: String,
                       country: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        queue.async {
            do {
                // 1. Load
                guard var bmp = self.loadImage(from: photoUri) else {
                    throw NSError(domain:"PP", code:10, userInfo:[NSLocalizedDescriptionKey:"Cannot load image"])
                }

                // 2. Downscale to ≤1200px for face detection
                let (procBmp, procScale) = self.downscale(bmp, maxDim: 1200)

                // 3. Vision face detect → eye Y + face centre X
                // detectFace returns nil if no face found (instead of throwing).
                // nil face → origFh=0 → scanHeadBounds fallback path used downstream.
                // Also retry on full-size image if downscaled detection fails —
                // helpful for very tight crops where the face occupies the full frame.
                var faceOpt = self.detectFace(in: procBmp)
                if faceOpt == nil {
                    // Retry on original (not downscaled) — catches edge cases on Pro Max
                    faceOpt = self.detectFace(in: bmp)
                }
                let inv = CGFloat(1.0 / Double(procScale))
                let origFaceCx = faceOpt.map { Int(CGFloat($0.faceCx) * inv) } ?? Int(bmp.size.width / 2)
                let origEyeY   = faceOpt.map { Int(CGFloat($0.eyeY)   * inv) } ?? Int(bmp.size.height / 3)
                let origFy     = faceOpt.map { Int(CGFloat($0.fy)      * inv) } ?? 0
                let origFh     = faceOpt.map { Int(CGFloat($0.fh)      * inv) } ?? 0

                // 4. Downscale to ≤2000px for processing
                let (procBmp2, procScale2) = self.downscale(bmp, maxDim: 1200)
                let ps2 = Double(procScale2)
                if procScale2 < 1.0 { bmp = procBmp2 }
                let scaledCx = Int(Double(origFaceCx) * ps2)

                // 5. Background removal
                bmp = self.whitenBackground(image: bmp, faceCx: scaledCx)

                let spec = self.getSpec(country)

                // 6. Pad with white
                // padX = max(bmpW/2, outW) ensures the crop window always fits
                // regardless of how zoomed out the user goes in AdjustScreen.
                // JPEG quality is lowered to 0.70 to keep bridge payload ~5-8MB.
                let bmpW = Int(bmp.size.width * bmp.scale)
                let bmpH = Int(bmp.size.height * bmp.scale)
                let padX = max(bmpW / 2, spec.outW)
                let padY = max(bmpH / 2, spec.outH)
                let (padded, paddedW, paddedH) = self.padImage(bmp, padX: padX, padY: padY)

                // 7. Auto-crop — PRIMARY: Vision face box + hairMult
                // This is reliable across all face types: beards, dark skin,
                // curly/sparse hair, bald. scanHeadBounds pixel-scan is the FALLBACK
                // only when Vision detects no face (origFh == 0).
                //
                // scanHeadBounds was demoted because it misdetects:
                //   - Beards: dark beard pixels detected as headTop instead of hair
                //   - Sparse/curly hair: top rows don't hit the pixel threshold
                //   - Any non-white pixel near top triggers false headTop
                var cropX=0, cropY=0, cropW=0, cropH=0


                if origFh > 0 {
                    // PRIMARY: Vision face detection succeeded
                    // Mirrors Android exactly: oval_fill × ovalH → targetHeadPx,
                    // head_top_mm or topGap for vertical positioning,
                    // 70/30 face-centre blend for horizontal stability.
                    let fhS          = Int(Double(origFh) * procScale2)
                    let headWithHair = Int(Double(fhS) * spec.hairMult)
                    let hairTopY     = Int(Double(origFy) * procScale2) - Int(Double(fhS) * (spec.hairMult - 1.0))
                    let hairTopYP    = hairTopY + padY
                    let faceCxP      = scaledCx + padX

                    // Head size: oval_fill × ovalH, clamped (same as Android)
                    let ovalH        = spec.ovalOuterBottom - spec.ovalOuterTop
                    let targetHeadPx = min(Double(spec.headMaxPx),
                                          max(Double(spec.headMinPx),
                                              Double(ovalH) * spec.ovalFill))
                    let scale        = targetHeadPx / Double(headWithHair)

                    // Vertical positioning (same as Android)
                    let targetHairTopInOutput: Int
                    if let headTopMm = spec.headTopMm {
                        // UK/AUS/CAN: absolute mm from top edge
                        let pxPerMm = Double(spec.outH) / spec.photoHeightMm
                        targetHairTopInOutput = Int(headTopMm * pxPerMm)
                    } else {
                        // US/IND: ovalOuterTop + topGap fraction of oval
                        targetHairTopInOutput = spec.ovalOuterTop + Int(Double(ovalH) * spec.topGap)
                    }

                    let topS = Int(Double(hairTopYP) * scale) - targetHairTopInOutput

                    // Horizontal: 70% face centre + 30% image centre (same as Android)
                    let imgCxP    = Double(paddedW) / 2.0
                    let blendedCx = Double(faceCxP) * 0.7 + imgCxP * 0.3
                    let leftS     = Int(blendedCx * scale) - spec.outW / 2

                    cropX = Int((Double(leftS) / scale).rounded())
                    cropY = Int((Double(topS)  / scale).rounded())
                    cropW = Int((Double(spec.outW) / scale).rounded())
                    cropH = Int((Double(cropW) * Double(spec.outH) / Double(spec.outW)).rounded())

                } else {
                    // FALLBACK: Vision found no face — use pixel scan on white-bg image
                    let headBounds = self.scanHeadBounds(in: bmp, faceCx: scaledCx)
                    if let hb = headBounds, hb.headHeight > 20 {
                        let ovalH2    = spec.ovalOuterBottom - spec.ovalOuterTop
                    let targetHead2 = min(Double(spec.headMaxPx),
                                         max(Double(spec.headMinPx),
                                             Double(ovalH2) * spec.ovalFill))
                    let scale     = targetHead2 / Double(hb.headHeight)
                        let headTopP  = hb.headTop + padY
                        let faceCxP   = hb.faceCx  + padX
                        let topS      = Int(Double(headTopP) * scale) - spec.ovalOuterTop
                        let leftS     = Int(Double(faceCxP)  * scale) - spec.outW / 2
                        cropX = Int((Double(leftS) / scale).rounded())
                        cropY = Int((Double(topS)  / scale).rounded())
                        cropW = Int((Double(spec.outW) / scale).rounded())
                        cropH = Int((Double(cropW) * Double(spec.outH) / Double(spec.outW)).rounded())
                    } else {
                        // Last resort: centre crop
                        let padded_w = paddedW; let padded_h = paddedH
                        cropW = min(padded_w, padded_h)
                        cropH = Int((Double(cropW) * Double(spec.outH) / Double(spec.outW)).rounded())
                        cropX = (padded_w - cropW) / 2 - padX
                        cropY = (padded_h - cropH) / 2 - padY
                    }
                }

                // 9. Save + resolve
                // Lower quality for padded preview — only used as crop source, not final output.
                // 0.70 reduces bridge payload from ~30MB to ~8MB, preventing OOM crashes.
                guard let jpegData = padded.jpegData(compressionQuality: 0.70) else {
                    throw NSError(domain:"PP", code:11, userInfo:[NSLocalizedDescriptionKey:"JPEG encode failed"])
                }
                let tmp = NSTemporaryDirectory() + "prepared_\(Int(Date().timeIntervalSince1970)).jpg"
                try jpegData.write(to: URL(fileURLWithPath: tmp))

                resolve([
                    "preparedUri": "file://\(tmp)",
                    "imageBase64": jpegData.base64EncodedString(),
                    "widthPx":     paddedW,
                    "heightPx":    paddedH,
                    "autoCrop": ["x": cropX, "y": cropY, "w": cropW, "h": cropH],
                ])
            } catch {
                reject("PROCESS_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: ── crop() ─────────────────────────────────────────────────────────

    @objc func crop(_ imageBase64: String,
                    cropX: NSInteger, cropY: NSInteger,
                    cropW: NSInteger, cropH: NSInteger,
                    outW: NSInteger, outH: NSInteger,
                    country: String,
                    brightness: NSInteger,
                    resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
        queue.async {
            do {
                guard let data = Data(base64Encoded: imageBase64),
                      let src = UIImage(data: data) else {
                    throw NSError(domain:"PP", code:20, userInfo:[NSLocalizedDescriptionKey:"Decode failed"])
                }

                // src is pre-padded by prepare() — do NOT pad again
                let pw = Int(src.size.width)
                let ph = Int(src.size.height)
                let cx = min(max(cropX, 0), pw-1)
                let cy = min(max(cropY, 0), ph-1)
                // Derive ch from cw using the EXACT output aspect ratio.
                // Independent min() clamping of cw and ch can produce different ratios
                // → the final resize to outW×outH would then stretch the image.
                let cwRaw = min(cropW, pw-cx)
                // Always derive height from width to guarantee aspect ratio
                let cw = cwRaw
                let ch: Int
                if outW > 0 {
                    // Use exact ratio: ch = cw * outH / outW
                    let chFromRatio = Int((Double(cw) * Double(outH) / Double(outW)).rounded())
                    ch = min(chFromRatio, ph-cy)
                } else {
                    ch = min(cropH, ph-cy)
                }
                guard cw > 0 && ch > 0 else {
                    throw NSError(domain:"PP", code:21, userInfo:[NSLocalizedDescriptionKey:"Invalid crop"])
                }

                guard var cropped = self.cropImage(src, to: CGRect(x:cx,y:cy,width:cw,height:ch)),
                      let resized = self.resizeImage(cropped, toPixelSize: CGSize(width:outW,height:outH))
                else {
                    throw NSError(domain:"PP", code:22, userInfo:[NSLocalizedDescriptionKey:"Crop failed"])
                }
                cropped = resized
                if brightness != 0 { cropped = self.applyBrightness(cropped, amount: brightness) }
                cropped = self.applyVibrance(cropped, amount: 0.015) // En1: 1.5% vivid boost

                guard let cleanData = cropped.jpegData(compressionQuality: 0.92) else {
                    throw NSError(domain:"PP", code:23, userInfo:[NSLocalizedDescriptionKey:"Clean encode failed"])
                }
                let wmData = self.addWatermark(cropped).jpegData(compressionQuality: 0.92) ?? cleanData

                resolve([
                    "imageBase64":        wmData.base64EncodedString(),
                    "cleanBase64":        cleanData.base64EncodedString(),
                    "previewImageBase64": wmData.base64EncodedString(),
                    "widthPx":            outW,
                    "heightPx":           outH,
                ])
            } catch {
                reject("CROP_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: ── makeSheet4x6() ─────────────────────────────────────────────────

    @objc func makeSheet4x6(_ imageBase64: String,
                             country: String,
                             resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock) {
        queue.async {
            guard let data  = Data(base64Encoded: imageBase64),
                  let photo = UIImage(data: data),
                  let sheet = self.build4x6Sheet(photo: photo, country: country),
                  let sd    = sheet.jpegData(compressionQuality: 0.92) else {
                reject("SHEET_ERROR", "Sheet render failed", nil); return
            }
            resolve(["imageBase64": sd.base64EncodedString(), "widthPx": 1200, "heightPx": 1800])
        }
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
