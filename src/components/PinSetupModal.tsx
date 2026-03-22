// ═══════════════════════════════════════════════════════════════
// PinSetupModal — Set, change, or remove PIN
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, Vibration } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, radius, typography } from '../theme';

type SetupStep = 'enter' | 'confirm' | 'verify_old';

interface PinSetupModalProps {
  visible: boolean;
  onClose: () => void;
  onSetPin: (pin: string) => void;
  onRemovePin: () => void;
  currentPinEnabled: boolean;
  verifyPin: (pin: string) => boolean;
}

export const PinSetupModal: React.FC<PinSetupModalProps> = ({
  visible, onClose, onSetPin, onRemovePin, currentPinEnabled, verifyPin,
}) => {
  const [step, setStep] = useState<SetupStep>(currentPinEnabled ? 'verify_old' : 'enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [isRemoveFlow, setIsRemoveFlow] = useState(false);

  const reset = () => {
    setStep(currentPinEnabled ? 'verify_old' : 'enter');
    setPin(''); setFirstPin(''); setError(''); setIsRemoveFlow(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handlePress = (digit: string) => {
    if (pin.length >= 4) return;
    setError('');
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === 4) {
      setTimeout(() => processPin(newPin), 150);
    }
  };

  const processPin = (entered: string) => {
    if (step === 'verify_old') {
      if (verifyPin(entered)) {
        if (isRemoveFlow) {
          onRemovePin();
          Alert.alert('PIN Removed', 'App PIN has been disabled.');
          handleClose();
        } else {
          setStep('enter');
          setPin('');
        }
      } else {
        Vibration.vibrate(200);
        setError('Incorrect PIN');
        setPin('');
      }
    } else if (step === 'enter') {
      setFirstPin(entered);
      setStep('confirm');
      setPin('');
    } else if (step === 'confirm') {
      if (entered === firstPin) {
        onSetPin(entered);
        Alert.alert('PIN Set', 'Your 4-digit PIN is now active.');
        handleClose();
      } else {
        Vibration.vibrate(200);
        setError('PINs don\'t match. Try again.');
        setStep('enter');
        setFirstPin('');
        setPin('');
      }
    }
  };

  const handleDelete = () => { setPin((p) => p.slice(0, -1)); setError(''); };

  const getTitle = () => {
    if (step === 'verify_old') return isRemoveFlow ? 'Enter Current PIN' : 'Verify Current PIN';
    if (step === 'enter') return 'Enter New PIN';
    return 'Confirm New PIN';
  };

  const getSubtitle = () => {
    if (step === 'verify_old') return isRemoveFlow ? 'Enter your PIN to disable it' : 'Verify your current PIN first';
    if (step === 'enter') return 'Choose a 4-digit PIN';
    return 'Re-enter your PIN to confirm';
  };

  const startRemoveFlow = () => {
    setIsRemoveFlow(true);
    setStep('verify_old');
    setPin(''); setFirstPin(''); setError('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.goldTrim} />

          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>🔐 PIN Setup</Text>
            <View style={{ width: 60 }} />
          </View>

          <View style={styles.content}>
            <Text style={styles.title}>{getTitle()}</Text>
            <Text style={styles.subtitle}>{getSubtitle()}</Text>

            {/* PIN dots */}
            <View style={styles.dotsRow}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[
                  styles.dot,
                  i < pin.length && styles.dotFilled,
                  error ? styles.dotError : null,
                ]} />
              ))}
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Keypad */}
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

            {/* Remove PIN option */}
            {currentPinEnabled && !isRemoveFlow && (
              <TouchableOpacity style={styles.removeBtn} onPress={startRemoveFlow}>
                <Text style={styles.removeBtnText}>Remove PIN Instead</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingBottom: 40, overflow: 'hidden' },
  goldTrim: { height: 3, backgroundColor: colors.accent, opacity: 0.3 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  cancelText: { ...typography.bodySemibold, color: colors.accent, fontSize: 14 },
  headerTitle: { ...typography.h3, color: colors.text1, fontSize: 16 },
  content: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.screen },
  title: { fontSize: 20, fontWeight: '700', color: colors.text1, marginBottom: 6 },
  subtitle: { ...typography.caption, color: colors.text3, marginBottom: 28 },
  dotsRow: { flexDirection: 'row', gap: 18, marginBottom: 12 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.border, backgroundColor: 'transparent' },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotError: { borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, marginBottom: 8 },
  keypad: { marginTop: 16, gap: 12 },
  keypadRow: { flexDirection: 'row', gap: 20, justifyContent: 'center' },
  key: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', ...StyleSheet.flatten({ elevation: 1 }) },
  keyEmpty: { width: 64, height: 64 },
  keyText: { fontSize: 24, fontWeight: '600', color: colors.text1 },
  keyDelete: { fontSize: 20, color: colors.text3 },
  removeBtn: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 20 },
  removeBtnText: { ...typography.bodySemibold, color: colors.danger, fontSize: 14 },
});
