# PassportSnap iOS — v2 Changes

## What Changed (matching Android v2 improvements)

### PassportProcessor.swift — Full rewrite

The Swift native module was completely rewritten to match the new Kotlin module.

| Feature | v1 | v2 |
|---|---|---|
| Background removal | CIToneCurve brightness boost only | ML-based person segmentation (VNGeneratePersonSegmentationRequest, iOS 15+) + CIToneCurve fallback (iOS 13/14) |
| Face detection | VNDetectFaceRectanglesRequest (bounding box only) | VNDetectFaceLandmarksRequest (bounding box + eye landmarks) |
| Crown estimation | Fixed 20% above face box | Pixel-scan crown refinement (scans upward for background) |
| Photo enhancement | None | Gamma correction + histogram stretch (2–97 percentile) + unsharp mask |
| Headroom cleanup | None | forceHeadroomWhite() — flood-fill top border to white |
| Watermark | None | Semi-transparent rotated "PassportSnap" on preview; clean version returned separately |
| Auto-crop | Simple face fraction | Per-country oval specs (ovalFill, headTopMm, hairMult) matching Android exactly |
| 4×6 sheet | Single centred photo | 2-up layout with per-country print dimensions |
| Brightness | CIColorControls | Pixel-level shift, skips near-white background pixels |

### App.tsx
- RevenueCat now uses `Platform.select()` — correct key per platform

### src/screens/PaywallScreen.tsx
- Price updated from $1.49 → $1.50 (matches Android)
- Trust footer shows "Apple Pay" on iOS, "Google Play" on Android

## Files to update in passportsnap-ios repo

| File | Action |
|---|---|
| `ios/PassportSnap/PassportProcessor.swift` | REPLACE — full rewrite |
| `App.tsx` | REPLACE |
| `src/screens/PaywallScreen.tsx` | REPLACE |

## All other iOS files are unchanged
