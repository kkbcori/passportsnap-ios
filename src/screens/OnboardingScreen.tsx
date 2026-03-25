// ═══════════════════════════════════════════════════════════════
// OnboardingScreen (v4) — Immigration-friendly icons & language
// ═══════════════════════════════════════════════════════════════

import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Dimensions,
  TouchableOpacity, ViewToken,
} from 'react-native';
import { colors, spacing, radius, typography } from '../theme';
import { useStore } from '../store';

const { width } = Dimensions.get('window');

interface Slide {
  id: string;
  icon: string;
  title: string;
  description: string;
  color: string;
}

const SLIDES: Slide[] = [
  {
    id: '1',
    icon: '🌍',
    title: 'Track Your Deadlines',
    description:
      'Visa expirations, OPT timelines, passport renewals, I-20s — all in one place. Fully offline, your data never leaves your device.',
    color: colors.primary,
  },
  {
    id: '2',
    icon: '✈️',
    title: 'Smart Immigration Alerts',
    description:
      'Get notified based on your document type. H-1B alerts 6 months early. OPT deadlines at 90 days. Passport renewals at 6 months.',
    color: colors.accent,
  },
  {
    id: '3',
    icon: '📋',
    title: 'Step-by-Step Checklists',
    description:
      'Pre-built checklists for OPT, H-1B, passport, F-1 visa, Green Card, and more — sourced from USCIS and immigration offices.',
    color: '#1a6b4a',
  },
];

export const OnboardingScreen: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const setOnboarded = useStore((s) => s.setOnboarded);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const completeOnboarding = () => { setOnboarded(); };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      completeOnboarding();
    }
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.iconCircle, { backgroundColor: item.color }]}>
        <Text style={styles.icon}>{item.icon}</Text>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
      />
      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity style={styles.button} onPress={handleNext}>
          <Text style={styles.buttonText}>
            {currentIndex < SLIDES.length - 1 ? 'Continue' : 'Get Started'}
          </Text>
        </TouchableOpacity>
        {currentIndex < SLIDES.length - 1 && (
          <TouchableOpacity style={styles.skipButton} onPress={completeOnboarding}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  iconCircle: { width: 100, height: 100, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  icon: { fontSize: 48 },
  title: { ...typography.h1, color: colors.text1, textAlign: 'center', marginBottom: 12 },
  description: { ...typography.body, color: colors.text2, textAlign: 'center', lineHeight: 24, maxWidth: 300 },
  footer: { paddingHorizontal: spacing.xxl, paddingBottom: 50, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.accent },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, width: '100%', alignItems: 'center' },
  buttonText: { ...typography.bodySemibold, color: colors.textInverse, fontSize: 16 },
  skipButton: { paddingVertical: 14 },
  skipText: { ...typography.bodySemibold, color: colors.text3 },
});
