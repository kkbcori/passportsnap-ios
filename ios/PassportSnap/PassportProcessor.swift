/**
 * PassportProcessor.swift  — v2.0
 * PassportSnap iOS Native Module
 *
 * Full port of PassportProcessorModule.kt — matches Android behaviour exactly:
 *
 * Pipeline (prepare):
 *   1. Load UIImage, apply EXIF orientation
 *   2. Downscale to ≤1200px for face detection (speed)
 *   3. Vision face detection with landmarks → eye Y, crown, chin
 *   4. Crown refinement by scanning upward for bright background pixels
 *   5. Scale face coords back to original resolution
 *   6. Downscale to ≤2000px for enhancement
 *   7. enhancePhoto — gamma correction + histogram stretch + unsharp mask
 *   8. whitenBackground — VNGeneratePersonSegmentationRequest (iOS 15+)
 *                         or CIToneCurve fallback (iOS 13/14)
 *   9. forceHeadroomWhite — flood-fill the top border area to white
 *  10. Pad image with white (prevents out-of-bounds crop)
 *  11. Compute auto-crop rectangle per country spec
 *  12. Resolve with { preparedUri, imageBase64, widthPx, heightPx, autoCrop }
 *
 * crop(base64, x,y,w,h, outW,outH, country, brightness):
 *   Pad → crop → resize → brightness → watermark preview + clean version
 *
 * makeSheet4x6(base64, country):
 *   2-up print sheet 1200×1800 px
 */

import Foundation
import UIKit
import Vision
import CoreImage
import CoreGraphics
import Accelerate

@objc(PassportProcessor)
class PassportProcessor: NSObject {

    private let queue = DispatchQueue(label: "com.passportsnap.processor", qos: .userInitiated)
    private lazy var ciContext = CIContext(options: [.useSoftwareRenderer: false])

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    // MARK: ── Country Specs ────────────────────────────────────────────────

    struct Spec {
        let outW: Int; let outH: Int; let dpi: Int
        let photoHeightMm: Double
        let faceFrac: Double; let crownTopFrac: Double
        let targetEyeY: Int
        let ovalOuterTop: Int; let ovalOuterBottom: Int
        let ovalInnerTop: Int; let ovalInnerBottom: Int
        let headMinPx: Int; let headMaxPx: Int
        let ovalFill: Double; let topGap: Double
        let headTopMm: Double?   // nil = use topGap
        let hairMult: Double
    }

    // Specs derived directly from spreadsheet (Countries_Measurements.xlsx):
    // ovalOuterTop  = gapMm * pxPerMm  (gap from top of photo to top of hair)
    // ovalOuterBottom = ovalOuterTop + faceMm * pxPerMm  (face height = crown to chin)
    // topGap = 0  →  targetHairTopInOutput = ovalOuterTop  (crown anchors to green line)
    // ovalFill = 1.0  →  targetHeadPx = ovalH = facePx  (exact face height match)
    private static let US_SPEC = Spec(
        outW: 600, outH: 600, dpi: 300,
        photoHeightMm: 51.0,
        faceFrac: 0.597, crownTopFrac: 0.160,
        targetEyeY: 262,
        ovalOuterTop: 96,  ovalOuterBottom: 454,   // gap=8.2mm, face=30.4mm
        ovalInnerTop: 125, ovalInnerBottom: 436,
        headMinPx: 329, headMaxPx: 387,
        ovalFill: 1.0, topGap: 0.0,
        headTopMm: nil, hairMult: 1.20
    )
    private static let UK_SPEC = Spec(
        outW: 900, outH: 1200, dpi: 600,
        photoHeightMm: 45.0,
        faceFrac: 0.720, crownTopFrac: 0.111,
        targetEyeY: 560,
        ovalOuterTop: 133,  ovalOuterBottom: 997,   // gap=5.0mm, face=32.4mm
        ovalInnerTop: 202,  ovalInnerBottom: 954,
        headMinPx: 795, headMaxPx: 933,
        ovalFill: 1.0, topGap: 0.0,
        headTopMm: nil, hairMult: 1.22
    )
    private static let AUS_SPEC = Spec(
        outW: 900, outH: 1200, dpi: 600,
        photoHeightMm: 45.0,
        faceFrac: 0.720, crownTopFrac: 0.111,
        targetEyeY: 560,
        ovalOuterTop: 133,  ovalOuterBottom: 997,   // gap=5.0mm, face=32.4mm
        ovalInnerTop: 202,  ovalInnerBottom: 954,
        headMinPx: 795, headMaxPx: 933,
        ovalFill: 1.0, topGap: 0.0,
        headTopMm: nil, hairMult: 1.22
    )
    private static let CAN_SPEC = Spec(
        outW: 1200, outH: 1680, dpi: 610,
        photoHeightMm: 70.0,
        faceFrac: 0.479, crownTopFrac: 0.143,
        targetEyeY: 660,
        ovalOuterTop: 240,  ovalOuterBottom: 1044,  // gap=10.0mm, face=33.5mm
        ovalInnerTop: 304,  ovalInnerBottom: 1004,
        headMinPx: 740, headMaxPx: 868,
        ovalFill: 1.0, topGap: 0.0,
        headTopMm: nil, hairMult: 1.075
    )

    private func getSpec(_ country: String) -> Spec {
        switch country {
        case "GBR", "SCH", "DEU", "ZAF": return PassportProcessor.UK_SPEC
        case "AUS":                        return PassportProcessor.AUS_SPEC
        case "CAN":                        return PassportProcessor.CAN_SPEC
        default:                           return PassportProcessor.US_SPEC
        }
    }

    // MARK: ── Image Loading ───────────────────────────────────────────────

    /// Loads UIImage from file:// or bare-path URI.
    /// UIImage automatically applies EXIF orientation when loaded from a file,
    /// but we call fixOrientation() to bake it into the pixel buffer so
    /// all subsequent operations work in display orientation.
    private func loadImage(from uri: String) -> UIImage? {
        var path = uri
        if path.hasPrefix("file://") { path = String(path.dropFirst(7)) }
        if let decoded = path.removingPercentEncoding { path = decoded }
        guard let img = UIImage(contentsOfFile: path) else { return nil }
        return fixOrientation(img)
    }

    /// Bakes the UIImage orientation into its pixel data so CGImage operations
    /// (crop, scale) see the image right-side-up.
    private func fixOrientation(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        UIGraphicsBeginImageContextWithOptions(image.size, false, image.scale)
        image.draw(in: CGRect(origin: .zero, size: image.size))
        let fixed = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()
        return fixed
    }

    // MARK: ── Downscale ───────────────────────────────────────────────────

    private func downscale(_ image: UIImage, maxDim: CGFloat) -> (UIImage, CGFloat) {
        let w = image.size.width * image.scale
        let h = image.size.height * image.scale
        let longer = max(w, h)
        guard longer > maxDim else { return (image, 1.0) }
        let scale = maxDim / longer
        let newSize = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
        image.draw(in: CGRect(origin: .zero, size: newSize))
        let scaled = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()
        return (scaled, scale)
    }

    // MARK: ── Face Detection ──────────────────────────────────────────────

    struct FaceData {
        let fx: Int; let fy: Int; let fw: Int; let fh: Int
        let eyeY: Int       // average Y of both eyes
        let crownY: Int     // estimated top of hair
        let chinY: Int      // bottom of face
        let faceCx: Int     // horizontal centre of face
    }

    private func detectFace(in image: UIImage) throws -> FaceData {
        guard let cgImage = image.cgImage else {
            throw NSError(domain: "PassportProcessor", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Could not get CGImage"])
        }

        let w = cgImage.width; let h = cgImage.height
        var faceData: FaceData?
        var detectionError: Error?
        let semaphore = DispatchSemaphore(value: 0)

        // Request face landmarks to get eye positions
        let landmarkRequest = VNDetectFaceLandmarksRequest { req, err in
            defer { semaphore.signal() }
            if let err = err { detectionError = err; return }
            guard let results = req.results as? [VNFaceObservation],
                  let face = results.max(by: {
                      $0.boundingBox.width * $0.boundingBox.height <
                      $1.boundingBox.width * $1.boundingBox.height
                  }) else {
                detectionError = NSError(domain: "PassportProcessor", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "No face detected in image"])
                return
            }

            // Vision uses normalised coords, origin bottom-left, Y upward
            let bb = face.boundingBox
            let fx = Int(bb.minX  * CGFloat(w))
            let fy = Int((1.0 - bb.maxY) * CGFloat(h))
            let fw = Int(bb.width  * CGFloat(w))
            let fh = Int(bb.height * CGFloat(h))
            let faceCx = fx + fw / 2

            // Eye Y from landmarks
            var eyeYVal: Int
            if let lm = face.landmarks,
               let leftEye  = lm.leftEye,
               let rightEye = lm.rightEye,
               !leftEye.normalizedPoints.isEmpty,
               !rightEye.normalizedPoints.isEmpty {
                // Landmark points are normalised within the face bounding box
                // Convert to image pixel coordinates
                let leY = leftEye.normalizedPoints.map { pt -> CGFloat in
                    // In Vision, landmark Y is normalised in face box, origin bottom-left
                    let absY = (1.0 - bb.maxY) * CGFloat(h) + (1.0 - pt.y) * CGFloat(fh)
                    return absY
                }
                let reY = rightEye.normalizedPoints.map { pt -> CGFloat in
                    let absY = (1.0 - bb.maxY) * CGFloat(h) + (1.0 - pt.y) * CGFloat(fh)
                    return absY
                }
                let leAvg = leY.reduce(0, +) / CGFloat(leY.count)
                let reAvg = reY.reduce(0, +) / CGFloat(reY.count)
                eyeYVal = Int((leAvg + reAvg) / 2.0)
            } else {
                // Fallback: eyes at ~37% of face height from top of bounding box
                eyeYVal = fy + Int(Double(fh) * 0.37)
            }

            // Crown: Vision face box covers forehead-to-chin. Hair is ~20% above box top.
            let crownEstimate = max(0, fy - Int(Double(fh) * 0.20))

            // Chin: bottom of face box + 5% buffer
            let chinY = min(h, fy + fh + Int(Double(fh) * 0.05))

            faceData = FaceData(fx: fx, fy: fy, fw: fw, fh: fh,
                                eyeY: eyeYVal,
                                crownY: crownEstimate,
                                chinY: chinY,
                                faceCx: faceCx)
        }

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try handler.perform([landmarkRequest])
        semaphore.wait()

        if let err = detectionError { throw err }
        guard var fd = faceData else {
            throw NSError(domain: "PassportProcessor", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Face detection timed out"])
        }

        // Refine crown by scanning upward for bright background.
        // Only trust the result if it is clearly ABOVE the face bounding box top.
        // Light-skinned foreheads are bright (>185) so the scan can stop immediately
        // inside the face box — in that case fall back to a hairMult estimate.
        // Vision fy ≈ top of forehead / hairline — already a good crown estimate.
        // Using fy directly avoids overestimating hair height which caused the
        // head to appear above the green overlay line.
        let fallbackCrownY = fd.fy
        // Use pixel-scan crown only if it found background clearly ABOVE fy.
        // If scan result is at or below fy, it hit skin/hair not background — use fy.
        let refinedCrownY: Int
        if let refined = refineCrown(cgImage: cgImage,
                                     crownEstimate: fd.crownY,
                                     fy: fd.fy, fh: fd.fh,
                                     faceCx: fd.faceCx, fw: fd.fw,
                                     imgW: w, imgH: h),
           refined < fd.fy {
            // Clamp: don't go more than 30% of fh above fy (avoids runaway estimates)
            refinedCrownY = max(fd.fy - Int(Double(fd.fh) * 0.30), refined)
        } else {
            refinedCrownY = fallbackCrownY
        }
        fd = FaceData(fx: fd.fx, fy: fd.fy, fw: fd.fw, fh: fd.fh,
                      eyeY: fd.eyeY, crownY: refinedCrownY, chinY: fd.chinY, faceCx: fd.faceCx)

        return fd
    }

    /// Scans upward from the face bounding box to find where the background begins,
    /// refining the crown estimate. Mirrors Android's refineCrown().
    ///
    /// Renders the scan strip into a known RGBA8 context to avoid crashes from
    /// non-standard CGImage pixel formats (BGRA, compressed, planar) that come
    /// from the iOS photo library.
    private func refineCrown(cgImage: CGImage,
                              crownEstimate: Int, fy: Int, fh: Int,
                              faceCx: Int, fw: Int, imgW: Int, imgH: Int) -> Int? {
        let bandHw    = max(20, fw / 5)
        let bandL     = max(0, faceCx - bandHw)
        let bandR     = min(imgW, faceCx + bandHw)
        let bandW     = bandR - bandL
        let maxExtend = Int(Double(fh) * 0.40)
        let scanStop  = max(0, fy - maxExtend)
        let stripTop  = scanStop
        let stripH    = max(1, min(imgH, fy + Int(Double(fh) * 0.05)) - stripTop)

        guard bandW > 0, stripH > 0 else { return nil }

        // Render only the scan strip into a known RGBA8 bitmap context
        var stripPixels = [UInt8](repeating: 0, count: bandW * stripH * 4)
        guard let ctx = CGContext(
            data: &stripPixels,
            width: bandW, height: stripH,
            bitsPerComponent: 8,
            bytesPerRow: bandW * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }

        ctx.draw(cgImage,
                 in: CGRect(x: -bandL, y: -(imgH - stripTop - stripH),
                            width: imgW, height: imgH))

        let scanStart = min(stripH - 1, fy + Int(Double(fh) * 0.05) - stripTop)
        var scanCrown = crownEstimate

        for y in stride(from: scanStart, through: 0, by: -1) {
            var bgCount = 0
            let rowBase = y * bandW * 4
            for x in 0..<bandW {
                let i = rowBase + x * 4
                let r = Float(stripPixels[i])
                let g = Float(stripPixels[i + 1])
                let b = Float(stripPixels[i + 2])
                let brightness = (r + g + b) / 3.0
                // Background detection: very bright AND nearly achromatic (low saturation)
                // This distinguishes white/grey background from warm-toned bald scalp
                let maxC = max(r, g, b)
                let minC = min(r, g, b)
                let sat = maxC > 0 ? (maxC - minC) / maxC : 0
                let isBackground = brightness > 220 && sat < 0.08
                if isBackground { bgCount += 1 }
            }
            let bgFrac = Double(bgCount) / Double(bandW)
            if bgFrac > 0.70 {
                scanCrown = (y + stripTop) + 2
                break
            }
        }

        let finalCrown = max(0, scanCrown - Int(Double(fh) * 0.05))
        return finalCrown
    }

    // MARK: ── Photo Enhancement ───────────────────────────────────────────

    /// Applies only a mild unsharp mask — no gamma correction, no histogram stretch.
    /// This preserves natural skin tones which the full enhancePhoto() would shift.
    /// iOS camera images are already well-processed by the camera pipeline.
    private func mildSharpen(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        var pixels = extractPixels(cgImage)
        guard !pixels.isEmpty else { return image }
        // Very light unsharp mask (amount=0.25, threshold=8) — barely perceptible
        unsharpMask(&pixels, w: cgImage.width, h: cgImage.height, amount: 0.25, threshold: 8)
        return rebuildImage(pixels: pixels, width: cgImage.width, height: cgImage.height) ?? image
    }

    /// Full enhancement kept for reference (currently disabled — shifts skin tone on iOS).
    private func enhancePhoto(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }

        let w = cgImage.width; let h = cgImage.height
        var pixels = extractPixels(cgImage)
        guard !pixels.isEmpty else { return image }

        // ── Gamma: measure face-centre luminance ──
        let cx = w / 2; let cy = h / 2
        let zoneR = min(w, h) / 6
        var lumSum: Float = 0; var lumCount = 0
        for py in max(0, cy - zoneR)...min(h - 1, cy + zoneR) {
            for px in max(0, cx - zoneR)...min(w - 1, cx + zoneR) {
                let idx = (py * w + px) * 4
                let r = Float(pixels[idx]); let g = Float(pixels[idx+1]); let b = Float(pixels[idx+2])
                lumSum += (r + g + b) / 3.0
                lumCount += 1
            }
        }
        let meanLum = lumCount > 0 ? lumSum / Float(lumCount) / 255.0 : 0.5
        let gamma: Float
        if      meanLum < 0.42 { gamma = 0.84 }
        else if meanLum < 0.50 { gamma = 0.93 }
        else if meanLum > 0.72 { gamma = 1.06 }
        else                   { gamma = 1.00 }

        // ── Histogram for stretch percentiles ──
        var lumHist = [Int](repeating: 0, count: 256)
        for i in stride(from: 0, to: pixels.count, by: 4) {
            var lum = Float(pixels[i]) * 0.299 + Float(pixels[i+1]) * 0.587 + Float(pixels[i+2]) * 0.114
            if gamma != 1.0 { lum = 255.0 * powf(max(0, lum / 255.0), gamma) }
            lumHist[min(255, max(0, lum.isFinite ? Int(lum) : 0))] += 1
        }
        let total = w * h
        let p2Threshold  = Int(Float(total) * 0.02)
        let p97Threshold = Int(Float(total) * 0.97)
        var cumSum = 0; var p2: Float = 0; var p97: Float = 255
        var p2Set = false
        for lv in 0...255 {
            cumSum += lumHist[lv]
            if cumSum >= p2Threshold && !p2Set { p2 = Float(lv); p2Set = true }
            if cumSum >= p97Threshold { p97 = Float(lv); break }
        }
        let stretch: Float = (p97 > p2 + 10) ? 250.0 / (p97 - p2) : 1.0

        // ── Apply gamma + stretch ──
        for i in stride(from: 0, to: pixels.count, by: 4) {
            var r = Float(pixels[i]); var g = Float(pixels[i+1]); var b = Float(pixels[i+2])
            if gamma != 1.0 {
                r = 255.0 * powf(max(0, r / 255.0), gamma)
                g = 255.0 * powf(max(0, g / 255.0), gamma)
                b = 255.0 * powf(max(0, b / 255.0), gamma)
            }
            if stretch != 1.0 {
                r = ((r - p2) * stretch + 3.0).clamped(to: 0...255)
                g = ((g - p2) * stretch + 3.0).clamped(to: 0...255)
                b = ((b - p2) * stretch + 3.0).clamped(to: 0...255)
            }
            pixels[i]   = UInt8((r.isFinite ? r : 0).rounded().clamped(to: 0...255))
            pixels[i+1] = UInt8((g.isFinite ? g : 0).rounded().clamped(to: 0...255))
            pixels[i+2] = UInt8((b.isFinite ? b : 0).rounded().clamped(to: 0...255))
        }

        // ── Unsharp mask (amount=0.45, threshold=4) ──
        unsharpMask(&pixels, w: w, h: h, amount: 0.45, threshold: 4)

        return rebuildImage(pixels: pixels, width: w, height: h) ?? image
    }

    /// 3×3 approximation unsharp mask matching Android's row-by-row approach.
    private func unsharpMask(_ pixels: inout [UInt8], w: Int, h: Int,
                              amount: Float, threshold: Int) {
        let stride4 = w * 4
        var blurred = [UInt8](repeating: 0, count: pixels.count)

        // Box blur (3×3)
        for y in 0..<h {
            for x in 0..<w {
                var rS = 0; var gS = 0; var bS = 0; var cnt = 0
                for dy in -1...1 {
                    let ny = y + dy
                    if ny < 0 || ny >= h { continue }
                    for dx in -1...1 {
                        let nx = x + dx
                        if nx < 0 || nx >= w { continue }
                        let idx = ny * stride4 + nx * 4
                        rS += Int(pixels[idx]); gS += Int(pixels[idx+1]); bS += Int(pixels[idx+2])
                        cnt += 1
                    }
                }
                let idx = y * stride4 + x * 4
                blurred[idx]   = UInt8(rS / cnt)
                blurred[idx+1] = UInt8(gS / cnt)
                blurred[idx+2] = UInt8(bS / cnt)
                blurred[idx+3] = pixels[idx+3]
            }
        }

        // Apply sharpening
        for i in stride(from: 0, to: pixels.count - 3, by: 4) {
            let dr = Int(pixels[i])   - Int(blurred[i])
            let dg = Int(pixels[i+1]) - Int(blurred[i+1])
            let db = Int(pixels[i+2]) - Int(blurred[i+2])
            if abs(dr) >= threshold || abs(dg) >= threshold || abs(db) >= threshold {
                pixels[i]   = UInt8((Int(pixels[i])   + Int(Float(dr) * amount)).clamped(to: 0...255))
                pixels[i+1] = UInt8((Int(pixels[i+1]) + Int(Float(dg) * amount)).clamped(to: 0...255))
                pixels[i+2] = UInt8((Int(pixels[i+2]) + Int(Float(db) * amount)).clamped(to: 0...255))
            }
        }
    }

    // MARK: ── Background Removal ──────────────────────────────────────────

    /// Background removal: uses ML segmentation (iOS 15+) with tone-curve fallback.
    private func whitenBackground(image: UIImage, face: FaceData) -> UIImage {
        if #available(iOS 15.0, *) {
            return whitenBackgroundSegmentation(image: image, face: face)
        }
        return whitenBackgroundToneCurve(image: image)
    }

    @available(iOS 15.0, *)
    private func whitenBackgroundSegmentation(image: UIImage, face: FaceData) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let w = cgImage.width; let h = cgImage.height

        // ── Step 1: Run Apple ML segmentation ──────────────────────────────────
        var maskPixels: [Float]?
        var maskW = 0; var maskH = 0
        let semaphore = DispatchSemaphore(value: 0)

        let request = VNGeneratePersonSegmentationRequest { req, _ in
            defer { semaphore.signal() }
            guard let obs = req.results?.first as? VNPixelBufferObservation else { return }
            let buf = obs.pixelBuffer
            CVPixelBufferLockBaseAddress(buf, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
            maskW = CVPixelBufferGetWidth(buf)
            maskH = CVPixelBufferGetHeight(buf)
            guard let base = CVPixelBufferGetBaseAddress(buf) else { return }
            let ptr = base.assumingMemoryBound(to: Float32.self)
            let bytesPerRow  = CVPixelBufferGetBytesPerRow(buf)
            let floatsPerRow = bytesPerRow / MemoryLayout<Float32>.size
            var flat = [Float](repeating: 0, count: maskW * maskH)
            for row in 0..<maskH {
                let src = ptr.advanced(by: row * floatsPerRow)
                let base2 = row * maskW
                for col in 0..<maskW { flat[base2 + col] = src[col] }
            }
            maskPixels = flat
        }
        request.qualityLevel = .accurate
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([request])
        semaphore.wait()

        guard let rawMask = maskPixels, maskW > 0, maskH > 0 else {
            return whitenBackgroundToneCurve(image: image)
        }

        // ── Step 2: Bilinear upsample to full image size ────────────────────────
        var mask = [Float](repeating: 0, count: w * h)
        let scaleX = Float(maskW - 1) / Float(max(w - 1, 1))
        let scaleY = Float(maskH - 1) / Float(max(h - 1, 1))
        for y in 0..<h {
            for x in 0..<w {
                let srcX = Float(x) * scaleX
                let srcY = Float(y) * scaleY
                let x0 = min(Int(srcX), maskW - 2)
                let y0 = min(Int(srcY), maskH - 2)
                let fx = srcX - Float(x0); let fy2 = srcY - Float(y0)
                let v = rawMask[y0*maskW+x0]*(1-fx)*(1-fy2) +
                        rawMask[y0*maskW+x0+1]*fx*(1-fy2) +
                        rawMask[(y0+1)*maskW+x0]*(1-fx)*fy2 +
                        rawMask[(y0+1)*maskW+x0+1]*fx*fy2
                mask[y*w+x] = v.isFinite ? v : 0
            }
        }

        // ── Step 3: Threshold to binary trimap ─────────────────────────────────
        // definite_fg >= 0.65, definite_bg <= 0.35, edge zone in between
        let FG_THRESH: Float = 0.65
        let BG_THRESH: Float = 0.35
        // 0 = background, 1 = foreground, 2 = uncertain edge
        var trimap = [UInt8](repeating: 2, count: w * h)
        for i in 0..<(w*h) {
            if mask[i] >= FG_THRESH { trimap[i] = 1 }
            else if mask[i] <= BG_THRESH { trimap[i] = 0 }
        }

        // ── Step 4: Border flood-fill to identify CONNECTED background ──────────
        // Only pixels reachable from the image border (4-connectivity) that are
        // classified as background in the trimap are true background.
        // Interior holes (shirt, collar) are NOT reachable from border → stay person.
        var bgMask = [Bool](repeating: false, count: w * h)
        var queue = [Int]()
        queue.reserveCapacity(w * 2 + h * 2)

        // Seed: all border pixels that are definitively background
        func seedIfBg(_ idx: Int) {
            if trimap[idx] == 0 { bgMask[idx] = true; queue.append(idx) }
        }
        for x in 0..<w { seedIfBg(x); seedIfBg((h-1)*w+x) }
        for y in 1..<(h-1) { seedIfBg(y*w); seedIfBg(y*w+w-1) }

        // BFS flood fill — 4-connected, only through background trimap pixels
        var qi = 0
        while qi < queue.count {
            let idx = queue[qi]; qi += 1
            let x = idx % w; let y = idx / w
            let neighbours = [
                y > 0     ? idx - w : -1,
                y < h-1   ? idx + w : -1,
                x > 0     ? idx - 1 : -1,
                x < w-1   ? idx + 1 : -1
            ]
            for n in neighbours {
                guard n >= 0, !bgMask[n], trimap[n] == 0 else { continue }
                bgMask[n] = true
                queue.append(n)
            }
        }

        // ── Step 5: Force all non-border-connected background to foreground ──────
        // Any background pixel NOT reached by flood-fill = interior hole → fill it
        for i in 0..<(w*h) {
            if trimap[i] == 0 && !bgMask[i] { trimap[i] = 1 }
        }

        // ── Step 6: Soft alpha at edge zone using Gaussian-blurred mask ──────────
        // Blur just the edge band to get smooth anti-aliased transitions
        let blurRadius = max(2, min(w, h) / 250)
        let smoothMask = gaussianBlurMask(mask, w: w, h: h, radius: blurRadius)

        // ── Step 7: Build final alpha ───────────────────────────────────────────
        // Definite bg → 0 (white), definite fg → 1 (keep), edge → smooth alpha
        var finalAlpha = [Float](repeating: 1, count: w * h)
        for i in 0..<(w*h) {
            switch trimap[i] {
            case 1: finalAlpha[i] = 1.0                             // confirmed person
            case 0: finalAlpha[i] = bgMask[i] ? 0.0 : 1.0          // bg: only border-connected
            default:                                                  // edge zone
                let a = smoothMask[i].clamped(to: 0...1)
                finalAlpha[i] = a.isFinite ? a : 1.0
            }
        }

        // ── Step 8: Edge refinement — dark hair pixels near edges ──────────────
        // Hair edges are often under-detected by the ML model.
        // In the edge zone, if a pixel is very dark it is more likely hair than bg.
        var pixels = extractPixels(cgImage)
        for i in 0..<(w*h) {
            guard trimap[i] == 2 else { continue }      // only touch uncertain edge zone
            let pi = i * 4
            let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
            let lum = r * 0.299 + g * 0.587 + b * 0.114
            // Very dark pixels in edge zone are almost certainly hair → keep
            if lum < 50 { finalAlpha[i] = min(1, finalAlpha[i] * 1.4) }
        }

        // ── Step 9: Composite onto pure white ──────────────────────────────────
        for i in 0..<(w*h) {
            let alpha = finalAlpha[i].clamped(to: 0...1)
            let pi = i * 4
            if alpha >= 0.995 {
                // fully person — untouched
            } else if alpha <= 0.005 {
                pixels[pi] = 255; pixels[pi+1] = 255; pixels[pi+2] = 255
            } else {
                let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
                pixels[pi]   = UInt8(((r * alpha + 255 * (1-alpha)).clamped(to: 0...255)))
                pixels[pi+1] = UInt8(((g * alpha + 255 * (1-alpha)).clamped(to: 0...255)))
                pixels[pi+2] = UInt8(((b * alpha + 255 * (1-alpha)).clamped(to: 0...255)))
            }
        }

        // ── Step 10: Sanity check — face centre must not be white ───────────────
        let zoneX1 = max(0, face.fx + face.fw / 4)
        let zoneX2 = min(w, face.fx + face.fw * 3 / 4)
        let zoneY1 = max(0, face.fy + face.fh / 4)
        let zoneY2 = min(h, face.fy + face.fh * 3 / 4)
        var faceWhite = 0; var faceTotal = 0
        for fy3 in zoneY1..<zoneY2 {
            for fx3 in zoneX1..<zoneX2 {
                let i = (fy3 * w + fx3) * 4
                if pixels[i] > 240 && pixels[i+1] > 240 && pixels[i+2] > 240 { faceWhite += 1 }
                faceTotal += 1
            }
        }
        if faceTotal > 0 && faceWhite * 100 / faceTotal > 40 {
            return whitenBackgroundToneCurve(image: image)
        }

        return rebuildImage(pixels: pixels, width: w, height: h) ?? whitenBackgroundToneCurve(image: image)
    }

    /// Fallback background cleanup — used only when ML segmentation is unavailable
    /// or produced a bad result. Operates purely at pixel level: only pixels that
    /// are already near-white AND achromatic (background) are pushed to pure white.
    /// All other pixels (face, skin, hair, clothing) are left COMPLETELY UNTOUCHED.
    private func whitenBackgroundToneCurve(image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        var pixels = extractPixels(cgImage)
        guard !pixels.isEmpty else { return image }
        let w = cgImage.width; let h = cgImage.height

        for i in stride(from: 0, to: pixels.count - 2, by: 4) {
            let r = Int(pixels[i]); let g = Int(pixels[i+1]); let b = Int(pixels[i+2])
            let brightness = (r + g + b) / 3
            let maxC = max(r, max(g, b))
            let minC = min(r, min(g, b))
            let sat = maxC > 0 ? (maxC - minC) * 255 / maxC : 0
            // Only touch very bright, nearly achromatic pixels — i.e. background.
            // Threshold: brightness > 220 AND saturation < 20.
            // This leaves skin (warm, saturated) and hair (dark) completely alone.
            if brightness > 220 && sat < 20 {
                pixels[i] = 255; pixels[i+1] = 255; pixels[i+2] = 255
            }
            // All other pixels: no change whatsoever
        }

        return rebuildImage(pixels: pixels, width: w, height: h) ?? image
    }

    /// Returns true only if the background is genuinely pure white (studio white).
    /// Samples borders; requires both very high brightness AND very low saturation.
    /// This prevents cream walls, beige rooms, or bright indoor scenes from
    /// skipping background removal.
    private func hasWhiteBackground(_ image: UIImage) -> Bool {
        guard let cgImage = image.cgImage else { return false }
        let w = cgImage.width; let h = cgImage.height
        guard w > 10, h > 10 else { return false }
        var pixels = extractPixels(cgImage)
        guard !pixels.isEmpty else { return false }

        var brightAndNeutralCount = 0
        var sampleCount = 0

        func sample(_ i: Int) {
            let r = Int(pixels[i]); let g = Int(pixels[i+1]); let b = Int(pixels[i+2])
            let brightness = (r + g + b) / 3
            let maxC = max(r, max(g, b))
            let minC = min(r, min(g, b))
            // Saturation in 0–255 scale
            let sat = maxC > 0 ? (maxC - minC) * 255 / maxC : 0
            // Pure white: very bright AND nearly achromatic
            if brightness > 245 && sat < 12 { brightAndNeutralCount += 1 }
            sampleCount += 1
        }

        // Top 8% of image
        let topRows = max(1, h / 12)
        for y in 0..<topRows {
            for x in stride(from: 0, to: w, by: max(1, w / 20)) {
                sample((y * w + x) * 4)
            }
        }
        // Left and right 7% strips (top half only)
        let stripW = max(1, w / 14)
        for y in stride(from: 0, to: h / 2, by: max(1, h / 30)) {
            for x in 0..<stripW { sample((y * w + x) * 4) }
            for x in (w - stripW)..<w { sample((y * w + x) * 4) }
        }

        guard sampleCount > 0 else { return false }
        // Only skip removal if ≥90% of sampled border pixels are pure white
        return Double(brightAndNeutralCount) / Double(sampleCount) >= 0.90
    }

    /// Separable Gaussian blur on a Float mask (mirrors Android's gaussianBlurMask).
    private func gaussianBlurMask(_ mask: [Float], w: Int, h: Int, radius: Int) -> [Float] {
        guard radius > 0 else { return mask }
        let ksz = radius * 2 + 1
        let sigma = Float(radius) / 2.5
        var kernel = [Float](repeating: 0, count: ksz)
        var ksum: Float = 0
        for i in 0..<ksz {
            let x = Float(i - radius)
            kernel[i] = exp(-x * x / (2 * sigma * sigma))
            ksum += kernel[i]
        }
        for i in 0..<ksz { kernel[i] /= ksum }

        var temp = [Float](repeating: 0, count: w * h)
        // Horizontal pass
        for y in 0..<h {
            for x in 0..<w {
                var v: Float = 0
                for k in 0..<ksz {
                    let sx = min(max(x + k - radius, 0), w - 1)
                    v += mask[y * w + sx] * kernel[k]
                }
                temp[y * w + x] = v
            }
        }
        // Vertical pass
        var result = [Float](repeating: 0, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                var v: Float = 0
                for k in 0..<ksz {
                    let sy = min(max(y + k - radius, 0), h - 1)
                    v += temp[sy * w + x] * kernel[k]
                }
                result[y * w + x] = v.isFinite ? min(max(v, 0), 1) : 1
            }
        }
        return result
    }

    // MARK: ── Force Headroom White ────────────────────────────────────────

    /// Cleans up the top border area of the prepared image. Mirrors Android's
    /// forceHeadroomWhite(): flood-fill from edges to find background pixels,
    /// then push them to white with a fade at the boundary.
    private func forceHeadroomWhite(_ image: UIImage, crownTopFrac: Float) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let w = cgImage.width; let h = cgImage.height
        let headroomRows = Int(Float(h) * crownTopFrac)
        guard headroomRows > 2 else { return image }

        var pixels = extractPixels(cgImage)
        let zoneH = min(h, headroomRows + max(8, Int(Float(h) * 0.03)))
        let zoneCount = w * zoneH

        // ── Build candidate mask (bright / low-saturation pixels) ──
        var candidate = [Bool](repeating: false, count: zoneCount)
        var grayVals  = [Float](repeating: 0, count: zoneCount)

        for i in 0..<zoneCount {
            let pi = i * 4
            let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
            let gray = (r + g + b) / 3.0
            grayVals[i] = gray

            // Convert to HSV for saturation check
            let maxC = max(r, g, b) / 255.0
            let minC = min(r, g, b) / 255.0
            let sat = maxC > 0 ? (maxC - minC) / maxC : 0

            candidate[i] = (maxC > 0.85 && sat < 0.10 && gray > 200) || gray > 230
        }

        // ── Flood-fill BFS from top/left/right edges ──
        var bgMask = [Bool](repeating: false, count: zoneCount)
        var queue = [Int]()
        for x in 0..<w { if candidate[x] { queue.append(x) } }
        for y in 0..<min(headroomRows, zoneH) {
            if candidate[y * w]         { queue.append(y * w) }
            if candidate[y * w + w - 1] { queue.append(y * w + w - 1) }
        }

        let dx = [-1, 1, 0, 0]; let dy = [0, 0, -1, 1]
        var qi = 0
        while qi < queue.count {
            let idx = queue[qi]; qi += 1
            if bgMask[idx] { continue }
            bgMask[idx] = true
            let cx = idx % w; let cy = idx / w
            for d in 0..<4 {
                let nx = cx + dx[d]; let ny = cy + dy[d]
                if nx >= 0 && nx < w && ny >= 0 && ny < zoneH {
                    let ni = ny * w + nx
                    if !bgMask[ni] && candidate[ni] { queue.append(ni) }
                }
            }
        }

        // Force only very bright pixels in pure headroom zone (>220 = near white)
        // Raised from 140 to protect dark skin and hair near the crown
        let forceRows = max(1, headroomRows - 8)
        for y in 0..<forceRows {
            for x in 0..<w {
                if grayVals[y * w + x] > 220 { bgMask[y * w + x] = true }
            }
        }
        // Protect all non-very-bright pixels (raised from 100 to 200)
        for i in 0..<zoneCount { if grayVals[i] < 200 { bgMask[i] = false } }

        // ── Apply: push toward white with fade at boundary ──
        for y in 0..<zoneH {
            let fadeFactor: Float = y >= headroomRows - 8
                ? 1.0 - Float(y - (headroomRows - 8)) / Float(zoneH - (headroomRows - 8))
                : 1.0

            for x in 0..<w {
                let i = y * w + x
                if !bgMask[i] { continue }
                let pi = i * 4
                let strength = min(1.0, fadeFactor * (y < headroomRows ? 1.5 : 1.0))
                let r = Float(pixels[pi]); let g = Float(pixels[pi+1]); let b = Float(pixels[pi+2])
                pixels[pi]   = UInt8((r * (1 - strength) + 255 * strength).clamped(to: 0...255))
                pixels[pi+1] = UInt8((g * (1 - strength) + 255 * strength).clamped(to: 0...255))
                pixels[pi+2] = UInt8((b * (1 - strength) + 255 * strength).clamped(to: 0...255))
            }
        }

        return rebuildImage(pixels: pixels, width: w, height: h) ?? image
    }

    // MARK: ── Brightness ──────────────────────────────────────────────────

    /// Applies pixel-level brightness shift, skipping near-white pixels (background).
    /// Mirrors Android applyBrightness().
    private func applyBrightness(_ image: UIImage, amount: Int) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        var pixels = extractPixels(cgImage)
        let shift = Int(Float(amount) * 1.6)

        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = Int(pixels[i]); let g = Int(pixels[i+1]); let b = Int(pixels[i+2])
            // Skip near-white background pixels
            if r > 248 && g > 248 && b > 248 { continue }
            pixels[i]   = UInt8((r + shift).clamped(to: 0...255))
            pixels[i+1] = UInt8((g + shift).clamped(to: 0...255))
            pixels[i+2] = UInt8((b + shift).clamped(to: 0...255))
        }
        return rebuildImage(pixels: pixels, width: cgImage.width, height: cgImage.height) ?? image
    }

    // MARK: ── Watermark ───────────────────────────────────────────────────

    /// Draws a semi-transparent rotated "PassportSnap" watermark, matching Android.
    private func addWatermark(_ image: UIImage) -> UIImage {
        let w = image.size.width; let h = image.size.height
        UIGraphicsBeginImageContextWithOptions(CGSize(width: w, height: h), false, 1.0)
        defer { UIGraphicsEndImageContext() }
        image.draw(at: .zero)

        guard let ctx = UIGraphicsGetCurrentContext() else {
            return UIGraphicsGetImageFromCurrentImageContext() ?? image
        }

        let fontSize = max(28, w / 5) * 0.70
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: fontSize),
            .foregroundColor: UIColor(white: 0.55, alpha: 0.35)
        ]
        let text = "PassportSnap" as NSString
        let textSize = text.size(withAttributes: attrs)

        ctx.saveGState()
        ctx.translateBy(x: w / 2, y: h / 2)
        ctx.rotate(by: -30 * .pi / 180)
        text.draw(at: CGPoint(x: -textSize.width / 2, y: -textSize.height / 2),
                  withAttributes: attrs)
        ctx.restoreGState()

        return UIGraphicsGetImageFromCurrentImageContext() ?? image
    }

    // MARK: ── 4×6 Sheet ───────────────────────────────────────────────────

    private func build4x6Sheet(photo: UIImage, country: String) -> UIImage? {
        let sheetW: CGFloat = 1200; let sheetH: CGFloat = 1800; let border: CGFloat = 2

        let (pw, ph): (CGFloat, CGFloat)
        switch country {
        case "GBR", "SCH", "DEU", "ZAF", "AUS": (pw, ph) = (413, 532)
        case "CAN":                               (pw, ph) = (591, 827)
        default:                                  (pw, ph) = (600, 600)
        }

        UIGraphicsBeginImageContextWithOptions(CGSize(width: sheetW, height: sheetH), true, 1.0)
        defer { UIGraphicsEndImageContext() }

        UIColor.white.setFill()
        UIRectFill(CGRect(x: 0, y: 0, width: sheetW, height: sheetH))

        let slotW = pw + 2 * border; let slotH = ph + 2 * border
        let startX = (sheetW - slotW) / 2
        let gap: CGFloat = 40
        let startY = (sheetH - (2 * slotH + gap)) / 2

        UIColor.black.setStroke()
        for i in 0...1 {
            let sy = startY + CGFloat(i) * (slotH + gap)
            let photoRect = CGRect(x: startX + border, y: sy + border, width: pw, height: ph)
            photo.draw(in: photoRect)
            let borderRect = CGRect(x: startX, y: sy, width: slotW, height: slotH)
            UIBezierPath(rect: borderRect).stroke()
        }

        return UIGraphicsGetImageFromCurrentImageContext()
    }

    // MARK: ── Pixel Utilities ─────────────────────────────────────────────

    /// Extracts RGBA pixel array from a CGImage. Alpha channel is always 255.
    private func extractPixels(_ cgImage: CGImage) -> [UInt8] {
        let w = cgImage.width; let h = cgImage.height
        var pixels = [UInt8](repeating: 255, count: w * h * 4)
        guard let ctx = CGContext(data: &pixels, width: w, height: h,
                                  bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
            return []
        }
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
        return pixels
    }

    /// Builds a UIImage from an RGBA pixel array.
    private func rebuildImage(pixels: [UInt8], width: Int, height: Int) -> UIImage? {
        var mutablePixels = pixels
        guard let ctx = CGContext(data: &mutablePixels, width: width, height: height,
                                  bitsPerComponent: 8, bytesPerRow: width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
              let cg = ctx.makeImage() else { return nil }
        return UIImage(cgImage: cg)
    }

    /// Pads a UIImage with white on all sides.
    private func padImage(_ image: UIImage, padX: Int, padY: Int) -> (UIImage, Int, Int) {
        let ow = Int(image.size.width); let oh = Int(image.size.height)
        let nw = ow + 2 * padX; let nh = oh + 2 * padY
        UIGraphicsBeginImageContextWithOptions(CGSize(width: nw, height: nh), true, 1.0)
        UIColor.white.setFill()
        UIRectFill(CGRect(x: 0, y: 0, width: nw, height: nh))
        image.draw(at: CGPoint(x: padX, y: padY))
        let padded = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return (padded ?? image, nw, nh)
    }

    /// Crops a UIImage to a CGRect, clamped to image bounds.
    private func cropImage(_ image: UIImage, to rect: CGRect) -> UIImage? {
        let scale = image.scale
        let scaledRect = CGRect(x: rect.minX * scale, y: rect.minY * scale,
                                width: rect.width * scale, height: rect.height * scale)
        guard let cgImage = image.cgImage,
              let cropped = cgImage.cropping(to: scaledRect) else { return nil }
        return UIImage(cgImage: cropped)
    }

    /// Resizes a UIImage to the specified pixel dimensions (not points).
    private func resizeImage(_ image: UIImage, toPixelSize size: CGSize) -> UIImage? {
        UIGraphicsBeginImageContextWithOptions(size, true, 1.0)
        image.draw(in: CGRect(origin: .zero, size: size))
        let result = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return result
    }

    private func imageToJpegBase64(_ image: UIImage, quality: CGFloat = 0.92) -> String? {
        return image.jpegData(compressionQuality: quality)?.base64EncodedString()
    }

    // MARK: ── prepare() ───────────────────────────────────────────────────

    @objc func prepare(_ photoUri: String,
                       country: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        queue.async {
            do {
                // 1. Load
                guard var bmp = self.loadImage(from: photoUri) else {
                    throw NSError(domain: "PassportProcessor", code: 10,
                        userInfo: [NSLocalizedDescriptionKey: "Could not load image from URI: \(photoUri)"])
                }

                // 2. Downscale to ≤1200px for face detection
                let (procBmp, procScale) = self.downscale(bmp, maxDim: 1200)

                // 3. Detect face
                let face = try self.detectFace(in: procBmp)

                // 4. Scale face coords back to original resolution
                let invScale = CGFloat(1.0 / Double(procScale))
                var origFace = FaceData(
                    fx:     Int(CGFloat(face.fx)     * invScale),
                    fy:     Int(CGFloat(face.fy)     * invScale),
                    fw:     Int(CGFloat(face.fw)     * invScale),
                    fh:     Int(CGFloat(face.fh)     * invScale),
                    eyeY:   Int(CGFloat(face.eyeY)   * invScale),
                    crownY: Int(CGFloat(face.crownY) * invScale),
                    chinY:  Int(CGFloat(face.chinY)  * invScale),
                    faceCx: Int(CGFloat(face.faceCx) * invScale)
                )

                // 5. Downscale to ≤2000px for enhancement
                let (enhBmp, enhScale) = self.downscale(bmp, maxDim: 2000)
                if enhScale < 1.0 {
                    bmp = enhBmp
                    origFace = FaceData(
                        fx:     Int(CGFloat(origFace.fx)     * CGFloat(enhScale)),
                        fy:     Int(CGFloat(origFace.fy)     * CGFloat(enhScale)),
                        fw:     Int(CGFloat(origFace.fw)     * CGFloat(enhScale)),
                        fh:     Int(CGFloat(origFace.fh)     * CGFloat(enhScale)),
                        eyeY:   Int(CGFloat(origFace.eyeY)   * CGFloat(enhScale)),
                        crownY: Int(CGFloat(origFace.crownY) * CGFloat(enhScale)),
                        chinY:  Int(CGFloat(origFace.chinY)  * CGFloat(enhScale)),
                        faceCx: Int(CGFloat(origFace.faceCx) * CGFloat(enhScale))
                    )
                }

                // 6. No image processing — preserve original colours exactly

                // 7. Background removal — only if background is not already white
                if !self.hasWhiteBackground(bmp) {
                    bmp = self.whitenBackground(image: bmp, face: origFace)
                }

                // 8. Skip forceHeadroomWhite — segmentation already handles background.
                // The flood-fill was causing white patches on light-skin foreheads.
                let spec = self.getSpec(country)

                // 9. Pad with white
                let origW = Int(bmp.size.width); let origH = Int(bmp.size.height)
                let padX = max(origW / 2, spec.outW)
                let padY = max(origH / 2, spec.outH)
                let (padded, paddedW, paddedH) = self.padImage(bmp, padX: padX, padY: padY)

                // 10. Auto-crop
                // Use face-detected crownY directly — more accurate than hairMult estimate.
                // headHeight = full head from crown to chin (what the overlay oval measures).
                let faceCxP = origFace.faceCx + padX
                let hairTopYP = origFace.crownY + padY
                let headHeight = max(1, origFace.chinY - origFace.crownY)
                // Keep mlFh for fallback only
                let mlFh = origFace.fh

                var cropX = 0; var cropY = 0; var cropW = 0; var cropH = 0

                if mlFh > 0 {
                    let ovalH = spec.ovalOuterBottom - spec.ovalOuterTop
                    let targetHeadPx = min(spec.headMaxPx,
                                          max(spec.headMinPx, Int(Double(ovalH) * spec.ovalFill)))
                    let scale = Double(targetHeadPx) / Double(headHeight)

                    let targetHairTopInOutput: Int
                    if let headTopMm = spec.headTopMm {
                        let pxPerMm = Double(spec.outH) / spec.photoHeightMm
                        targetHairTopInOutput = Int(headTopMm * pxPerMm)
                    } else {
                        let topGap = Int(Double(ovalH) * spec.topGap)
                        targetHairTopInOutput = spec.ovalOuterTop + topGap
                    }

                    let topS = Int(Double(hairTopYP) * scale) - targetHairTopInOutput
                    // Centre on face horizontally — pure face centre, no image-centre blend
                    let leftS = Int(Double(faceCxP) * scale) - spec.outW / 2

                    cropX = Int((Double(leftS) / scale).rounded())
                    cropY = Int((Double(topS)  / scale).rounded())
                    cropW = Int((Double(spec.outW) / scale).rounded())
                    cropH = Int((Double(spec.outH) / scale).rounded())
                } else {
                    cropW = min(paddedW, paddedH)
                    cropH = cropW
                    cropX = (paddedW - cropW) / 2
                    cropY = (paddedH - cropH) / 2
                }

                // 11. Save prepared image
                guard let jpegData = padded.jpegData(compressionQuality: 0.92) else {
                    throw NSError(domain: "PassportProcessor", code: 11,
                        userInfo: [NSLocalizedDescriptionKey: "Could not encode prepared image"])
                }
                let tmpPath = NSTemporaryDirectory()
                    + "prepared_\(Int(Date().timeIntervalSince1970)).jpg"
                try jpegData.write(to: URL(fileURLWithPath: tmpPath))

                resolve([
                    "preparedUri":  "file://\(tmpPath)",
                    "imageBase64":  jpegData.base64EncodedString(),
                    "widthPx":      paddedW,
                    "heightPx":     paddedH,
                    "autoCrop": [
                        "x": cropX, "y": cropY, "w": cropW, "h": cropH
                    ]
                ])

            } catch {
                reject("PROCESS_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: ── crop() ──────────────────────────────────────────────────────

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
                      let src  = UIImage(data: data) else {
                    throw NSError(domain: "PassportProcessor", code: 20,
                        userInfo: [NSLocalizedDescriptionKey: "Could not decode base64 image"])
                }

                let iw = Int(src.size.width); let ih = Int(src.size.height)

                // Pad to handle out-of-bounds crops
                let pad = max(outW, max(outH, max(abs(cropX), abs(cropY))))
                let (padded, pw, ph) = self.padImage(src, padX: pad, padY: pad)

                // Crop — clamped to padded bounds
                let cx = min(max(cropX + pad, 0), pw - 1)
                let cy = min(max(cropY + pad, 0), ph - 1)
                let cw = min(cropW, pw - cx)
                let ch = min(cropH, ph - cy)
                guard cw > 0 && ch > 0 else {
                    throw NSError(domain: "PassportProcessor", code: 21,
                        userInfo: [NSLocalizedDescriptionKey: "Invalid crop rectangle"])
                }

                let cropRect = CGRect(x: cx, y: cy, width: cw, height: ch)
                guard var cropped = self.cropImage(padded, to: cropRect),
                      let resized = self.resizeImage(cropped, toPixelSize: CGSize(width: outW, height: outH)) else {
                    throw NSError(domain: "PassportProcessor", code: 22,
                        userInfo: [NSLocalizedDescriptionKey: "Crop/resize failed"])
                }
                cropped = resized

                // Brightness
                if brightness != 0 { cropped = self.applyBrightness(cropped, amount: brightness) }

                // Clean base64
                guard let cleanData = cropped.jpegData(compressionQuality: 0.92) else {
                    throw NSError(domain: "PassportProcessor", code: 23,
                        userInfo: [NSLocalizedDescriptionKey: "Could not encode clean image"])
                }
                let cleanB64 = cleanData.base64EncodedString()

                // Watermarked preview
                let watermarked = self.addWatermark(cropped)
                guard let wmData = watermarked.jpegData(compressionQuality: 0.92) else {
                    throw NSError(domain: "PassportProcessor", code: 24,
                        userInfo: [NSLocalizedDescriptionKey: "Could not encode watermarked image"])
                }
                let wmB64 = wmData.base64EncodedString()

                resolve([
                    "imageBase64":        wmB64,     // watermarked — for preview
                    "cleanBase64":        cleanB64,   // clean — after purchase
                    "previewImageBase64": wmB64,
                    "widthPx":            outW,
                    "heightPx":           outH
                ])

            } catch {
                reject("CROP_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: ── makeSheet4x6() ──────────────────────────────────────────────

    @objc func makeSheet4x6(_ imageBase64: String,
                             country: String,
                             resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock) {
        queue.async {
            guard let data  = Data(base64Encoded: imageBase64),
                  let photo = UIImage(data: data) else {
                reject("DECODE_ERROR", "Could not decode base64 image", nil)
                return
            }

            guard let sheet    = self.build4x6Sheet(photo: photo, country: country),
                  let sheetData = sheet.jpegData(compressionQuality: 0.92) else {
                reject("SHEET_ERROR", "Could not render 4×6 sheet", nil)
                return
            }

            resolve([
                "imageBase64": sheetData.base64EncodedString(),
                "widthPx": 1200,
                "heightPx": 1800
            ])
        }
    }
}

// MARK: ── Comparable clamp helper ────────────────────────────────────────────

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        return min(max(self, range.lowerBound), range.upperBound)
    }
}
