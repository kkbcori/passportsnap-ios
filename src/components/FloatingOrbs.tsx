/**
 * FloatingOrbs — Subtle animated background orbs
 * Uses native driver for 60fps performance.
 * Place as first child inside any container.
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

interface OrbConfig {
  size: number;
  color: string;
  startX: number;
  startY: number;
  driftX: number;
  driftY: number;
  duration: number;
  delay: number;
  opacity: number;
}

const ORBS: OrbConfig[] = [
  { size: 120, color: '#2B59C3', startX: -30,     startY: SH * 0.15, driftX: 40,  driftY: -30, duration: 7000,  delay: 0,    opacity: 0.06 },
  { size: 90,  color: '#5B21B6', startX: SW * 0.7, startY: SH * 0.3,  driftX: -30, driftY: 25,  duration: 9000,  delay: 1000, opacity: 0.05 },
  { size: 70,  color: '#1DB954', startX: SW * 0.3, startY: SH * 0.6,  driftX: 25,  driftY: -20, duration: 8000,  delay: 2000, opacity: 0.04 },
  { size: 100, color: '#F5A623', startX: SW * 0.8, startY: SH * 0.75, driftX: -35, driftY: -25, duration: 10000, delay: 500,  opacity: 0.035 },
  { size: 60,  color: '#4A7AE8', startX: SW * 0.1, startY: SH * 0.45, driftX: 30,  driftY: 20,  duration: 6500,  delay: 1500, opacity: 0.05 },
  { size: 80,  color: '#4C1D95', startX: SW * 0.5, startY: SH * 0.1,  driftX: -20, driftY: 35,  duration: 8500,  delay: 3000, opacity: 0.04 },
];

function Orb({ config }: { config: OrbConfig }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: config.duration,
          delay: config.delay,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: config.duration,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, config.driftX],
  });
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, config.driftY],
  });
  const scale = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.15, 1],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: config.startX,
        top: config.startY,
        width: config.size,
        height: config.size,
        borderRadius: config.size / 2,
        backgroundColor: config.color,
        opacity: config.opacity,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    />
  );
}

export default function FloatingOrbs() {
  return (
    <View style={styles.container} pointerEvents="none">
      {ORBS.map((orb, i) => (
        <Orb key={i} config={orb} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});
