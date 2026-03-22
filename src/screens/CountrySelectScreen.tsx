/**
 * CountrySelectScreen v8 — Professional clean design
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  SafeAreaView, ScrollView, StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import FloatingOrbs from '../components/FloatingOrbs';

const APP_ICON = require('../assets/app_icon.png');

const COUNTRIES = [
  { code: 'USA', name: 'United States',  flag: '\uD83C\uDDFA\uD83C\uDDF8', dim: '2×2 in',              active: true },
  { code: 'IND', name: 'India (Global)', flag: '\uD83C\uDDEE\uD83C\uDDF3', dim: '2×2 in',              active: true },
  { code: 'SCH', name: 'Schengen Visa',  flag: '🇪🇺',                        dim: '35×45 mm',           active: true },
  { code: 'GBR', name: 'United Kingdom', flag: '\uD83C\uDDEC\uD83C\uDDE7', dim: '35×45 mm',           active: true },
  { code: 'CAN', name: 'Canada',         flag: '🇨🇦',                        dim: '50×70 mm',           active: true },
  { code: 'AUS', name: 'Australia',      flag: '🇦🇺',                        dim: '35×45 mm',           active: true },
  { code: 'DEU', name: 'Germany',        flag: '🇩🇪',                        dim: '35×45 mm',           active: true },
  { code: 'ZAF', name: 'South Africa',   flag: '🇿🇦',                        dim: '35×45 mm',           active: true },
];

export default function CountrySelectScreen() {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={s.safe}>
      <FloatingOrbs />
      <StatusBar barStyle="light-content" backgroundColor="#0C0F1A" />

      {/* Logo header */}
      <View style={s.headerBar}>
        <Image source={APP_ICON} style={s.logoIcon} />
        <Text style={s.logoName}>Passport<Text style={s.logoSnap}>Snap</Text></Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Select your country</Text>
        <Text style={s.sub}>Choose the issuing country for your passport or visa</Text>

        {COUNTRIES.map(c => (
          <TouchableOpacity
            key={c.code}
            style={[s.card, !c.active && s.cardOff]}
            onPress={() => c.active && navigation.navigate('ImageInput', { country: c.code })}
            activeOpacity={c.active ? 0.6 : 1}
          >
            <Text style={s.flag}>{c.flag}</Text>
            <View style={s.cardBody}>
              <Text style={[s.cardName, !c.active && s.cardNameOff]}>{c.name}</Text>
              <Text style={s.cardDim}>{c.dim}</Text>
            </View>
            {c.active
              ? <View style={s.arrowWrap}><Text style={s.arrowT}>→</Text></View>
              : <View style={s.soonBadge}><Text style={s.soonT}>Soon</Text></View>
            }
          </TouchableOpacity>
        ))}

        <Text style={s.note}>More countries coming soon</Text>
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
  safe:       { flex: 1, backgroundColor: C.bg },

  headerBar:  { flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12,
                borderBottomWidth: 1, borderBottomColor: C.border },
  logoIcon:   { width: 36, height: 36, borderRadius: 10 },
  logoName:   { fontSize: 17, fontWeight: '700', color: C.text1, letterSpacing: -0.3 },
  logoSnap:   { fontWeight: '700', color: C.emerald },

  scroll:     { padding: 24, paddingTop: 16, paddingBottom: 40 },
  title:      { fontSize: 24, fontWeight: '700', color: C.text1, letterSpacing: -0.3 },
  sub:        { fontSize: 14, color: C.text3, marginTop: 4, marginBottom: 20 },

  card:       { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
                borderRadius: 14, padding: 16, marginBottom: 10,
                borderWidth: 1, borderColor: C.border },
  cardOff:    { backgroundColor: C.surface, borderColor: C.border, opacity: 0.5 },
  flag:       { fontSize: 28, width: 44, textAlign: 'center' },
  cardBody:   { flex: 1, marginLeft: 14 },
  cardName:   { fontSize: 15, fontWeight: '600', color: C.text1 },
  cardNameOff:{ color: C.text3 },
  cardDim:    { fontSize: 12, color: C.text3, marginTop: 2 },
  arrowWrap:  { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(43,89,195,0.15)',
                alignItems: 'center', justifyContent: 'center' },
  arrowT:     { fontSize: 16, color: '#4A7AE8', fontWeight: '400' },
  soonBadge:  { backgroundColor: 'rgba(245,166,35,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  soonT:      { fontSize: 10, color: C.gold, fontWeight: '600' },

  note:       { textAlign: 'center', fontSize: 12, color: C.text3, marginTop: 16 },
});
