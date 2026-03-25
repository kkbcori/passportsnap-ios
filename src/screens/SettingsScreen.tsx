// ═══════════════════════════════════════════════════════════════
// SettingsScreen (v3) — Plain JSON export, no encryption
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
  Alert, Linking, Share, TextInput, Modal, Platform,
} from 'react-native';
import { colors, spacing, radius, typography, shadows } from '../theme';
import { useStore } from '../store';
import {
  requestPermissions, cancelAllNotifications, sendTestNotification, getScheduledCount,
} from '../utils/notifications';

export const SettingsScreen: React.FC = () => {
  const {
    documents, counters, notificationsEnabled, isPremium,
    setNotificationsEnabled, resetAllData, setPremium,
    exportData, importData,
  } = useStore();

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');

  const handleNotificationToggle = async (value: boolean) => {
    if (value) {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert('Permissions Required', 'Enable notifications in device settings.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
        return;
      }
    } else { await cancelAllNotifications(); }
    setNotificationsEnabled(value);
  };

  const handleTestNotification = async () => {
    const granted = await requestPermissions();
    if (!granted) { Alert.alert('Enable Notifications', 'Please enable notifications first.'); return; }
    await sendTestNotification();
    Alert.alert('Test Sent!', 'You should see a banner in 3 seconds.');
  };

  const handleExport = async () => {
    try {
      const json = exportData();
      await Share.share({ message: json, title: 'StatusVault Backup' });
    } catch (e) {
      Alert.alert('Export Failed', 'Could not export data.');
    }
  };

  const handleImportPaste = () => {
    if (!importText.trim()) { Alert.alert('Empty', 'Paste your backup data.'); return; }
    const success = importData(importText.trim());
    if (success) {
      Alert.alert('Import Successful!', 'Documents and settings restored.');
      setShowImportModal(false);
      setImportText('');
    } else {
      Alert.alert('Import Failed', 'Not a valid StatusVault backup.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.cc} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><Text style={styles.title}>Settings</Text></View>

      {/* Summary */}
      <View style={styles.card}>
        <View style={styles.profileRow}>
          <View style={styles.profileIcon}><Text style={{ fontSize: 26 }}>🌍</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>StatusVault</Text>
            <Text style={styles.profileSub}>{documents.length} document{documents.length !== 1 ? 's' : ''} tracked{isPremium ? ' · Premium ⭐' : ''}</Text>
          </View>
        </View>
      </View>

      {/* Notifications */}
      <Text style={styles.sLabel}>NOTIFICATIONS</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rIcon}>🔔</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rTitle}>Push Notifications</Text>
            <Text style={styles.rDesc}>Banner alerts on lock screen</Text>
          </View>
          <Switch value={notificationsEnabled} onValueChange={handleNotificationToggle}
            trackColor={{ false: colors.border, true: colors.accent + '66' }}
            thumbColor={notificationsEnabled ? colors.accent : '#f4f4f4'} />
        </View>
        <View style={styles.div} />
        <TouchableOpacity style={styles.sRow} onPress={handleTestNotification}>
          <Text style={styles.rIcon}>📲</Text><Text style={styles.sText}>Send Test Notification</Text><Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
        <View style={styles.div} />
        <TouchableOpacity style={styles.sRow} onPress={async () => { const c = await getScheduledCount(); Alert.alert('Scheduled', `${c} notification${c !== 1 ? 's' : ''} scheduled.`); }}>
          <Text style={styles.rIcon}>📊</Text><Text style={styles.sText}>View Scheduled Alerts</Text><Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Immi Counters */}
      <Text style={styles.sLabel}>IMMI COUNTERS</Text>
      <View style={styles.card}>
        <Text style={styles.rTitle}>🔢 {counters.length} counter{counters.length !== 1 ? 's' : ''} active</Text>
        <Text style={styles.rDesc}>Manage counters from the Dashboard</Text>
      </View>

      {/* Export/Import */}
      <Text style={styles.sLabel}>DATA BACKUP (JSON)</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.sRow} onPress={handleExport}>
          <Text style={styles.rIcon}>📤</Text>
          <View style={{ flex: 1 }}><Text style={styles.sText}>Export Backup</Text><Text style={styles.rDesc}>Share as JSON — readable on any device</Text></View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
        <View style={styles.div} />
        <TouchableOpacity style={styles.sRow} onPress={() => setShowImportModal(true)}>
          <Text style={styles.rIcon}>📥</Text>
          <View style={{ flex: 1 }}><Text style={styles.sText}>Import Backup</Text><Text style={styles.rDesc}>Paste JSON backup from another device</Text></View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.dataNote}>📋 Backups are plain JSON — easy to read, transfer, and store.</Text>

      {/* Premium */}
      <Text style={styles.sLabel}>PREMIUM</Text>
      {isPremium ? (
        <View style={[styles.card, { borderWidth: 2, borderColor: colors.success }]}>
          <Text style={[styles.rTitle, { color: colors.success }]}>⭐ Premium Active — Unlimited tracking</Text>
        </View>
      ) : (
        <View style={styles.premCard}>
          <Text style={{ fontSize: 28, marginBottom: 8 }}>⭐</Text>
          <Text style={styles.premTitle}>Upgrade to Premium</Text>
          <Text style={styles.premDesc}>Unlimited tracking, advanced alerts, data export, priority support.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 16 }}>
            <Text style={styles.premPrice}>$7.99</Text><Text style={styles.premPeriod}>/year</Text>
          </View>
          <TouchableOpacity style={styles.premBtn} onPress={() => Alert.alert('Coming Soon', 'In-app purchase available soon.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unlock for Testing', onPress: () => setPremium(true) }])}>
            <Text style={styles.premBtnText}>Subscribe — $7.99/year</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Danger */}
      <Text style={styles.sLabel}>DANGER ZONE</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.sRow} onPress={() => Alert.alert('Reset All Data?', 'This permanently deletes everything.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { cancelAllNotifications(); resetAllData(); } }])}>
          <Text style={styles.rIcon}>🗑️</Text><Text style={[styles.sText, { color: colors.danger }]}>Reset All Data</Text><Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Legal */}
      <Text style={styles.sLabel}>LEGAL</Text>
      <View style={styles.card}>
        <Text style={{ fontSize: 12, color: colors.text3, lineHeight: 20 }}>
          ⚠️ StatusVault is an informational tool only and does not provide legal advice. Always consult your DSO, immigration attorney, or USCIS for official guidance. Not affiliated with any government agency.
        </Text>
      </View>

      <Text style={styles.version}>StatusVault v1.0.0{'\n'}Built with care for immigrants</Text>
      <View style={{ height: 40 }} />

      {/* Import Modal */}
      <Modal visible={showImportModal} animationType="slide" transparent>
        <View style={styles.importOverlay}>
          <View style={styles.importSheet}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text1, marginBottom: 8 }}>Import Backup</Text>
            <Text style={{ fontSize: 13, color: colors.text2, marginBottom: 16 }}>Paste the JSON backup from another device:</Text>
            <TextInput style={styles.importInput} value={importText} onChangeText={setImportText}
              placeholder='{"app":"StatusVault",...}' placeholderTextColor={colors.text3}
              multiline autoCapitalize="none" autoCorrect={false} />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity style={[styles.importBtn, { backgroundColor: colors.border }]} onPress={() => { setShowImportModal(false); setImportText(''); }}>
                <Text style={[styles.importBtnText, { color: colors.text2 }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.importBtn} onPress={handleImportPaste}>
                <Text style={styles.importBtnText}>Import</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  cc: { paddingBottom: 20 },
  header: { paddingHorizontal: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  title: { ...typography.h1, color: colors.text1 },
  sLabel: { ...typography.micro, color: colors.text3, letterSpacing: 1.5, paddingHorizontal: spacing.screen, marginTop: spacing.xxl, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, marginHorizontal: spacing.screen, padding: spacing.lg, ...shadows.sm },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  profileIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  profileName: { ...typography.h2, color: colors.text1 },
  profileSub: { ...typography.caption, color: colors.text3, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rIcon: { fontSize: 22 },
  rTitle: { ...typography.bodySemibold, color: colors.text1, fontSize: 14 },
  rDesc: { ...typography.caption, color: colors.text3, fontSize: 12, marginTop: 1 },
  sRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: spacing.md },
  sText: { ...typography.bodySemibold, color: colors.text1, fontSize: 14, flex: 1 },
  arrow: { fontSize: 22, color: colors.text3 },
  div: { height: 1, backgroundColor: colors.borderLight },
  dangerBtn: { marginTop: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.danger, alignItems: 'center' },
  dangerBtnText: { ...typography.captionBold, color: colors.danger },
  dataNote: { fontSize: 12, color: colors.text3, paddingHorizontal: spacing.screen, marginTop: spacing.sm, fontWeight: '500' },
  premCard: { backgroundColor: colors.primary, borderRadius: radius.lg, marginHorizontal: spacing.screen, padding: spacing.xl, alignItems: 'center' },
  premTitle: { ...typography.h2, color: colors.textInverse, marginBottom: spacing.sm },
  premDesc: { ...typography.caption, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20, marginBottom: spacing.lg },
  premPrice: { fontSize: 32, fontWeight: '900', color: colors.textInverse },
  premPeriod: { fontSize: 16, color: 'rgba(255,255,255,0.5)', marginLeft: 4 },
  premBtn: { width: '100%', paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center' },
  premBtnText: { ...typography.bodySemibold, color: colors.textInverse },
  version: { ...typography.caption, color: colors.text3, textAlign: 'center', marginTop: spacing.xxl, lineHeight: 20, fontSize: 12 },
  importOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 },
  importSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380 },
  importInput: { backgroundColor: colors.background, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 14, fontSize: 13, color: colors.text1, minHeight: 120, textAlignVertical: 'top', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  importBtn: { flex: 1, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  importBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
