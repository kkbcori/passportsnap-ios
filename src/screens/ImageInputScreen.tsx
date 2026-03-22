/**
 * ImageInputScreen v8 — Professional upload flow
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, Alert, ActivityIndicator, ScrollView, StatusBar,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import FloatingOrbs from '../components/FloatingOrbs';

type RouteParams = { country: string };

const INFO: Record<string, { name: string; flag: string; dimLine: string; specs: string[] }> = {
  USA: { name: 'US Passport Photo', flag: '🇺🇸', dimLine: '600×600 px  ·  2×2 in  ·  300 DPI', specs: [
    '2×2 inch (51×51 mm) square photo',
    'Head height 1"–1⅜" (50–69% of image)',
    'Eyes 1⅛"–1⅜" from bottom (56–69%)',
    'White or off-white background',
    'Neutral expression, both eyes open',
    'No glasses, hats, or head coverings',
  ]},
  IND: { name: 'India Passport Photo', flag: '🇮🇳', dimLine: '600×600 px  ·  2×2 in  ·  300 DPI', specs: [
    '2×2 inch (51×51 mm) square photo',
    'Head height 50–69% of image',
    'Eyes between 56–69% from bottom',
    'White or off-white background',
    'Neutral expression, both eyes open',
    'No glasses, hats, or head coverings',
  ]},
  GBR: { name: 'UK Passport Photo', flag: '🇬🇧', dimLine: '900×1200 px  ·  35×45 mm  ·  ~600 DPI', specs: [
    '35mm wide × 45mm high portrait',
    'Head height 29–34mm (crown to chin)',
    'White or light grey background',
    'Neutral expression, mouth closed',
    'No glasses, hats, or head coverings',
  ]},
  AUS: { name: 'Australia Passport Photo', flag: '🇦🇺', dimLine: '900×1200 px  ·  35×45 mm  ·  ~600 DPI', specs: [
    '35mm wide × 45mm high portrait',
    'Face height exactly 33mm (chin to crown)',
    'White or light grey background',
    'Neutral expression, eyes open',
    'No glasses, hats, or head coverings',
  ]},
  CAN: { name: 'Canada Passport Photo', flag: '🇨🇦', dimLine: '1200×1680 px  ·  50×70 mm  ·  ~610 DPI', specs: [
    '50mm wide × 70mm high (2" × 2¾")',
    'Head height 31–36mm (chin to crown)',
    'White or light-coloured background',
    'Neutral expression, mouth closed',
    'Both eyes open, clearly visible',
    'No glasses, hats, or head coverings',
  ]},
  SCH: { name: 'Schengen Visa Photo', flag: '🇪🇺', dimLine: '900×1200 px  ·  35×45 mm  ·  ~600 DPI', specs: [
    '35mm wide × 45mm high portrait',
    'Head height 29–34mm (crown to chin)',
    'White background (plain, no patterns)',
    'Neutral expression, mouth closed',
    'No glasses, hats, or head coverings',
  ]},
  DEU: { name: 'Germany Passport Photo', flag: '🇩🇪', dimLine: '900×1200 px  ·  35×45 mm  ·  ~600 DPI', specs: [
    '35mm wide × 45mm high portrait',
    'Head height 29–34mm (crown to chin)',
    'White background (plain, no patterns)',
    'Neutral expression, mouth closed',
    'No glasses, hats, or head coverings',
  ]},
  ZAF: { name: 'South Africa Passport Photo', flag: '🇿🇦', dimLine: '900×1200 px  ·  35×45 mm  ·  ~600 DPI', specs: [
    '35mm wide × 45mm high portrait',
    'Head height 29–34mm (crown to chin)',
    'White background (plain, no patterns)',
    'Neutral expression, mouth closed',
    'No glasses, hats, or head coverings',
  ]},
};

export default function ImageInputScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const country = route.params?.country ?? 'USA';
  const info = INFO[country] ?? INFO.USA;

  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pick = async () => {
    const r = await launchImageLibrary({ mediaType: 'photo', quality: 1 });
    if (!r.didCancel && r.assets?.[0]?.uri) setUri(r.assets[0].uri);
  };

  const go = () => {
    if (!uri) { Alert.alert('No photo', 'Select a photo first.'); return; }
    navigation.navigate('Processing', { photoUri: uri, country });
  };

  return (
    <SafeAreaView style={s.safe}>
      <FloatingOrbs />
      <StatusBar barStyle="light-content" backgroundColor="#0C0F1A" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{top:12,bottom:12,left:12,right:12}}>
          <Text style={s.back}>←  Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Country header */}
        <View style={s.countryRow}>
          <Text style={s.countryFlag}>{info.flag}</Text>
          <View>
            <Text style={s.countryName}>{info.name}</Text>
            <Text style={s.countryDim}>{info.dimLine}</Text>
          </View>
        </View>

        {/* Requirements */}
        <View style={s.specCard}>
          <Text style={s.specLabel}>SPECIFICATIONS</Text>
          {info.specs.map((sp, i) => (
            <View key={i} style={s.specRow}>
              <Text style={s.specBullet}>•</Text>
              <Text style={s.specText}>{sp}</Text>
            </View>
          ))}
        </View>

        {/* Upload area */}
        <TouchableOpacity style={[s.upload, uri && s.uploadFilled]} onPress={pick} activeOpacity={0.75}>
          {uri
            ? <Image source={{ uri }} style={s.preview} />
            : <View style={s.uploadEmpty}>
                <View style={s.uploadIconWrap}>
                  <Text style={s.uploadIconT}>↑</Text>
                </View>
                <Text style={s.uploadTitle}>Select photo from gallery</Text>
                <Text style={s.uploadSub}>JPEG or PNG · Any resolution</Text>
              </View>
          }
        </TouchableOpacity>

        {uri && (
          <TouchableOpacity onPress={pick} style={s.changeWrap}>
            <Text style={s.changeT}>Choose a different photo</Text>
          </TouchableOpacity>
        )}

        {/* Process */}
        <TouchableOpacity
          style={[s.btn, !uri && s.btnOff]}
          onPress={go}
          disabled={!uri || loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={[s.btnT, !uri && s.btnTOff]}>Process Photo</Text>
          }
        </TouchableOpacity>

        <Text style={s.note}>Your original photo colours are preserved unchanged.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', emerald: '#1DB954', gold: '#F5A623',
};

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },

  header:      { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4 },
  back:        { fontSize: 14, color: '#4A7AE8', fontWeight: '500' },

  scroll:      { padding: 24, paddingTop: 8, paddingBottom: 40 },

  countryRow:  { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  countryFlag: { fontSize: 36 },
  countryName: { fontSize: 20, fontWeight: '700', color: C.text1 },
  countryDim:  { fontSize: 12, color: C.text3, marginTop: 2 },

  specCard:    { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 24,
                 borderWidth: 1, borderColor: C.border },
  specLabel:   { fontSize: 10, fontWeight: '700', color: C.gold, letterSpacing: 1.5, marginBottom: 10 },
  specRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  specBullet:  { fontSize: 14, color: C.emerald, marginRight: 8, marginTop: -1, fontWeight: '700' },
  specText:    { fontSize: 13, color: C.text2, lineHeight: 18, flex: 1 },

  upload:      { borderRadius: 14, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed',
                 minHeight: 200, overflow: 'hidden', marginBottom: 12, backgroundColor: C.surface },
  uploadFilled:{ borderStyle: 'solid', borderColor: C.border, backgroundColor: C.bg },
  uploadEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  uploadIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent,
                    alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  uploadIconT: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  uploadTitle: { fontSize: 15, fontWeight: '600', color: C.text1 },
  uploadSub:   { fontSize: 12, color: C.text3, marginTop: 4 },
  preview:     { width: '100%', height: 280, resizeMode: 'contain' },

  changeWrap:  { alignSelf: 'center', marginBottom: 16 },
  changeT:     { color: '#4A7AE8', fontSize: 13, fontWeight: '500' },

  btn:         { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16,
                 alignItems: 'center', marginBottom: 16 },
  btnOff:      { backgroundColor: C.border },
  btnT:        { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  btnTOff:     { color: C.text3 },

  note:        { textAlign: 'center', fontSize: 11, color: C.text3 },
});
