/**
 * PassportHeadOverlay.tsx v3.4
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXED: Pixel 7/8 rendering failure for non-square overlays (UK, AUS, CAN, etc.)
 * 
 * Root cause: nested needsOffscreenAlphaCompositing + renderToHardwareTextureAndroid
 * causes Android GPU compositor to skip rendering transparent PNGs when the image
 * aspect ratio is non-square (900x1200, 1200x1680).
 * 
 * Fix: Render a bare <Image> with no wrapping View. Use opacity: 0.999 to force
 * Android to create a hardware layer without the buggy compositing path.
 * No View wrapper, no needsOffscreenAlphaCompositing, no renderToHardwareTextureAndroid.
 */
import React from 'react'
import { Image as RNImage, Platform } from 'react-native'

const OVERLAYS: Record<string, any> = {
  USA: require('../assets/passport_overlay_us.png'),
  IND: require('../assets/passport_overlay_us.png'),
  GBR: require('../assets/passport_overlay_uk.png'),
  AUS: require('../assets/passport_overlay_aus.png'),
  CAN: require('../assets/passport_overlay_can.png'),
  SCH: require('../assets/passport_overlay_sch.png'),
  DEU: require('../assets/passport_overlay_sch.png'),
  ZAF: require('../assets/passport_overlay_sch.png'),
}

interface Props {
  size: number
  height?: number
  showLabels?: boolean
  country?: string
}

export default function PassportHeadOverlay({ size, height, country }: Props) {
  const overlayH = height ?? size
  const code = country ?? 'USA'
  const source = OVERLAYS[code] ?? OVERLAYS.USA

  return (
    <RNImage
      source={source}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size,
        height: overlayH,
        zIndex: 10,
        opacity: Platform.OS === 'android' ? 0.999 : 1,
      }}
      pointerEvents="none"
      resizeMode="stretch"
      fadeDuration={0}
    />
  )
}
