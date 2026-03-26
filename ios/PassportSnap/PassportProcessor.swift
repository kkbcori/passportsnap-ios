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
    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: ── Country Specs ───────────────────────────────────────────────────
    // All values derived from the spreadsheet supplied by the developer.
    // ovalOuterTop  = gapMm × pxPerMm  (top gap from spec)
    // ovalOuterBottom = ovalOuterTop + faceMm × pxPerMm
    // topGap = 0  →  headTop lands exactly at ovalOuterTop (the green line)

    struct Spec {
        let outW: Int; let outH: Int
        let photoHeightMm: Double  // physical height of photo in mm
        let faceMm: Double         // crown-to-chin in mm (from spreadsheet "In-App face" column)
        let gapMm: Double          // gap from top of photo to crown (from spreadsheet)
        // Derived pixel values (computed at init)
        let ovalOuterTop: Int      // = gapMm × pxPerMm — where green line sits
        let ovalOuterBottom: Int   // = ovalOuterTop + faceMm × pxPerMm
        let hairMult: Double       // used as fallback if pixel scan fails
    }

    // pxPerMm = outH / photoHeightMm
    // US/IND: 600/51.0=11.765 px/mm  → gap=8.2mm→96px,  face=32.5mm→382px, bottom=478
    // UK/etc: 1200/45.0=26.667 px/mm → gap=5.0mm→133px, face=32.1mm→856px, bottom=989
    // CAN:    1680/70.0=24.000 px/mm → gap=10.0mm→240px, face=34.3mm→823px, bottom=1063
    private static let US_SPEC  = Spec(outW:600,  outH:600,  photoHeightMm:51.0, faceMm:32.5, gapMm:8.2,  ovalOuterTop:96,  ovalOuterBottom:478,  hairMult:1.12)
    private static let UK_SPEC  = Spec(outW:900,  outH:1200, photoHeightMm:45.0, faceMm:32.1, gapMm:5.0,  ovalOuterTop:133, ovalOuterBottom:989,  hairMult:1.22)
    private static let AUS_SPEC = Spec(outW:900,  outH:1200, photoHeightMm:45.0, faceMm:32.1, gapMm:5.0,  ovalOuterTop:133, ovalOuterBottom:989,  hairMult:1.22)
    private static let CAN_SPEC = Spec(outW:1200, outH:1680, photoHeightMm:70.0, faceMm:34.3, gapMm:10.0, ovalOuterTop:240, ovalOuterBottom:1063, hairMult:1.075)

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
        UIGraphicsBeginImageContextWithOptions(sz, false, 1.0)
        image.draw(in: CGRect(origin: .zero, size: sz))
        let fixed = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()
        return fixed
    }

    private func downscale(_ image: UIImage, maxDim: CGFloat) -> (UIImage, CGFloat) {
        let w = image.size.width * image.scale
        let h = image.size.height * image.scale
        let longer = max(w, h)
        guard longer > maxDim else { return (image, 1.0) }
        let scale = maxDim / longer
        let sz = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        UIGraphicsBeginImageContextWithOptions(sz, false, 1.0)
        image.draw(in: CGRect(origin: .zero, size: sz))
        let out = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()
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
        UIGraphicsBeginImageContextWithOptions(CGSize(width: nw, height: nh), true, 1.0)
        UIColor.white.setFill()
        UIRectFill(CGRect(x: 0, y: 0, width: nw, height: nh))
        image.draw(at: CGPoint(x: padX, y: padY))
        let padded = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()
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
        UIGraphicsBeginImageContextWithOptions(size, true, 1.0)
        image.draw(in: CGRect(origin: .zero, size: size))
        let r = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return r
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

    private func detectFace(in image: UIImage) throws -> FaceData {
        guard let cgImage = image.cgImage else {
            throw NSError(domain: "PP", code: 1, userInfo: [NSLocalizedDescriptionKey: "No CGImage"])
        }
        let w = cgImage.width; let h = cgImage.height
        var result: FaceData?
        var err: Error?
        let sem = DispatchSemaphore(value: 0)

        let req = VNDetectFaceLandmarksRequest { r, e in
            defer { sem.signal() }
            if let e = e { err = e; return }
            guard let observations = r.results as? [VNFaceObservation],
                  let obs = observations.max(by: {
                      $0.boundingBox.width * $0.boundingBox.height <
                      $1.boundingBox.width * $1.boundingBox.height
                  }) else {
                err = NSError(domain: "PP", code: 2, userInfo: [NSLocalizedDescriptionKey: "No face"])
                return
            }

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

        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([req])
        sem.wait()
        if let e = err { throw e }
        guard let r = result else {
            throw NSError(domain: "PP", code: 3, userInfo: [NSLocalizedDescriptionKey: "Face detection returned no result"])
        }
        return r
    }

    // MARK: ── Background Removal ─────────────────────────────────────────────
    // Uses VNGeneratePersonSegmentationRequest (Apple Neural Engine) on iOS 15+.
    // The ML model classifies every pixel as person vs background — it correctly
    // handles white shirts on white walls, shadows, coloured clothing, all cases.
    // Fallback for iOS 14: CIToneCurve highlight-lift (good for near-white bg only).

    private func whitenBackground(image: UIImage, faceCx: Int) -> UIImage {
        if #available(iOS 15.0, *) {
            return segmentationRemoval(image: image)
        }
        return toneCurveFallback(image: image)
    }

    // MARK: ── ML Segmentation (iOS 15+) ──────────────────────────────────────

    @available(iOS 15.0, *)
    private func segmentationRemoval(image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let w = cgImage.width; let h = cgImage.height

        // ── 1. Run VNGeneratePersonSegmentationRequest ────────────────────────
        var maskPixels: [Float]?
        var maskW = 0; var maskH = 0
        let sem = DispatchSemaphore(value: 0)

        let request = VNGeneratePersonSegmentationRequest { req, _ in
            defer { sem.signal() }
            guard let obs = req.results?.first as? VNPixelBufferObservation else { return }
            let buf = obs.pixelBuffer
            CVPixelBufferLockBaseAddress(buf, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
            maskW = CVPixelBufferGetWidth(buf)
            maskH = CVPixelBufferGetHeight(buf)
            guard let base = CVPixelBufferGetBaseAddress(buf) else { return }
            let ptr      = base.assumingMemoryBound(to: Float32.self)
            let bpr      = CVPixelBufferGetBytesPerRow(buf)
            let fpr      = bpr / MemoryLayout<Float32>.size
            var flat     = [Float](repeating: 0, count: maskW * maskH)
            for row in 0..<maskH {
                for col in 0..<maskW {
                    flat[row * maskW + col] = ptr[row * fpr + col]
                }
            }
            maskPixels = flat
        }
        request.qualityLevel = .accurate
        try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        sem.wait()

        guard let rawMask = maskPixels, maskW > 0, maskH > 0 else {
            return toneCurveFallback(image: image)  // ML failed — use fallback
        }

        // ── 2. Upsample mask to image size (bilinear) ────────────────────────
        var mask = [Float](repeating: 0, count: w * h)
        let scaleX = Double(maskW) / Double(w)
        let scaleY = Double(maskH) / Double(h)
        for py in 0..<h {
            let my = Double(py) * scaleY
            let my0 = max(0, Int(my)); let my1 = min(maskH-1, my0+1)
            let fy = Float(my - Double(my0))
            for px in 0..<w {
                let mx = Double(px) * scaleX
                let mx0 = max(0, Int(mx)); let mx1 = min(maskW-1, mx0+1)
                let fx = Float(mx - Double(mx0))
                let v  = rawMask[my0*maskW+mx0] * (1-fx) * (1-fy)
                       + rawMask[my0*maskW+mx1] *    fx  * (1-fy)
                       + rawMask[my1*maskW+mx0] * (1-fx) *    fy
                       + rawMask[my1*maskW+mx1] *    fx  *    fy
                mask[py*w+px] = v
            }
        }

        // ── 3. Soft edge: small Gaussian blur on mask boundary ───────────────
        // Blur radius = 0.5% of shorter side → smooth hair/skin edges
        let blurR = max(3, min(w, h) / 200)
        let softMask = gaussianBlurMask(mask, w: w, h: h, radius: blurR)

        // ── 4. Composite person onto white ───────────────────────────────────
        // mask=1 → person (keep), mask=0 → background (white)
        // Simple alpha blend: result = person * mask + white * (1 - mask)
        var pixels = extractPixels(cgImage)
        for i in 0..<(w * h) {
            let alpha = softMask[i]          // 1.0 = fully person, 0.0 = fully background
            guard alpha < 0.999 else { continue }  // fully person — skip
            let pi = i * 4
            if alpha <= 0.001 {              // fully background — pure white
                pixels[pi]=255; pixels[pi+1]=255; pixels[pi+2]=255
            } else {                         // soft edge — blend
                let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
                pixels[pi]   = UInt8((r * alpha + 255 * (1-alpha)).clamped(to: 0...255))
                pixels[pi+1] = UInt8((g * alpha + 255 * (1-alpha)).clamped(to: 0...255))
                pixels[pi+2] = UInt8((b * alpha + 255 * (1-alpha)).clamped(to: 0...255))
            }
        }
        return rebuildImage(pixels: pixels, width: w, height: h) ?? image
    }

    // MARK: ── Tone Curve Fallback (iOS 14) ───────────────────────────────────
    // Lifts near-white background highlights to white.
    // Only effective for light-coloured backgrounds (cream, grey, off-white).

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

        // Step 1: headTop — first SOLID non-white row in centre 60%
        // Threshold 230 (not 245): cream/beige residuals after bg removal are
        // typically R=235-244 — they pass 245 but fail 230. Real hair is R<200.
        // Require ≥25 pixels per row (not 10): bg residuals are sparse (1-5px),
        // hair is a solid band (50+ px). This prevents false early detection.
        // Skip top 6%: background borders are never completely clean after removal.
        let htL = w * 20 / 100; let htR = w * 80 / 100
        let scanStartY = h * 6 / 100
        var headTop = -1
        for y in stride(from: scanStartY, to: h, by: STEP) {
            var count = 0
            for x in stride(from: htL, to: htR, by: STEP) {
                let i = (y*w+x)*4
                // Stricter: pixel must be noticeably non-white (luma < 230)
                let lum = Int(pixels[i])*299 + Int(pixels[i+1])*587 + Int(pixels[i+2])*114
                if lum < 230000 { count += 1; if count >= 25 { headTop = y; break } }
            }
            if headTop != -1 { break }
        }
        guard headTop != -1 else { return nil }

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
        UIGraphicsBeginImageContextWithOptions(CGSize(width:w, height:h), false, 1.0)
        defer { UIGraphicsEndImageContext() }
        image.draw(at: .zero)
        guard let ctx = UIGraphicsGetCurrentContext() else {
            return UIGraphicsGetImageFromCurrentImageContext() ?? image
        }
        let fs = max(28, w/5) * 0.70
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: fs),
            .foregroundColor: UIColor(white: 0.55, alpha: 0.35),
        ]
        let text = "PassportSnap" as NSString
        let ts = text.size(withAttributes: attrs)
        ctx.saveGState()
        ctx.translateBy(x: w/2, y: h/2); ctx.rotate(by: -30 * .pi / 180)
        text.draw(at: CGPoint(x: -ts.width/2, y: -ts.height/2), withAttributes: attrs)
        ctx.restoreGState()
        return UIGraphicsGetImageFromCurrentImageContext() ?? image
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
        UIGraphicsBeginImageContextWithOptions(CGSize(width:sW, height:sH), true, 1.0)
        defer { UIGraphicsEndImageContext() }
        UIColor.white.setFill(); UIRectFill(CGRect(x:0,y:0,width:sW,height:sH))
        let slotW=pw+2*border, slotH=ph+2*border
        let startX=(sW-slotW)/2, gap: CGFloat=40
        let startY=(sH-(2*slotH+gap))/2
        UIColor.black.setStroke()
        for i in 0...1 {
            let sy=startY+CGFloat(i)*(slotH+gap)
            photo.draw(in: CGRect(x:startX+border, y:sy+border, width:pw, height:ph))
            UIBezierPath(rect: CGRect(x:startX, y:sy, width:slotW, height:slotH)).stroke()
        }
        return UIGraphicsGetImageFromCurrentImageContext()
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
                let face = try self.detectFace(in: procBmp)
                let inv = CGFloat(1.0 / Double(procScale))
                let origFaceCx = Int(CGFloat(face.faceCx) * inv)
                let origEyeY   = Int(CGFloat(face.eyeY)   * inv)
                let origFy     = Int(CGFloat(face.fy)      * inv)
                let origFh     = Int(CGFloat(face.fh)      * inv)

                // 4. Downscale to ≤2000px for processing
                let (procBmp2, procScale2) = self.downscale(bmp, maxDim: 2000)
                let ps2 = Double(procScale2)
                if procScale2 < 1.0 { bmp = procBmp2 }
                let scaledCx = Int(Double(origFaceCx) * ps2)

                // 5. Background removal
                bmp = self.whitenBackground(image: bmp, faceCx: scaledCx)

                // 6. Scan white-bg result for head bounds
                //    This mirrors web detectSubjectInWhiteBg():
                //    headTop  = first non-white row (exact crown)
                //    chinBottom = last skin row in central band
                let headBounds = self.scanHeadBounds(in: bmp, faceCx: scaledCx)

                let spec = self.getSpec(country)

                // 7. Pad with white
                let bmpW = Int(bmp.size.width * bmp.scale)
                let bmpH = Int(bmp.size.height * bmp.scale)
                let padX = max(bmpW / 2, spec.outW)
                let padY = max(bmpH / 2, spec.outH)
                let (padded, paddedW, paddedH) = self.padImage(bmp, padX: padX, padY: padY)

                // 8. Auto-crop using head bounds
                var cropX=0, cropY=0, cropW=0, cropH=0

                if let hb = headBounds, hb.headHeight > 20 {
                    // We have precise crown (headTop) and chin (chinBottom) from pixel scan.
                    // Scale so headHeight maps to the country's faceMm specification.
                    // Then place headTop at ovalOuterTop (the green line).
                    let pxPerMm = Double(spec.outH) / spec.photoHeightMm
                    let targetFacePx = spec.faceMm * pxPerMm          // e.g. US: 30.4mm × 11.76 = 358px
                    let scale = targetFacePx / Double(hb.headHeight)   // how much to zoom

                    // In padded coordinates
                    let headTopP   = hb.headTop + padY
                    let faceCxP    = hb.faceCx  + padX

                    // Crown lands at ovalOuterTop (the green line)
                    let topS  = Int(Double(headTopP) * scale) - spec.ovalOuterTop
                    let leftS = Int(Double(faceCxP)  * scale) - spec.outW / 2

                    cropX = Int((Double(leftS) / scale).rounded())
                    cropY = Int((Double(topS)  / scale).rounded())
                    cropW = Int((Double(spec.outW) / scale).rounded())
                    // Derive cropH from cropW using exact spec aspect ratio
                    // to prevent independent rounding causing stretched output
                    cropH = Int((Double(cropW) * Double(spec.outH) / Double(spec.outW)).rounded())

                } else {
                    // Fallback: use Vision face box + hairMult (same as Android)
                    let hairMult = spec.hairMult
                    let fhS  = Int(Double(origFh) * procScale2)
                    let headWithHair = Int(Double(fhS) * hairMult)
                    let hairTopY = Int(Double(origFy) * procScale2) - Int(Double(fhS) * (hairMult - 1.0))
                    let hairTopYP = hairTopY + padY
                    let faceCxP   = scaledCx + padX

                    let ovalH = spec.ovalOuterBottom - spec.ovalOuterTop
                    let pxPerMm = Double(spec.outH) / spec.photoHeightMm
                    let targetFacePx = spec.faceMm * pxPerMm
                    let scale = targetFacePx / Double(headWithHair)

                    let topS  = Int(Double(hairTopYP) * scale) - spec.ovalOuterTop
                    let leftS = Int(Double(faceCxP)   * scale) - spec.outW / 2

                    cropX = Int((Double(leftS) / scale).rounded())
                    cropY = Int((Double(topS)  / scale).rounded())
                    cropW = Int((Double(spec.outW) / scale).rounded())
                    // Derive cropH from cropW using exact spec aspect ratio
                    // to prevent independent rounding causing stretched output
                    cropH = Int((Double(cropW) * Double(spec.outH) / Double(spec.outW)).rounded())
                }

                // 9. Save + resolve
                guard let jpegData = padded.jpegData(compressionQuality: 0.92) else {
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

                let pad = max(outW, max(outH, max(abs(cropX), abs(cropY))))
                let (padded, pw, ph) = self.padImage(src, padX: pad, padY: pad)

                let cx = min(max(cropX+pad, 0), pw-1)
                let cy = min(max(cropY+pad, 0), ph-1)
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

                guard var cropped = self.cropImage(padded, to: CGRect(x:cx,y:cy,width:cw,height:ch)),
                      let resized = self.resizeImage(cropped, toPixelSize: CGSize(width:outW,height:outH))
                else {
                    throw NSError(domain:"PP", code:22, userInfo:[NSLocalizedDescriptionKey:"Crop failed"])
                }
                cropped = resized
                if brightness != 0 { cropped = self.applyBrightness(cropped, amount: brightness) }

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
