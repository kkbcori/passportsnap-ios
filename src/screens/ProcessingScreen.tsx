/**
 * ProcessingScreen v9.2 — Progress bar fix
 * Fixed: Replaced Animated width with state-driven percentage width.
 * On Android, Animated.timing with useNativeDriver:false on a 4px-tall
 * overflow:hidden View can fail to repaint. Using plain state + percentage
 * width is reliable across all devices.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, NativeModules,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import FloatingOrbs from '../components/FloatingOrbs';

const { PassportProcessor } = NativeModules;

type RouteParams = { photoUri: string; country?: string };

const STEPS = [
  { label: 'Reading image',        pct: 15 },
  { label: 'Detecting face',       pct: 35 },
  { label: 'Whitening background', pct: 60 },
  { label: 'Enhancing quality',    pct: 85 },
];

export default function ProcessingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const { photoUri, country } = route.params;

  const [label, setLabel] = useState('Preparing...');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setLabel('Reading image');
        setPct(15);

        // Simulate step progress while native module processes
        let currentPct = 15;
        const progressTimer = setInterval(() => {
          currentPct = Math.min(currentPct + 3, 88);
          setPct(currentPct);
          if (currentPct > 35 && currentPct <= 60) setLabel('Detecting face');
          else if (currentPct > 60 && currentPct <= 85) setLabel('Whitening background');
          else if (currentPct > 85) setLabel('Enhancing quality');
        }, 500);

        // Call native module — all processing happens on device!
        const data = await PassportProcessor.prepare(photoUri, country ?? 'USA');

        clearInterval(progressTimer);
        setLabel('Finalizing');
        setPct(100);

        setTimeout(() => {
          navigation.replace('Adjust', {
            preparedUri: data.preparedUri,
            preparedBase64: data.imageBase64,
            origW: data.widthPx,
            origH: data.heightPx,
            autoCrop: data.autoCrop,
            country: country ?? 'USA',
          });
        }, 400);
      } catch (e: any) {
        setError(e.message ?? 'Processing failed.');
      }
    };
    run();
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <FloatingOrbs />
      <StatusBar barStyle="light-content" backgroundColor="#0C0F1A" />
      <View style={s.center}>

        {/* Big percentage */}
        <Text style={s.pct}>{Math.round(pct)}<Text style={s.pctSign}>%</Text></Text>

        {/* Progress bar — plain View with percentage width, no Animated */}
        <View style={s.track}>
          <View style={[s.bar, { width: `${pct}%` }]} />
        </View>
        <Text style={s.label}>{label}</Text>

        {/* Steps */}
        <View style={s.steps}>
          {STEPS.map(st => (
            <View key={st.label} style={s.stepRow}>
              <View style={[s.dot, pct >= st.pct && s.dotDone]} />
              <Text style={[s.stepT, pct >= st.pct && s.stepDone]}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* On-device badge */}
        <View style={s.badge}>
          <Text style={s.badgeText}>🔒 Processing 100% on your device</Text>
        </View>

        {/* Error */}
        {error && (
          <View style={s.err}>
            <Text style={s.errT}>{error}</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.errBtn}>
              <Text style={s.errBtnT}>Go back and retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const C = {
  bg: '#0C0F1A', surface: '#151929', border: '#1E2438',
  text1: '#F0F2FF', text2: '#A8B1CC', text3: '#6B7294',
  accent: '#2B59C3', emerald: '#1DB954', emeraldBg: 'rgba(29,185,84,0.10)',
  gold: '#F5A623',
};

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },

  pct:     { fontSize: 56, fontWeight: '200', color: C.text1, letterSpacing: -3 },
  pctSign: { fontSize: 28, fontWeight: '300', color: C.text3 },

  track:   { width: '100%', height: 6, backgroundColor: C.border, borderRadius: 3,
             overflow: 'hidden', marginTop: 20, marginBottom: 10 },
  bar:     { height: '100%', backgroundColor: C.accent, borderRadius: 3 },
  label:   { fontSize: 13, color: C.text3, marginBottom: 36 },

  steps:   { alignSelf: 'stretch' },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border, marginRight: 12 },
  dotDone: { backgroundColor: C.emerald },
  stepT:   { fontSize: 14, color: C.text3 },
  stepDone:{ color: C.text1 },

  badge:   { marginTop: 24, backgroundColor: C.emeraldBg, borderRadius: 10,
             paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(29,185,84,0.20)' },
  badgeText:{ fontSize: 12, color: C.emerald, fontWeight: '600' },

  err:     { marginTop: 32, padding: 20, borderRadius: 14, backgroundColor: 'rgba(220,38,38,0.08)',
             borderWidth: 1, borderColor: 'rgba(220,38,38,0.25)', alignItems: 'center', alignSelf: 'stretch' },
  errT:    { color: '#FCA5A5', fontSize: 13, marginBottom: 12, textAlign: 'center', lineHeight: 18 },
  errBtn:  { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  errBtnT: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
