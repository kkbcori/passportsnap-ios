/**
 * WelcomeScreen v8 — Professional trust-forward redesign
 * No emojis. Clean typography. Government-grade feel.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, ScrollView, StatusBar, Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import FloatingOrbs from '../components/FloatingOrbs';

const APP_ICON = require('../assets/app_icon.png');
const CORRECT_PHOTO = require('../assets/correct_photo.png');
const WRONG_PHOTO = require('../assets/wrong_photo.png');

const TIPS = [
  { title: 'Plain white or off-white wall',      body: 'No patterns, textures, or posters behind you.' },
  { title: 'Even, natural lighting',              body: 'Face a window. Avoid harsh overhead or side lighting.' },
  { title: 'No shadows on face or background',    body: 'Step forward from the wall to eliminate shadows.' },
  { title: 'Face the camera directly',             body: 'Head straight and level, centred in the frame.' },
  { title: 'Neutral expression, eyes open',        body: 'Mouth closed, relaxed face, both eyes clearly visible.' },
  { title: 'Remove glasses and hats',             body: 'No eyewear, headwear, or coverings unless exempt.' },
  { title: 'Wear everyday, non-white clothing',   body: 'No uniforms, camouflage, or white tops.' },
];

function DosDontsGuide() {
  const wrongScale = useRef(new Animated.Value(0)).current;
  const rightScale = useRef(new Animated.Value(0)).current;
  const crossScale = useRef(new Animated.Value(0)).current;
  const tickScale = useRef(new Animated.Value(0)).current;
  const crossPulse = useRef(new Animated.Value(1)).current;
  const tickPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // Photos pop in and stay steady
      Animated.spring(wrongScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.delay(300),
      // Red X pops in
      Animated.spring(crossScale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: true }),
      Animated.delay(200),
      // Correct photo pops in
      Animated.spring(rightScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.delay(300),
      // Green tick pops in
      Animated.spring(tickScale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: true }),
    ]).start(() => {
      // Continuous pulse on X badge
      Animated.loop(Animated.sequence([
        Animated.timing(crossPulse, { toValue: 1.25, duration: 800, useNativeDriver: true }),
        Animated.timing(crossPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])).start();
      // Continuous pulse on tick badge (offset timing)
      setTimeout(() => {
        Animated.loop(Animated.sequence([
          Animated.timing(tickPulse, { toValue: 1.25, duration: 900, useNativeDriver: true }),
          Animated.timing(tickPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])).start();
      }, 400);
    });
  }, []);

  return (
    <View style={s.dosSection}>
      <Text style={s.dosTitle}>QUICK GUIDE</Text>
      <View style={s.dosRow}>
        {/* WRONG — steady card */}
        <Animated.View style={[s.dosCard, s.dosCardWrong, {
          transform: [{ scale: wrongScale }]
        }]}>
          <Image source={WRONG_PHOTO} style={s.dosPhoto} resizeMode="cover" />
          <Animated.View style={[s.dosMarkWrap, {
            transform: [{ scale: Animated.multiply(crossScale, crossPulse) }],
            opacity: crossScale,
          }]}>
            <Text style={s.dosCross}>✕</Text>
          </Animated.View>
          <Text style={s.dosLabelWrong}>Glasses, hat, laughing</Text>
        </Animated.View>

        {/* RIGHT — steady card */}
        <Animated.View style={[s.dosCard, s.dosCardRight, {
          transform: [{ scale: rightScale }]
        }]}>
          <Image source={CORRECT_PHOTO} style={s.dosPhoto} resizeMode="cover" />
          <Animated.View style={[s.dosMarkWrap, s.dosMarkRight, {
            transform: [{ scale: Animated.multiply(tickScale, tickPulse) }],
            opacity: tickScale,
          }]}>
            <Text style={s.dosTick}>✓</Text>
          </Animated.View>
          <Text style={s.dosLabelRight}>Neutral, no accessories</Text>
        </Animated.View>
      </View>
    </View>
  );
}

export default function WelcomeScreen() {
  const [guaranteeVisible, setGuaranteeVisible] = useState(false);
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={s.safe}>
      <FloatingOrbs />
      <StatusBar barStyle="light-content" backgroundColor="#0C0F1A" />

      {/* Fixed header with logo */}
      <View style={s.headerBar}>
        <Image source={APP_ICON} style={s.logoIcon} />
        <Text style={s.logoName}>Passport<Text style={s.logoSnap}>Snap</Text></Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollInner} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <Text style={s.heroTitle}>Get your passport photo{'\n'}accepted — first time.</Text>
        <Text style={s.heroSub}>
          Upload a photo, we'll process it to meet official specifications for 8 countries. Takes under 60 seconds.
        </Text>

        {/* Do's & Don'ts — animated face guide */}
        <DosDontsGuide />

        {/* Checklist */}
        <View style={s.section}>
          <Text style={s.secTitle}>PHOTO REQUIREMENTS</Text>
          <View style={s.checklist}>
            {TIPS.map((t, i) => (
              <View key={i} style={[s.checkRow, i < TIPS.length - 1 && s.checkRowBdr]}>
                <View style={s.checkNum}><Text style={s.checkNumT}>{i + 1}</Text></View>
                <View style={s.checkBody}>
                  <Text style={s.checkTitle}>{t.title}</Text>
                  <Text style={s.checkSub}>{t.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>

      {/* Sticky CTA */}
      <View style={s.foot}>
        <TouchableOpacity style={s.cta} onPress={() => navigation.replace('CountrySelect')} activeOpacity={0.85}>
          <Text style={s.ctaT}>Get Started</Text>
          <Text style={s.ctaArrow}>→</Text>
        </TouchableOpacity>
        <Text style={s.footNote}>Free to try · Pay only when you download</Text>
        <Text style={s.guarantee} onPress={() => setGuaranteeVisible(true)}>
          ↩ Money-back guarantee*
        </Text>
      </View>

      {/* Money-back guarantee modal */}
      {guaranteeVisible && (
        <View style={s.guaranteeOverlay}>
          <View style={s.guaranteeCard}>
            <Text style={s.guaranteeTitle}>↩ Refund Policy</Text>
                        <Text style={s.guaranteeBody}>
              We stand behind every photo PassportSnap produces. For the best result, follow the on-screen guide — align the crown of your head with the green line, keep your eyes between the blue lines, and fill the inner oval with your face.
            </Text>
            <Text style={[s.guaranteeBody, { marginTop: 10 }]}>
              If you do this correctly and your photo is still rejected by the issuing authority due to a <Text style={s.guaranteeEmphasis}>technical compliance issue</Text> (wrong dimensions, background colour or head size), send us the rejection notice and we will refund your $1.50 in full — no questions asked.
            </Text>
            <Text style={s.guaranteeSmall}>
              * Covers technical compliance failures only. Rejections due to personal appearance (expression, glasses, head covering or attire) are outside our control and are not eligible.
            </Text>
            <TouchableOpacity style={s.guaranteeClose} onPress={() => setGuaranteeVisible(false)}>
              <Text style={s.guaranteeCloseT}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', accentLight: 'rgba(43,89,195,0.15)', accentText: '#4A7AE8',
  emerald: '#1DB954', emeraldBg: 'rgba(29,185,84,0.10)', emeraldText: '#1DB954',
  violet: '#5B21B6', gold: '#F5A623',
};

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  scroll:      { flex: 1 },
  scrollInner: { paddingBottom: 20 },

  // Header bar
  headerBar:   { flexDirection: 'row', alignItems: 'center', gap: 10,
                 paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12,
                 borderBottomWidth: 1, borderBottomColor: C.border },
  logoIcon:    { width: 36, height: 36, borderRadius: 10 },
  logoName:    { fontSize: 17, fontWeight: '700', color: C.text1, letterSpacing: -0.3 },
  logoSnap:    { fontWeight: '700', color: C.emerald },

  // Hero
  heroTitle:   { fontSize: 28, fontWeight: '700', color: C.text1, lineHeight: 34,
                 letterSpacing: -0.5, paddingHorizontal: 24, marginTop: 24 },
  heroSub:     { fontSize: 15, color: C.text2, lineHeight: 22, paddingHorizontal: 24, marginTop: 10 },

  // Section
  section:     { paddingHorizontal: 24, marginTop: 28 },
  secTitle:    { fontSize: 11, fontWeight: '600', color: C.gold, letterSpacing: 1.5, marginBottom: 12 },

  // Checklist
  checklist:   { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  checkRow:    { flexDirection: 'row', padding: 14, alignItems: 'flex-start' },
  checkRowBdr: { borderBottomWidth: 1, borderBottomColor: C.border },
  checkNum:    { width: 26, height: 26, borderRadius: 13, backgroundColor: C.accentLight,
                 alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 1 },
  checkNumT:   { color: C.accentText, fontSize: 11, fontWeight: '700' },
  checkBody:   { flex: 1 },
  checkTitle:  { fontSize: 14, fontWeight: '600', color: C.text1, marginBottom: 2 },
  checkSub:    { fontSize: 12, color: C.text3, lineHeight: 17 },

  // Footer CTA
  foot:        { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20,
                 backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
  cta:         { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16,
                 flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaT:        { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  ctaArrow:    { color: 'rgba(255,255,255,0.6)', fontSize: 18, fontWeight: '300' },
  footNote:    { textAlign: 'center', fontSize: 11, color: C.text3, marginTop: 8 },
  guarantee:   { textAlign: 'center', fontSize: 11, color: '#2B59C3', marginTop: 4,
                 textDecorationLine: 'underline' },
  guaranteeOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center',
                      alignItems: 'center', zIndex: 999, padding: 20 },
  guaranteeCard: { backgroundColor: '#151929', borderRadius: 16, padding: 24,
                   borderWidth: 1, borderColor: '#1E2438', maxWidth: 400 },
  guaranteeTitle: { fontSize: 16, fontWeight: '700', color: '#F0F2FF', marginBottom: 12 },
  guaranteeBody: { fontSize: 13, color: '#A8B1CC', lineHeight: 20, marginBottom: 12 },
  guaranteeEmphasis: { color: '#F0F2FF', fontWeight: '600' },
  guaranteeSmall: { fontSize: 11, color: '#6B7294', lineHeight: 16, marginBottom: 20 },
  guaranteeClose: { backgroundColor: '#2B59C3', borderRadius: 10, padding: 12,
                    alignItems: 'center' },
  guaranteeCloseT: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Do's & Don'ts
  dosSection:  { paddingHorizontal: 24, marginTop: 24 },
  dosTitle:    { fontSize: 11, fontWeight: '600', color: C.gold, letterSpacing: 1.5, marginBottom: 12 },
  dosRow:      { flexDirection: 'row', gap: 12 },
  dosCard:     { flex: 1, borderRadius: 14, paddingTop: 10, paddingBottom: 12, paddingHorizontal: 10, alignItems: 'center', borderWidth: 1.5, position: 'relative' },
  dosCardWrong:{ backgroundColor: 'rgba(220,38,38,0.06)', borderColor: 'rgba(220,38,38,0.30)' },
  dosCardRight:{ backgroundColor: 'rgba(29,185,84,0.06)', borderColor: 'rgba(29,185,84,0.30)' },
  dosPhoto:    { width: 120, height: 80, borderRadius: 10, marginBottom: 8 },
  dosMarkWrap: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', zIndex: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
  dosMarkRight:{ backgroundColor: '#1DB954' },
  dosCross:    { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  dosTick:     { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  dosLabelWrong: { fontSize: 11, color: '#FCA5A5', textAlign: 'center', lineHeight: 15, fontWeight: '500' },
  dosLabelRight: { fontSize: 11, color: '#86EFAC', textAlign: 'center', lineHeight: 15, fontWeight: '500' },
});
