/**
 * PreviewScreen v6.0 — On-Device Processing (no backend)
 * Uses NativeModules.PassportProcessor.makeSheet4x6() instead of HTTP fetch
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, ScrollView, Dimensions, Alert, ActivityIndicator, NativeModules, Linking, Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import PaywallScreen from './PaywallScreen';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import PassportHeadOverlay from '../components/PassportHeadOverlay';
import FloatingOrbs from '../components/FloatingOrbs';

const { PassportProcessor } = NativeModules;

type RouteParams = { processedUri: string; base64?: string; cleanBase64?: string; country?: string };

const SW = Dimensions.get('window').width;

function getPhotoSize(country?: string) {
  const maxW = SW - 48;
  const ASPECTS: Record<string, number> = {
    'GBR': 1200 / 900, 'AUS': 1200 / 900, 'CAN': 1680 / 1200,
    'SCH': 1200 / 900, 'DEU': 1200 / 900, 'ZAF': 1200 / 900,
  };
  const aspect = ASPECTS[country ?? ''];
  if (aspect) { const h = Math.round(maxW * aspect); return { w: maxW, h }; }
  return { w: maxW, h: maxW };
}

export default function PreviewScreen() {
  const navigation  = useNavigation<any>();
  const route       = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const { processedUri, base64, cleanBase64, country: countryRaw } = route.params;
  const country = countryRaw ?? 'USA';
  const countryLabel = country === 'IND' ? 'India' : country === 'GBR' ? 'UK' : country === 'AUS' ? 'Australia' : country === 'CAN' ? 'Canada' : country === 'SCH' ? 'Schengen' : country === 'DEU' ? 'Germany' : country === 'ZAF' ? 'South Africa' : 'US';

  const { w: PHOTO_W, h: PHOTO_H } = getPhotoSize(country);
  const [showOverlay, setShowOverlay] = useState(true);
  const [saving2x2, setSaving2x2] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [purchaseType, setPurchaseType] = useState<'single'|'4x6'|null>(null);
  const [saving4x6, setSaving4x6] = useState(false);

  const save2x2 = () => { setPurchaseType('single'); setShowPaywall(true); };

  const doSave2x2 = async (clean: string) => {
    try {
      setSaving2x2(true);
      const path = `${RNFS.CachesDirectoryPath}/passport_${Date.now()}.jpg`;
      await RNFS.writeFile(path, clean, 'base64');
      await CameraRoll.save(`file://${path}`, { type: 'photo' });
      Alert.alert('Saved! ✓', 'Clean passport photo saved to gallery.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save.');
    } finally { setSaving2x2(false); }
  };

  const save4x6 = async (overrideBase64?: string) => {
    const photoData = overrideBase64 ?? cleanBase64 ?? base64;
    if (!photoData) { Alert.alert('Error', 'Photo data missing.'); return; }
    try {
      setSaving4x6(true);

      // Call native module instead of HTTP API
      const data = await PassportProcessor.makeSheet4x6(photoData, country ?? 'USA');

      const sheetPath = `${RNFS.CachesDirectoryPath}/passport_4x6_${Date.now()}.jpg`;
      await RNFS.writeFile(sheetPath, data.imageBase64, 'base64');
      await CameraRoll.save(`file://${sheetPath}`, { type: 'photo' });
      Alert.alert('Saved!', '4x6 print sheet saved to gallery.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not create 4x6 sheet.');
    } finally { setSaving4x6(false); }
  };

  const askForReview = () => {
    setTimeout(() => {
      Alert.alert(
        'Enjoying PassportSnap?',
        'Your photo has been saved! If PassportSnap helped you, a quick review would mean a lot to us.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Rate us ★★★★★',
            onPress: () => {
              const storeUrl = 'https://play.google.com/store/apps/details?id=com.passportsnap';
              Linking.openURL(storeUrl).catch(() => {});
            },
          },
        ],
        { cancelable: true }
      );
    }, 1500); // Delay so the save confirmation shows first
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FloatingOrbs />
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>

        <Text style={styles.title}>Your Passport Photo</Text>
        <Text style={styles.subtitle}>{
          country === 'GBR' ? '900×1200 px  |  35×45 mm  |  UK Compliant' :
          country === 'AUS' ? '900×1200 px  |  35×45 mm  |  AU Compliant' :
          country === 'CAN' ? '1200×1680 px  |  50×70 mm  |  CA Compliant' :
          country === 'SCH' ? '900×1200 px  |  35×45 mm  |  Schengen Compliant' :
          country === 'DEU' ? '900×1200 px  |  35×45 mm  |  Germany Compliant' :
          country === 'ZAF' ? '900×1200 px  |  35×45 mm  |  South Africa Compliant' :
          '600×600 px  |  2×2 in  |  300 DPI  |  ' + countryLabel + ' Compliant'
        }</Text>

        <View
          style={[styles.photoWrap, { width: PHOTO_W, height: PHOTO_H }]}
        >
          <Image source={{ uri: processedUri }} style={{ width: PHOTO_W, height: PHOTO_H }} resizeMode="cover" />
          {showOverlay && <PassportHeadOverlay size={PHOTO_W} height={PHOTO_H} showLabels={true} country={country} />}
          <View style={styles.watermarkBadge}>
            <Text style={styles.watermarkBadgeText}>PREVIEW — Watermark removed after purchase</Text>
          </View>
        </View>

        <TouchableOpacity style={[styles.toggleBtn, showOverlay && styles.toggleBtnActive]}
          onPress={() => setShowOverlay(v => !v)} activeOpacity={0.8}>
          <Text style={[styles.toggleText, showOverlay && styles.toggleTextActive]}>
            {showOverlay ? 'Hide overlay' : 'Show overlay'}
          </Text>
        </TouchableOpacity>

        {showOverlay && (
          <View style={styles.legend}>
            <Text style={styles.legendTitle}>Overlay guide</Text>
            <View style={styles.legendRow}>
              <View style={[styles.swatch, { borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.1)' }]} />
              <Text style={styles.legendText}>
                {country === 'CAN' ? 'Green line — top of head\nHead height: 31–36mm (chin to crown)'
                  : ['GBR', 'SCH', 'DEU', 'ZAF'].includes(country) ? 'Green line — top of head\nHead height: 29–34mm (crown to chin)'
                  : country === 'AUS' ? 'Green line — top of head\nFace height: exactly 33mm (chin to crown)'
                  : 'Green lines — top of head & chin\nHead height: 1"–1⅜" (50–69%)'}
              </Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.swatch, { borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.1)' }]} />
              <Text style={styles.legendText}>
                {country === 'CAN' ? 'Blue lines — eye level zone\nEyes centred between the two blue guides'
                  : ['GBR', 'SCH', 'DEU', 'ZAF'].includes(country) ? 'Blue lines — eye level zone\nEyes in upper-middle third of photo'
                  : country === 'AUS' ? 'Blue lines — eye level zone\nEyes centred between the two blue guides'
                  : 'Blue lines — eye level zone\nEyes: 1⅛"–1⅜" from bottom (56–69%)'}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.checkCard}>
          <Text style={styles.checkTitle}>COMPLIANCE CHECKS</Text>
          {(country === 'SCH' || country === 'DEU' || country === 'ZAF' ? [
            ['Size',         '900×1200 px · 35×45 mm · ~600 DPI'],
            ['Head height',  '29–34mm crown to chin'],
            ['Top padding',  '15% above crown'],
            ['Background',   'White'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'CAN' ? [
            ['Size',         '1200×1680 px · 50×70 mm · ~610 DPI'],
            ['Head height',  '31–36mm chin to crown (target 33.5mm)'],
            ['Top padding',  '12% above crown'],
            ['Background',   'White or light-coloured'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'GBR' ? [
            ['Size',         '900×1200 px · 35×45 mm · ~600 DPI'],
            ['Head height',  '29–34mm crown to chin'],
            ['Top padding',  '15% above crown'],
            ['Background',   'White or light grey'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'AUS' ? [
            ['Size',         '900×1200 px · 35×45 mm · ~600 DPI'],
            ['Face height',  'Exactly 33mm chin to crown'],
            ['Top padding',  'Crown at oval tip'],
            ['Background',   'White or light grey'],
            ['Colours',      'Original — unchanged'],
          ] : country === 'IND' ? [
            ['Size',            '600×600 px · 2×2 in · 300 DPI'],
            ['Head height',     '50–69% of image'],
            ['Eye from bottom', '56–69%'],
            ['Background',      'White / off-white'],
            ['Colours',         'Original — unchanged'],
          ] : [
            ['Size',            '600×600 px · 2×2 in · 300 DPI'],
            ['Head height',     '1"–1⅜" · 50–69% of image'],
            ['Eye from bottom', '1⅛"–1⅜" · 56–69%'],
            ['Background',      'White / off-white'],
            ['Colours',         'Original — unchanged'],
          ]).map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.rowKey}>{k}</Text>
              <Text style={styles.rowVal}>{v}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.dlTitle}>Download</Text>

        <TouchableOpacity style={styles.btn2x2} onPress={save2x2} disabled={saving2x2} activeOpacity={0.85}>
          {saving2x2 ? <ActivityIndicator color="#fff" /> : (
            <>
              <Text style={styles.btn2x2Icon}>2x2</Text>
              <View>
                <Text style={styles.btn2x2Label}>Save 2x2 Photo</Text>
                <Text style={styles.btn2x2Sub}>Single passport photo · No watermark · $1.50</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn4x6} onPress={() => { setPurchaseType('4x6'); setShowPaywall(true); }}
          disabled={saving4x6} activeOpacity={0.85}>
          {saving4x6 ? <ActivityIndicator color="#3B5BDB" /> : (
            <>
              <Text style={styles.btn4x6Icon}>4x6</Text>
              <View>
                <Text style={styles.btn4x6Label}>Save 4x6 Print Sheet</Text>
                <Text style={styles.btn4x6Sub}>2 photos side by side · No watermark · $1.50</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.againBtn} onPress={() => navigation.navigate('CountrySelect')}>
          <Text style={styles.againText}>Start over</Text>
        </TouchableOpacity>

        {/* ── TEST MODE: Free download (no paywall) ── */}
        <View style={styles.testSection}>
          <Text style={styles.testTitle}>🧪 TEST MODE</Text>
          <TouchableOpacity style={styles.testBtn} onPress={() => doSave2x2(cleanBase64 ?? base64 ?? '')} disabled={saving2x2} activeOpacity={0.8}>
            {saving2x2 ? <ActivityIndicator color="#F59E0B" /> : <Text style={styles.testBtnText}>⬇ Save Single Photo (Free)</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.testBtn} onPress={() => save4x6()} disabled={saving4x6} activeOpacity={0.8}>
            {saving4x6 ? <ActivityIndicator color="#F59E0B" /> : <Text style={styles.testBtnText}>⬇ Save 4×6 Sheet (Free)</Text>}
          </TouchableOpacity>
        </View>

      </ScrollView>

      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} country={country}
        onPurchased={async (type) => {
          setShowPaywall(false);
          if (type === 'single') { await doSave2x2(cleanBase64 ?? base64 ?? ''); }
          else { await save4x6(cleanBase64 ?? base64 ?? ''); }
          askForReview();
        }}
      />
    </SafeAreaView>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', accentLight: 'rgba(43,89,195,0.15)',
  emerald: '#1DB954', gold: '#F5A623',
};
const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  scroll:      { padding: 24, paddingBottom: 48, alignItems: 'center' },
  title:       { fontSize: 20, fontWeight: '700', color: C.text1, letterSpacing: -0.3, marginBottom: 4 },
  subtitle:    { fontSize: 12, color: C.text3, marginBottom: 20, textAlign: 'center' },
  photoWrap:   { borderRadius: 6, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: C.border, position: 'relative' },
  watermarkBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(12,15,26,0.75)', paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center' },
  watermarkBadgeText: { color: C.gold, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  toggleBtn:       { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  toggleBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  toggleText:      { fontSize: 12, color: C.text2, fontWeight: '600' },
  toggleTextActive:{ color: '#FFFFFF' },
  legend:      { alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  legendTitle: { fontSize: 10, fontWeight: '700', color: C.gold, letterSpacing: 1.5, marginBottom: 10 },
  legendRow:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  swatch:      { width: 22, height: 14, borderRadius: 3, borderWidth: 2, marginRight: 8, marginTop: 2 },
  legendText:  { fontSize: 12, color: C.text2, flex: 1, lineHeight: 17 },
  checkCard:   { alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  checkTitle:  { fontSize: 10, fontWeight: '700', color: C.gold, letterSpacing: 1.5, marginBottom: 10 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7, flexWrap: 'wrap' },
  rowKey:      { fontSize: 13, fontWeight: '600', color: C.text1, flex: 1 },
  rowVal:      { fontSize: 12, color: C.text2, flex: 1.5, textAlign: 'right' },
  dlTitle:     { fontSize: 14, fontWeight: '700', color: C.text1, alignSelf: 'flex-start', marginBottom: 10 },
  btn2x2:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch', marginBottom: 10 },
  btn2x2Icon:  { fontSize: 12, fontWeight: '700', color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden', minWidth: 38, textAlign: 'center' },
  btn2x2Label: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  btn2x2Sub:   { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  btn4x6:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch', marginBottom: 20, borderWidth: 1, borderColor: C.border },
  btn4x6Icon:  { fontSize: 12, fontWeight: '700', color: '#4A7AE8', backgroundColor: C.accentLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden', minWidth: 38, textAlign: 'center' },
  btn4x6Label: { color: C.text1, fontSize: 15, fontWeight: '600' },
  btn4x6Sub:   { color: C.text3, fontSize: 11 },
  againBtn:    { paddingVertical: 14, paddingHorizontal: 36, marginTop: 8, backgroundColor: C.surface, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  againText:   { color: C.text2, fontSize: 15, fontWeight: '600' },
  testSection: { alignSelf: 'stretch', marginTop: 20, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: C.gold, borderStyle: 'dashed', backgroundColor: 'rgba(245,166,35,0.05)' },
  testTitle:   { fontSize: 11, fontWeight: '700', color: C.gold, letterSpacing: 1, marginBottom: 10, textAlign: 'center' },
  testBtn:     { backgroundColor: 'rgba(245,166,35,0.10)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(245,166,35,0.30)' },
  testBtnText: { color: C.gold, fontSize: 14, fontWeight: '600' },
});
