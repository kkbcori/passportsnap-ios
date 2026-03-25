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
    // Uses flood-fill from image borders — same as web fallback, works for all
    // background colours without relying on ML mask quality.

    private func whitenBackground(image: UIImage, faceCx: Int) -> UIImage {
        return floodFillBackgroundRemoval(image: image)
    }

    /// Flood-fill background removal — mirrors web removeBackgroundFallback().
    /// 1. Sample background colour from image corners
    /// 2. BFS flood-fill from all 4 image borders through pixels similar to bg colour
    /// 3. Gaussian-soften the mask edge for smooth hair/skin transitions
    /// 4. Composite result onto pure white
    private func floodFillBackgroundRemoval(image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let w = cgImage.width; let h = cgImage.height
        var pixels = extractPixels(cgImage)
        guard !pixels.isEmpty else { return image }

        // ── 1. Smart background colour sampling ──────────────────────────────
        // Corners are WRONG when dark hair or clothing fills them (very common).
        // Instead: sample top 12% strip + left/right 10% strips (top 60% only).
        // Then filter to keep only BRIGHT (lum>150) AND ACHROMATIC (sat<0.15) pixels
        // — walls/backgrounds are always bright and low-saturation vs hair/clothing.
        var candidates: [(Float,Float,Float)] = []
        let topRows = max(1, h / 8)
        let sideW   = max(1, w / 10)

        // Top strip — full width
        for y in 0..<topRows {
            for x in stride(from: 0, to: w, by: max(1, w/40)) {
                let i = (y*w+x)*4
                candidates.append((Float(pixels[i]), Float(pixels[i+1]), Float(pixels[i+2])))
            }
        }
        // Left + right strips — top 60% of image
        for y in stride(from: 0, to: h*6/10, by: max(1, h/40)) {
            for x in 0..<sideW {
                let i = (y*w+x)*4
                candidates.append((Float(pixels[i]), Float(pixels[i+1]), Float(pixels[i+2])))
            }
            for x in (w-sideW)..<w {
                let i = (y*w+x)*4
                candidates.append((Float(pixels[i]), Float(pixels[i+1]), Float(pixels[i+2])))
            }
        }

        // Filter: keep bright + achromatic candidates (background wall pixels)
        var bgCands = candidates.filter { r, g, b in
            let lum = 0.299*r + 0.587*g + 0.114*b
            let maxC = max(r, max(g, b)); let minC = min(r, min(g, b))
            let sat = maxC > 0 ? (maxC - minC) / maxC : 0
            return lum > 150 && sat < 0.18
        }
        if bgCands.count < 10 { bgCands = candidates } // fallback: use all samples
        let bgR = bgCands.map{$0.0}.reduce(0,+) / Float(bgCands.count)
        let bgG = bgCands.map{$0.1}.reduce(0,+) / Float(bgCands.count)
        let bgB = bgCands.map{$0.2}.reduce(0,+) / Float(bgCands.count)

        // ── 2. Per-pixel distance to background ───────────────────────────────
        var dist = [Float](repeating: 0, count: w * h)
        for i in 0..<(w*h) {
            let pi = i*4
            let dr = Float(pixels[pi]) - bgR
            let dg = Float(pixels[pi+1]) - bgG
            let db = Float(pixels[pi+2]) - bgB
            dist[i] = sqrt(dr*dr + dg*dg + db*db)
        }

        // ── 3. Adaptive tolerance ─────────────────────────────────────────────
        var borderDists = [Float]()
        for x in 0..<w { borderDists.append(dist[x]); borderDists.append(dist[(h-1)*w+x]) }
        for y in 1..<(h-1) { borderDists.append(dist[y*w]); borderDists.append(dist[y*w+w-1]) }
        borderDists.sort()
        let medianBorder = borderDists[borderDists.count / 2]
        let TOL: Float  = max(25.0, min(65.0, medianBorder * 2.5 + 20.0))
        let TOL2: Float = TOL * 1.35  // second pass — catches enclosed shoulder pockets

        var bgMask = [Bool](repeating: false, count: w * h)
        var queue = [Int](); queue.reserveCapacity(w * 2 + h * 2)

        // ── 4a. Pass 1: BFS from all 4 borders (tight TOL) ───────────────────
        // Also expand pass1 into achromatic pixels slightly outside TOL
        // This handles cream bg pixels that sit at dist=TOL+5 due to
        // lighting variation (corners vs centre of wall).
        let TOL_ACHROMATIC: Float = TOL * 1.15  // 15% looser but ONLY for achromatic pixels

        func enqueueOrAchromatic(_ idx: Int) {
            guard idx >= 0, idx < bgMask.count, !bgMask[idx] else { return }
            let d = dist[idx]
            if d < TOL {
                bgMask[idx] = true; queue.append(idx); return
            }
            // Achromatic bonus: slightly brighter tolerance for low-saturation pixels
            if d < TOL_ACHROMATIC {
                let pi = idx * 4
                let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
                let maxC = max(r, max(g, b)); let minC = min(r, min(g, b))
                let sat = maxC > 0 ? (maxC - minC) / maxC : 0
                if sat < 0.12 { bgMask[idx] = true; queue.append(idx) }
            }
        }

        for x in 0..<w { enqueueOrAchromatic(x); enqueueOrAchromatic((h-1)*w+x) }
        for y in 1..<(h-1) { enqueueOrAchromatic(y*w); enqueueOrAchromatic(y*w+w-1) }
        var qi = 0
        while qi < queue.count {
            let idx = queue[qi]; qi += 1
            let x = idx % w; let y = idx / w
            if x > 0   { enqueueOrAchromatic(idx-1) }
            if x < w-1 { enqueueOrAchromatic(idx+1) }
            if y > 0   { enqueueOrAchromatic(idx-w) }
            if y < h-1 { enqueueOrAchromatic(idx+w) }
        }

        // ── 4b. Pass 2: Expand from fill boundary, achromatic pixels only ────
        // Catches shoulder background pockets enclosed by dark jacket at border.
        // CRITICAL: only expand into LOW-SATURATION pixels (sat < 0.20).
        // Pink shirts (sat~0.39) and blue shirts (sat~0.51) are rejected.
        // Background walls (sat~0.04–0.11) are accepted.
        func saturation(_ idx: Int) -> Float {
            let pi = idx * 4
            let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
            let maxC = max(r, max(g, b)); let minC = min(r, min(g, b))
            return maxC > 0 ? (maxC - minC) / maxC : 0
        }

        func enqueueAchromatic(_ idx: Int, tol: Float) {
            guard idx >= 0, idx < bgMask.count, !bgMask[idx],
                  dist[idx] < tol, saturation(idx) < 0.20 else { return }
            bgMask[idx] = true; queue.append(idx)
        }

        queue.removeAll(keepingCapacity: true)
        for idx in 0..<(w*h) {
            guard bgMask[idx] else { continue }
            let x = idx % w; let y = idx / w
            for n in [x>0 ? idx-1:-1, x<w-1 ? idx+1:-1, y>0 ? idx-w:-1, y<h-1 ? idx+w:-1] {
                enqueueAchromatic(n, tol: TOL2)
            }
        }
        qi = 0
        while qi < queue.count {
            let idx = queue[qi]; qi += 1
            let x = idx % w; let y = idx / w
            if x > 0   { enqueueAchromatic(idx-1, tol: TOL2) }
            if x < w-1 { enqueueAchromatic(idx+1, tol: TOL2) }
            if y > 0   { enqueueAchromatic(idx-w, tol: TOL2) }
            if y < h-1 { enqueueAchromatic(idx+w, tol: TOL2) }
        }

        // ── 4. Gaussian-soften the mask edge for smooth transitions ───────────
        var floatMask = [Float](repeating: 0, count: w*h)
        for i in 0..<(w*h) { floatMask[i] = bgMask[i] ? 1.0 : 0.0 }
        let blurR = max(3, min(w, h) / 200)
        let softMask = gaussianBlurMask(floatMask, w: w, h: h, radius: blurR)

        // ── 5. Apply: blend bg pixels toward white ────────────────────────────
        for i in 0..<(w*h) {
            let alpha = softMask[i]  // 0 = person (keep), 1 = background (whiten)
            guard alpha > 0.02 else { continue }
            let pi = i * 4
            let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
            if alpha >= 0.98 {
                pixels[pi]=255; pixels[pi+1]=255; pixels[pi+2]=255
            } else {
                pixels[pi]   = UInt8((r*(1-alpha) + 255*alpha).clamped(to: 0...255))
                pixels[pi+1] = UInt8((g*(1-alpha) + 255*alpha).clamped(to: 0...255))
                pixels[pi+2] = UInt8((b*(1-alpha) + 255*alpha).clamped(to: 0...255))
            }
        }

        return rebuildImage(pixels: pixels, width: w, height: h) ?? image
    }

    private func pixelLevelFallback(image: UIImage) -> UIImage {
        guard let cg = image.cgImage else { return image }
        var px = extractPixels(cg)
        let w = cg.width; let h = cg.height
        // Sample bg colour from corners + top strip
        var rS=0, gS=0, bS=0, n=0
        let sz = max(8, min(w,h)/12)
        for y in 0..<sz { for x in 0..<sz {
            for (cx,cy) in [(x,y),(w-1-x,y),(x,h-1-y),(w-1-x,h-1-y)] {
                let i=(cy*w+cx)*4; rS+=Int(px[i]); gS+=Int(px[i+1]); bS+=Int(px[i+2]); n+=1
            }
        }}
        let bgR=Float(rS/max(n,1)), bgG=Float(gS/max(n,1)), bgB=Float(bS/max(n,1))
        for i in stride(from:0, to:px.count-3, by:4) {
            let r=Float(px[i]),g=Float(px[i+1]),b=Float(px[i+2])
            let dist = sqrt(pow(r-bgR,2)+pow(g-bgG,2)+pow(b-bgB,2))
            if dist < 35 {
                // Skip skin-toned pixels — never whiten face even in fallback
                let Y  =  0.299*r + 0.587*g + 0.114*b
                let Cb = -0.169*r - 0.331*g + 0.500*b + 128
                let Cr =  0.500*r - 0.419*g - 0.081*b + 128
                if !(Y > 30 && Y < 242 && Cb > 60 && Cb < 140 && Cr > 128 && Cr < 190) {
                    px[i]=255; px[i+1]=255; px[i+2]=255
                }
            }
        }
        return rebuildImage(pixels: px, width: w, height: h) ?? image
    }

    private func gaussianBlurMask(_ mask: [Float], w: Int, h: Int, radius: Int) -> [Float] {
        guard radius > 0 else { return mask }
        let ksz = radius*2+1; let sigma = Float(radius)/2.5
        var kernel = [Float](repeating: 0, count: ksz); var ksum: Float = 0
        for i in 0..<ksz { let x=Float(i-radius); kernel[i]=exp(-x*x/(2*sigma*sigma)); ksum+=kernel[i] }
        for i in 0..<ksz { kernel[i] /= ksum }
        var temp = [Float](repeating: 0, count: w*h)
        for y in 0..<h { for x in 0..<w {
            var v: Float = 0
            for k in 0..<ksz { let sx=min(max(x+k-radius,0),w-1); v+=mask[y*w+sx]*kernel[k] }
            temp[y*w+x]=v
        }}
        var result = [Float](repeating: 0, count: w*h)
        for y in 0..<h { for x in 0..<w {
            var v: Float = 0
            for k in 0..<ksz { let sy=min(max(y+k-radius,0),h-1); v+=temp[sy*w+x]*kernel[k] }
            result[y*w+x]=min(max(v,0),1)
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
                    cropH = Int((Double(spec.outH) / scale).rounded())

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
                    cropH = Int((Double(spec.outH) / scale).rounded())
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
                let cw = min(cropW, pw-cx)
                let ch = min(cropH, ph-cy)
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
