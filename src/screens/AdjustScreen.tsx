/**
 * AdjustScreen v3.1 — On-Device Processing (no backend)
 * Uses NativeModules.PassportProcessor.crop() instead of HTTP fetch
 *
 * Fix: Removed elevation from overlay wrapper — on Android, elevation on a
 * View containing a transparent PNG can cause the image to not render for
 * certain aspect ratios (Canada 50x70, Australia 35x45). Using zIndex alone
 * + needsOffscreenAlphaCompositing handles layering correctly.
 */
import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, Dimensions, PanResponder, ScrollView,
  ActivityIndicator, Alert, Platform, NativeModules,
} from 'react-native';
import PassportHeadOverlay from '../components/PassportHeadOverlay';
import FloatingOrbs from '../components/FloatingOrbs';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import RNFS from 'react-native-fs';

const { PassportProcessor } = NativeModules;

const SAMPLE_IMAGES: Record<string, any> = {
  USA: require('../assets/sample_reference.png'),
  IND: require('../assets/sample_reference.png'),
  GBR: require('../assets/sample_reference_35x45.png'),
  AUS: require('../assets/sample_reference_35x45.png'),
  SCH: require('../assets/sample_reference_35x45.png'),
  DEU: require('../assets/sample_reference_35x45.png'),
  ZAF: require('../assets/sample_reference_35x45.png'),
  CAN: require('../assets/sample_reference_50x70.png'),
};

// ─── Types ────────────────────────────────────────────────────────────────────
type RouteParams = {
  preparedUri:    string;
  preparedBase64: string;
  origW:          number;
  origH:          number;
  country?:       string;
  autoCrop?:      { x: number; y: number; w: number; h: number };
};

// ─── Screen dimensions ────────────────────────────────────────────────────────
const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;

function getOverlaySize(country?: string) {
  const maxW = SW - 32;
  const maxH = SH - 320;
  const ASPECTS: Record<string, number> = {
    'GBR': 1200 / 933, 'AUS': 1200 / 933, 'CAN': 1680 / 1200,
    'SCH': 1200 / 933, 'DEU': 1200 / 933, 'ZAF': 1200 / 933,
  };
  const aspect = ASPECTS[country ?? ''];
  if (aspect) {
    let w = maxW; let h = Math.round(w * aspect);
    if (h > maxH) { h = maxH; w = Math.round(h / aspect); }
    return { w, h };
  }
  return { w: maxW, h: maxW };
}

const NUDGE_PX = 8;
const ZOOM_STEP_ADJ = 0.01; // alias kept for clarity

// Per-country auto-positioning.
// zoomSteps: subtracted from base auto-crop scale (1 step = 1% zoom out).
// tyOffset:  px offset on initial ty. Now 0 — Swift prepare() handles positioning.
const COUNTRY_AUTO_ADJ: Record<string, { zoomSteps: number; tyOffset: number }> = {
  USA: { zoomSteps: 4, tyOffset: 0 },
  IND: { zoomSteps: 4, tyOffset: 0 },
  GBR: { zoomSteps: 4, tyOffset: 0 },
  SCH: { zoomSteps: 4, tyOffset: 0 },
  DEU: { zoomSteps: 4, tyOffset: 0 },
  ZAF: { zoomSteps: 4, tyOffset: 0 },
  AUS: { zoomSteps: 4, tyOffset: 0 },
  CAN: { zoomSteps: 3, tyOffset: 0 },
};
const ZOOM_STEP = 0.01;

export default function AdjustScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const { preparedUri, preparedBase64, origW, origH, country: countryRaw, autoCrop } = route.params;
  const country = countryRaw ?? 'USA';
  const { w: OVW, h: OVH } = getOverlaySize(country);

  // MIN_SCALE must be declared BEFORE computeAutoTransform() is called
  const MIN_SCALE = 0.05; const MAX_SCALE = 4.0;

  function computeAutoTransform() {
    const adj = COUNTRY_AUTO_ADJ[country] ?? { zoomSteps: 0, tyOffset: 0 };
    if (autoCrop && autoCrop.w > 0 && autoCrop.h > 0) {
      const sBase = OVW / autoCrop.w;
      const s  = Math.max(MIN_SCALE, sBase - adj.zoomSteps * ZOOM_STEP);
      const tx = -(autoCrop.x + autoCrop.w / 2 - origW / 2) * s;
      const ty = -(autoCrop.y + autoCrop.h / 2 - origH / 2) * s + adj.tyOffset;
      return { scale: s, tx, ty };
    }
    const sBase = Math.max(OVW / origW, OVH / origH);
    const s = Math.max(MIN_SCALE, sBase - adj.zoomSteps * ZOOM_STEP);
    return { scale: s, tx: 0, ty: adj.tyOffset };
  }

  // MIN_SCALE must be declared BEFORE computeAutoTransform() —
  // const is not hoisted; accessing it before declaration = undefined → NaN scale → blank screen
  const MIN_SCALE = 0.05; const MAX_SCALE = 4.0;

  const autoT = computeAutoTransform();
  const BRIGHTNESS_STEP = 5;
  const MIN_BRIGHTNESS = -50; const MAX_BRIGHTNESS = 50;

  const scaleRef = useRef(autoT.scale);
  const txRef = useRef(autoT.tx);
  const tyRef = useRef(autoT.ty);
  const brightnessRef = useRef(0);
  const [transform, setTransform] = useState({ scale: autoT.scale, tx: autoT.tx, ty: autoT.ty });
  const [brightness, setBrightness] = useState(0);

  const lastMidX = useRef(0); const lastMidY = useRef(0);
  const dragActive = useRef(false);
  const DRAG_THRESHOLD = 8;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, gs) => {
        const absX = Math.abs(gs.dx); const absY = Math.abs(gs.dy);
        if (absY > absX * 2.0 && absX < 10) return false;
        return Math.sqrt(absX * absX + absY * absY) > DRAG_THRESHOLD;
      },
      onPanResponderGrant: (e) => {
        const t = e.nativeEvent.touches;
        if (t.length >= 1) {
          lastMidX.current = t[0].pageX; lastMidY.current = t[0].pageY;
          dragActive.current = true;
        }
      },
      onPanResponderMove: (e) => {
        if (!dragActive.current) return;
        const t = e.nativeEvent.touches;
        if (t.length === 1) {
          txRef.current += t[0].pageX - lastMidX.current;
          tyRef.current += t[0].pageY - lastMidY.current;
          lastMidX.current = t[0].pageX; lastMidY.current = t[0].pageY;
          setTransform({ scale: scaleRef.current, tx: txRef.current, ty: tyRef.current });
        }
      },
      onPanResponderRelease: () => { dragActive.current = false; },
    })
  ).current;

  const nudge = (dx: number, dy: number) => {
    txRef.current += dx; tyRef.current += dy;
    setTransform({ scale: scaleRef.current, tx: txRef.current, ty: tyRef.current });
  };
  const zoom = (delta: number) => {
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleRef.current + delta));
    scaleRef.current = ns;
    setTransform({ scale: ns, tx: txRef.current, ty: tyRef.current });
  };
  const adjustBrightness = (delta: number) => {
    const nb = Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, brightnessRef.current + delta));
    brightnessRef.current = nb;
    setBrightness(nb);
  };
  const resetTransform = useCallback(() => {
    const t = computeAutoTransform();
    scaleRef.current = t.scale; txRef.current = t.tx; tyRef.current = t.ty;
    brightnessRef.current = 0;
    setTransform({ scale: t.scale, tx: t.tx, ty: t.ty });
    setBrightness(0);
  }, [autoCrop, OVW, origW, origH]);

  const [confirming, setConfirming] = useState(false);

  const confirm = async () => {
    try {
      setConfirming(true);
      const { scale, tx, ty } = transform;

      const cropX = Math.round((0 - (OVW / 2 + tx)) / scale + origW / 2);
      const cropY = Math.round((0 - (OVH / 2 + ty)) / scale + origH / 2);
      const cropW = Math.round(OVW / scale);
      const cropH = Math.round(OVH / scale);

      const outW = country === 'CAN' ? 1200 : ['GBR', 'AUS', 'SCH', 'DEU', 'ZAF'].includes(country) ? 933 : 600;
      const outH = country === 'CAN' ? 1680 : ['GBR', 'AUS', 'SCH', 'DEU', 'ZAF'].includes(country) ? 1200 : 600;

      // Call native module instead of HTTP API
      const data = await PassportProcessor.crop(
        preparedBase64, cropX, cropY, cropW, cropH, outW, outH, country, brightness
      );

      const outputPath = `${RNFS.CachesDirectoryPath}/passport_${Date.now()}.jpg`;
      await RNFS.writeFile(outputPath, data.imageBase64, 'base64');

      navigation.replace('Preview', {
        processedUri: `file://${outputPath}`,
        base64: data.imageBase64,
        cleanBase64: data.cleanBase64 ?? data.imageBase64,
        country,
      });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not crop photo. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  const photoW = origW * transform.scale;
  const photoH = origH * transform.scale;
  const photoLeft = OVW / 2 - photoW / 2 + transform.tx;
  const photoTop = OVH / 2 - photoH / 2 + transform.ty;
  const zoomPct = Math.round(transform.scale * 100);

  return (
    <SafeAreaView style={styles.safe}>
      <FloatingOrbs />
      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Review & Adjust</Text>
          <Text style={styles.headerSub}>Use arrows to move, +/− to zoom, or drag with finger</Text>
        </View>

        <View style={styles.hintNote}>
          <View style={styles.hintRow}>
            <Image source={SAMPLE_IMAGES[country] ?? SAMPLE_IMAGES.USA} style={styles.sampleImage} resizeMode="contain" />
            <View style={styles.hintPoints}>
              <Text style={styles.hintPointTitle}>ALIGNMENT GUIDE</Text>
              <Text style={styles.hintBullet}>✓  Chin does not extend beyond the outer oval</Text>
              <Text style={styles.hintBullet}>✓  Eyes between the blue lines</Text>
              <Text style={styles.hintBullet}>✓  Face fills the inner dashed oval</Text>
              <Text style={styles.hintBullet}>✓  Vertical line through nose</Text>
            </View>
          </View>
        </View>

        <View style={styles.gestureOuter}>
          {/* 
            gestureBox: the clipping container for photo + overlay.
            Fixed v3.3: removed nested needsOffscreenAlphaCompositing — 
            triple-nested compositing causes Android to skip rendering
            the overlay on some device/country combos (UK, AUS).
            The overlay Image itself handles compositing via opacity: 0.999.
          */}
          <View
            style={[styles.gestureBox, { width: OVW, height: OVH }]}
            {...panResponder.panHandlers}
          >
            {/* Photo layer */}
            <Image source={{ uri: preparedUri }}
              style={{ position: 'absolute', width: photoW, height: photoH, left: photoLeft, top: photoTop }}
              resizeMode="cover" />
            {/* Live brightness preview overlay */}
            {brightness !== 0 && (
              <View
                style={{
                  position: 'absolute',
                  width: photoW,
                  height: photoH,
                  left: photoLeft,
                  top: photoTop,
                  backgroundColor: brightness > 0
                    ? `rgba(255,255,255,${Math.min(brightness / 100, 0.4)})`
                    : `rgba(0,0,0,${Math.min(Math.abs(brightness) / 100, 0.4)})`,
                }}
                pointerEvents="none"
              />
            )}
            {/* Overlay — rendered directly, no wrapper View */}
            <PassportHeadOverlay size={OVW} height={OVH} showLabels={true} country={country} />
          </View>
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.dpad}>
            <View style={styles.dpadRow}>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => nudge(0, -NUDGE_PX)} activeOpacity={0.6}>
                <Text style={styles.arrowText}>▲</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dpadRow}>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => nudge(-NUDGE_PX, 0)} activeOpacity={0.6}>
                <Text style={styles.arrowText}>◀</Text>
              </TouchableOpacity>
              <View style={styles.dpadCenter}><Text style={styles.dpadLabel}>Move</Text></View>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => nudge(NUDGE_PX, 0)} activeOpacity={0.6}>
                <Text style={styles.arrowText}>▶</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dpadRow}>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => nudge(0, NUDGE_PX)} activeOpacity={0.6}>
                <Text style={styles.arrowText}>▼</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.zoomControls}>
            <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(ZOOM_STEP)} activeOpacity={0.6}>
              <Text style={styles.zoomBtnText}>＋</Text>
            </TouchableOpacity>
            <View style={styles.zoomLabel}>
              <Text style={styles.zoomPct}>{zoomPct}%</Text>
              <Text style={styles.zoomTitle}>Zoom</Text>
            </View>
            <TouchableOpacity style={styles.zoomBtn} onPress={() => zoom(-ZOOM_STEP)} activeOpacity={0.6}>
              <Text style={styles.zoomBtnText}>−</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.zoomControls}>
            <TouchableOpacity style={styles.zoomBtn} onPress={() => adjustBrightness(BRIGHTNESS_STEP)} activeOpacity={0.6}>
              <Text style={styles.zoomBtnText}>☀</Text>
            </TouchableOpacity>
            <View style={styles.zoomLabel}>
              <Text style={styles.zoomPct}>{brightness > 0 ? `+${brightness}` : brightness}</Text>
              <Text style={styles.zoomTitle}>Bright</Text>
            </View>
            <TouchableOpacity style={styles.zoomBtn} onPress={() => adjustBrightness(-BRIGHTNESS_STEP)} activeOpacity={0.6}>
              <Text style={styles.zoomBtnText}>🌙</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.resetBtn} onPress={resetTransform} activeOpacity={0.8}>
            <Text style={styles.resetText}>↺  Auto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.confirmBtn, confirming && styles.confirmBtnDisabled]}
            onPress={confirm} disabled={confirming} activeOpacity={0.85}>
            {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Looks Good  →</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#0C0F1A' },
  scrollContent: { flexGrow: 1, paddingBottom: 16 },
  header:        { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  headerTitle:   { fontSize: 18, fontWeight: '700', color: '#F0F2FF', letterSpacing: -0.2 },
  headerSub:     { fontSize: 11, color: '#6B7294', marginTop: 2 },
  gestureOuter:  { alignItems: 'center', marginVertical: 8 },
  gestureBox:    { overflow: 'hidden', backgroundColor: '#FFFFFF', borderRadius: 6, borderWidth: 1, borderColor: '#2B59C3' },
  hintNote:      { paddingHorizontal: 16, paddingVertical: 6, marginBottom: 4 },
  hintRow:       { flexDirection: 'row', backgroundColor: 'rgba(43,89,195,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(43,89,195,0.20)', padding: 10, gap: 12, alignItems: 'flex-start' },
  sampleImage:   { width: 100, height: 100, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(43,89,195,0.25)' },
  hintPoints:    { flex: 1, gap: 6 },
  hintPointTitle:{ fontSize: 9, fontWeight: '700', color: '#F5A623', letterSpacing: 1.5, marginBottom: 2 },
  hintBullet:    { fontSize: 10.5, color: '#A8B1CC', lineHeight: 15 },
  controlsRow:   { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  dpad:          { alignItems: 'center' },
  dpadRow:       { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  dpadCenter:    { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  dpadLabel:     { fontSize: 9, color: '#6B7294', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  arrowBtn:      { width: 44, height: 44, borderRadius: 12, backgroundColor: '#151929', justifyContent: 'center', alignItems: 'center', margin: 2, borderWidth: 1, borderColor: '#1E2438' },
  arrowText:     { fontSize: 16, color: '#A8B1CC' },
  zoomControls:  { alignItems: 'center', gap: 6 },
  zoomBtn:       { width: 52, height: 44, borderRadius: 12, backgroundColor: '#151929', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#1E2438' },
  zoomBtnText:   { fontSize: 22, color: '#A8B1CC', fontWeight: '300', lineHeight: 26 },
  zoomLabel:     { alignItems: 'center', paddingVertical: 2 },
  zoomPct:       { fontSize: 15, color: '#F0F2FF', fontWeight: '700' },
  zoomTitle:     { fontSize: 9, color: '#6B7294', fontWeight: '600', textTransform: 'uppercase' },
  actions:       { flexDirection: 'row', paddingHorizontal: 20, gap: 12, paddingBottom: Platform.OS === 'android' ? 16 : 0 },
  resetBtn:      { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#151929', alignItems: 'center', borderWidth: 1, borderColor: '#1E2438' },
  resetText:     { color: '#6B7294', fontSize: 14, fontWeight: '600' },
  confirmBtn:    { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#2B59C3', alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmText:   { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
