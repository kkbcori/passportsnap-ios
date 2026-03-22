// ═══════════════════════════════════════════════════════════════
// PinLockScreen — Full-screen PIN entry gate
// Shows on app launch when PIN is enabled
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, radius, typography } from '../theme';

interface PinLockScreenProps {
  onUnlock: () => void;
  verifyPin: (pin: string) => boolean;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({ onUnlock, verifyPin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const handlePress = (digit: string) => {
    if (pin.length >= 4) return;
    setError(false);
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === 4) {
      setTimeout(() => {
        if (verifyPin(newPin)) {
          onUnlock();
        } else {
          Vibration.vibrate(200);
          setError(true);
          setAttempts((a) => a + 1);
          setPin('');
        }
      }, 150);
    }
  };

  const handleDelete = () => {
    setPin((p) => p.slice(0, -1));
    setError(false);
  };

  return (
    <LinearGradient colors={[colors.primary, '#132847', '#1B3A65']} style={styles.container}>
      {/* Passport decorations */}
      <View style={styles.passportLines}>
        {[...Array(4)].map((_, i) => (
          <View key={i} style={[styles.passportLine, { top: 60 + i * 40, opacity: 0.03 }]} />
        ))}
      </View>

      <View style={styles.content}>
        <View style={styles.lockIcon}>
          <Text style={{ fontSize: 32 }}>🔒</Text>
        </View>
        <Text style={styles.title}>StatusVault</Text>
        <Text style={styles.subtitle}>Enter your 4-digit PIN</Text>

        {/* PIN dots */}
        <View style={styles.dotsRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[
              styles.dot,
              i < pin.length && styles.dotFilled,
              error && styles.dotError,
            ]} />
          ))}
        </View>

        {error && (
          <Text style={styles.errorText}>
            {attempts >= 5 ? 'Too many attempts. Try again.' : 'Incorrect PIN. Try again.'}
          </Text>
        )}

        {/* Number pad */}
        <View style={styles.keypad}>
          {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', '⌫']].map((row, ri) => (
            <View key={ri} style={styles.keypadRow}>
              {row.map((key, ki) => {
                if (key === '') return <View key={ki} style={styles.keyEmpty} />;
                if (key === '⌫') {
                  return (
                    <TouchableOpacity key={ki} style={styles.key} onPress={handleDelete} activeOpacity={0.6}>
                      <Text style={styles.keyDelete}>⌫</Text>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity key={ki} style={styles.key} onPress={() => handlePress(key)} activeOpacity={0.6}>
                    <Text style={styles.keyText}>{key}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.watermark}>STATUSVAULT</Text>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  passportLines: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  passportLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#fff' },
  content: { alignItems: 'center', paddingHorizontal: 40 },
  lockIcon: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: 'rgba(201,163,81,0.3)',
    backgroundColor: 'rgba(201,163,81,0.08)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { ...typography.caption, color: 'rgba(255,255,255,0.5)', marginBottom: 32 },
  dotsRow: { flexDirection: 'row', gap: 18, marginBottom: 16 },
  dot: {
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 2, borderColor: 'rgba(201,163,81,0.4)',
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotError: { borderColor: colors.danger, backgroundColor: 'transparent' },
  errorText: { ...typography.caption, color: colors.danger, marginBottom: 16, fontSize: 13 },
  keypad: { marginTop: 20, gap: 14 },
  keypadRow: { flexDirection: 'row', gap: 24, justifyContent: 'center' },
  key: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  keyEmpty: { width: 72, height: 72 },
  keyText: { fontSize: 28, fontWeight: '600', color: '#fff' },
  keyDelete: { fontSize: 24, color: 'rgba(255,255,255,0.5)' },
  watermark: {
    position: 'absolute', bottom: 40,
    ...typography.micro, color: 'rgba(201,163,81,0.08)',
    letterSpacing: 6, fontSize: 10,
  },
});
