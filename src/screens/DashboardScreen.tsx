// ═══════════════════════════════════════════════════════════════
// DashboardScreen (v5) — Immi Counter replaces unemployment
// Multiple counters: OPT, STEM, H1B grace, visitor, tax, custom
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  LayoutAnimation, Platform, UIManager, Modal, FlatList, TextInput, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography, shadows } from '../theme';
import { useStore, FREE_LIMIT } from '../store';
import { generateDeadlines, getMostCritical } from '../utils/dates';
import { CHECKLIST_TEMPLATES } from '../utils/checklists';
import { COUNTER_TEMPLATES } from '../utils/counters';
import { StatusCard, SeveritySummary, TimelineItem, ProgressBar } from '../components';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const DashboardScreen: React.FC = () => {
  const documents = useStore((s) => s.documents);
  const checklists = useStore((s) => s.checklists);
  const counters = useStore((s) => s.counters);
  const isPremium = useStore((s) => s.isPremium);
  const toggleChecklistItem = useStore((s) => s.toggleChecklistItem);
  const addChecklist = useStore((s) => s.addChecklist);
  const removeChecklist = useStore((s) => s.removeChecklist);
  const addCustomChecklistItem = useStore((s) => s.addCustomChecklistItem);
  const hasChecklist = useStore((s) => s.hasChecklist);
  const addCounter = useStore((s) => s.addCounter);
  const addCustomCounter = useStore((s) => s.addCustomCounter);
  const removeCounter = useStore((s) => s.removeCounter);
  const hasCounter = useStore((s) => s.hasCounter);
  const incrementCounter = useStore((s) => s.incrementCounter);
  const decrementCounter = useStore((s) => s.decrementCounter);
  const resetCounter = useStore((s) => s.resetCounter);
  const setCounterTracking = useStore((s) => s.setCounterTracking);
  const autoIncrementCounters = useStore((s) => s.autoIncrementCounters);
  const getRemainingFreeSlots = useStore((s) => s.getRemainingFreeSlots);
  const navigation = useNavigation<any>();

  const [showAddChecklist, setShowAddChecklist] = useState(false);
  const [showAddCounter, setShowAddCounter] = useState(false);
  const [showCustomCounter, setShowCustomCounter] = useState(false);
  const [customCounterName, setCustomCounterName] = useState('');
  const [customCounterDays, setCustomCounterDays] = useState('');
  const [customItemText, setCustomItemText] = useState('');
  const [customItemTarget, setCustomItemTarget] = useState<string | null>(null);

  React.useEffect(() => { autoIncrementCounters(); }, []);

  const deadlines = generateDeadlines(documents);
  const mostCritical = getMostCritical(deadlines);
  const remaining = getRemainingFreeSlots();

  const handleToggle = (tid: string, iid: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    toggleChecklistItem(tid, iid);
  };

  const handleAddCustomItem = (tid: string) => {
    if (!customItemText.trim()) return;
    addCustomChecklistItem(tid, customItemText.trim());
    setCustomItemText(''); setCustomItemTarget(null);
  };

  const handleRemoveChecklist = (tid: string, label: string) => {
    Alert.alert('Remove Checklist', `Remove "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeChecklist(tid) },
    ]);
  };

  const handleRemoveCounter = (tid: string, label: string) => {
    Alert.alert('Remove Counter', `Remove "${label}"? Count will be lost.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeCounter(tid) },
    ]);
  };

  const handleAddCustomCounter = () => {
    const name = customCounterName.trim();
    const days = parseInt(customCounterDays, 10);
    if (!name) { Alert.alert('Name required'); return; }
    if (!days || days < 1 || days > 9999) { Alert.alert('Enter valid max days (1-9999)'); return; }
    addCustomCounter(name, days);
    setCustomCounterName(''); setCustomCounterDays('');
    setShowCustomCounter(false); setShowAddCounter(false);
  };

  const getCounterColor = (c: { daysUsed: number; warnAt: number; critAt: number }) =>
    c.daysUsed >= c.critAt ? colors.danger : c.daysUsed >= c.warnAt ? colors.warning : colors.success;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>STATUSVAULT</Text>
            <Text style={styles.title}>Your Status</Text>
          </View>
          <View style={styles.privacyBadge}>
            <Text style={{ fontSize: 16 }}>🔒</Text>
            <View>
              <Text style={styles.privacyText}>100% Private</Text>
              <Text style={styles.privacySubtext}>On your device</Text>
            </View>
          </View>
        </View>
      </View>

      <StatusCard deadline={mostCritical} totalDocs={documents.length} />
      <SeveritySummary deadlines={deadlines} />

      {!isPremium && (
        <View style={styles.freeBar}>
          <Text style={styles.freeText}>{remaining > 0 ? `${remaining} free slot${remaining !== 1 ? 's' : ''} left` : 'Free limit reached'}</Text>
          <ProgressBar value={documents.length} max={FREE_LIMIT} color={remaining > 2 ? colors.accent : remaining > 0 ? colors.warning : colors.danger} height={3} />
        </View>
      )}

      {/* Deadlines */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>📅 Upcoming Deadlines</Text>
          {deadlines.length > 0 && <TouchableOpacity onPress={() => navigation.navigate('Documents')}><Text style={styles.seeAll}>See all →</Text></TouchableOpacity>}
        </View>
        {deadlines.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyIcon}>🌍</Text><Text style={styles.emptyTitle}>No deadlines yet</Text><Text style={styles.emptySubtitle}>Tap + in Documents to track your first</Text></View>
        ) : deadlines.slice(0, 5).map((dl) => <TimelineItem key={dl.documentId} deadline={dl} compact />)}
      </View>

      {/* ═══ IMMI COUNTER ═══ */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🔢 Immi Counter</Text>
          <TouchableOpacity onPress={() => setShowAddCounter(true)}>
            <Text style={styles.addBtn}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {counters.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>⏱️</Text>
            <Text style={styles.emptyTitle}>No counters</Text>
            <Text style={styles.emptySubtitle}>Track OPT unemployment, H-1B grace period, days in US, and more</Text>
          </View>
        )}

        {counters.map((c) => {
          const col = getCounterColor(c);
          const pct = Math.round((c.daysUsed / c.maxDays) * 100);
          return (
            <View key={c.templateId} style={styles.counterCard}>
              <View style={styles.counterHeader}>
                <Text style={{ fontSize: 20 }}>{c.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.counterLabel}>{c.label}</Text>
                  <Text style={styles.counterPct}>{pct}% used</Text>
                </View>
                <TouchableOpacity onPress={() => handleRemoveCounter(c.templateId, c.label)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.counterRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.counterNumbers}>
                    <Text style={[styles.counterBig, { color: col }]}>{c.daysUsed}</Text>
                    <Text style={styles.counterSlash}> / {c.maxDays} </Text>
                    <Text style={styles.counterDaysLabel}>days</Text>
                  </View>
                  <ProgressBar value={c.daysUsed} max={c.maxDays} color={col} height={5} />
                </View>
                <View style={styles.counterBtns}>
                  <TouchableOpacity style={styles.cBtn} onPress={() => decrementCounter(c.templateId)}>
                    <Text style={styles.cBtnText}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.cBtn, { backgroundColor: col + '15', borderColor: col + '30' }]} onPress={() => incrementCounter(c.templateId)}>
                    <Text style={[styles.cBtnText, { color: col }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.counterFooter}>
                <TouchableOpacity onPress={() => setCounterTracking(c.templateId, !c.isTracking)}
                  style={[styles.autoChip, c.isTracking && { backgroundColor: col }]}>
                  <Text style={[styles.autoChipText, c.isTracking && { color: '#fff' }]}>
                    Auto-track: {c.isTracking ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert('Reset?', `Reset "${c.label}" to 0?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reset', style: 'destructive', onPress: () => resetCounter(c.templateId) },
                ])}>
                  <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* ═══ CHECKLISTS ═══ */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>✅ Checklists</Text>
          <TouchableOpacity onPress={() => setShowAddChecklist(true)}>
            <Text style={styles.addBtn}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {checklists.length === 0 && (
          <View style={styles.emptyCard}><Text style={styles.emptyIcon}>📋</Text><Text style={styles.emptyTitle}>No checklists</Text><Text style={styles.emptySubtitle}>Add OPT, H-1B, Passport, or other checklists</Text></View>
        )}
        {checklists.map((cl) => {
          const done = cl.items.filter((i) => i.done).length;
          return (
            <View key={cl.templateId} style={styles.checklistCard}>
              <View style={styles.checklistHeader}>
                <Text style={{ fontSize: 24 }}>{cl.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clLabel}>{cl.label}</Text>
                  <Text style={styles.clProgress}>{done}/{cl.items.length}</Text>
                </View>
                <TouchableOpacity onPress={() => handleRemoveChecklist(cl.templateId, cl.label)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ProgressBar value={done} max={cl.items.length} color={colors.success} height={3} />
              <View style={{ height: 8 }} />
              {cl.items.map((item) => (
                <TouchableOpacity key={item.id} style={styles.checkRow} onPress={() => handleToggle(cl.templateId, item.id)}>
                  <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
                    {item.done && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.checkText, item.done && styles.checkTextDone]} numberOfLines={2}>{item.text}</Text>
                </TouchableOpacity>
              ))}
              {customItemTarget === cl.templateId ? (
                <View style={styles.customRow}>
                  <TextInput style={styles.customInput} value={customItemText} onChangeText={setCustomItemText} placeholder="Custom step..." placeholderTextColor={colors.text3} autoFocus onSubmitEditing={() => handleAddCustomItem(cl.templateId)} />
                  <TouchableOpacity onPress={() => handleAddCustomItem(cl.templateId)} style={styles.customAddBtn}><Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Add</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => { setCustomItemTarget(null); setCustomItemText(''); }}><Text style={{ fontSize: 16, color: colors.text3, paddingHorizontal: 6 }}>✕</Text></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={{ paddingVertical: 10 }} onPress={() => setCustomItemTarget(cl.templateId)}>
                  <Text style={{ fontSize: 13, color: colors.accent, fontWeight: '600' }}>+ Add custom step</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.disclaimer}>⚠️ Check your country-specific requirements. General guidance only.</Text>
            </View>
          );
        })}
      </View>

      <View style={{ height: 30 }} />

      {/* ═══ ADD COUNTER MODAL ═══ */}
      <Modal visible={showAddCounter} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setShowAddCounter(false); setShowCustomCounter(false); }}>
                <Text style={styles.modalBack}>{showCustomCounter ? '← Back' : 'Cancel'}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{showCustomCounter ? 'Custom Counter' : 'Add Immi Counter'}</Text>
              <View style={{ width: 60 }} />
            </View>

            {showCustomCounter ? (
              <View style={{ padding: spacing.screen }}>
                <Text style={styles.fieldLabel}>Counter Name</Text>
                <TextInput style={styles.fieldInput} value={customCounterName} onChangeText={setCustomCounterName} placeholder="e.g., L-2 Grace Period" placeholderTextColor={colors.text3} />
                <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Max Days</Text>
                <TextInput style={styles.fieldInput} value={customCounterDays} onChangeText={setCustomCounterDays} placeholder="e.g., 60" placeholderTextColor={colors.text3} keyboardType="number-pad" />
                <TouchableOpacity style={styles.saveBtn} onPress={handleAddCustomCounter}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Create Counter</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={[...COUNTER_TEMPLATES, { id: '__custom__', label: 'Custom Counter', icon: '🔢', maxDays: 0, description: 'Create your own counter with custom name and day limit', warnAt: 0, critAt: 0 }]}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  if (item.id === '__custom__') {
                    return (
                      <TouchableOpacity style={styles.templateRow} onPress={() => setShowCustomCounter(true)}>
                        <Text style={{ fontSize: 28 }}>{item.icon}</Text>
                        <View style={{ flex: 1 }}><Text style={styles.tLabel}>{item.label}</Text><Text style={styles.tDesc}>{item.description}</Text></View>
                        <Text style={{ fontSize: 24, color: colors.text3 }}>›</Text>
                      </TouchableOpacity>
                    );
                  }
                  const added = hasCounter(item.id);
                  return (
                    <TouchableOpacity style={[styles.templateRow, added && { opacity: 0.4 }]}
                      onPress={() => { if (!added) { addCounter(item.id); setShowAddCounter(false); } }} activeOpacity={added ? 1 : 0.6}>
                      <Text style={{ fontSize: 28 }}>{item.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tLabel}>{item.label}</Text>
                        <Text style={styles.tDesc}>{item.description} · {item.maxDays} days max</Text>
                      </View>
                      {added ? <Text style={styles.addedBadge}>Added ✓</Text> : <Text style={{ fontSize: 24, color: colors.text3 }}>›</Text>}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ═══ ADD CHECKLIST MODAL ═══ */}
      <Modal visible={showAddChecklist} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowAddChecklist(false)}><Text style={styles.modalBack}>Cancel</Text></TouchableOpacity>
              <Text style={styles.modalTitle}>Add Checklist</Text>
              <View style={{ width: 60 }} />
            </View>
            <FlatList data={CHECKLIST_TEMPLATES} keyExtractor={(i) => i.id} showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const added = hasChecklist(item.id);
                return (
                  <TouchableOpacity style={[styles.templateRow, added && { opacity: 0.4 }]}
                    onPress={() => { if (!added) { addChecklist(item.id); setShowAddChecklist(false); } }} activeOpacity={added ? 1 : 0.6}>
                    <Text style={{ fontSize: 28 }}>{item.icon}</Text>
                    <View style={{ flex: 1 }}><Text style={styles.tLabel}>{item.label}</Text><Text style={styles.tDesc}>{item.description} · {item.items.length} steps</Text></View>
                    {added ? <Text style={styles.addedBadge}>Added ✓</Text> : <Text style={{ fontSize: 24, color: colors.text3 }}>›</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 20 },
  header: { paddingHorizontal: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { ...typography.micro, color: colors.text3, letterSpacing: 1.5, marginBottom: 4 },
  title: { ...typography.h1, color: colors.text1 },
  privacyBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E6F9F0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#C3F0D8' },
  privacyText: { fontSize: 11, fontWeight: '700', color: '#1A8F5C' },
  privacySubtext: { fontSize: 10, fontWeight: '500', color: '#2DBE7F', marginTop: 1 },
  freeBar: { marginHorizontal: spacing.screen, marginTop: spacing.md, backgroundColor: colors.card, borderRadius: radius.sm, padding: 12, gap: 6, ...shadows.sm },
  freeText: { fontSize: 12, fontWeight: '600', color: colors.text2 },
  section: { marginTop: spacing.xxl, paddingHorizontal: spacing.screen },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { ...typography.h2, color: colors.text1, fontSize: 17 },
  seeAll: { ...typography.captionBold, color: colors.accent },
  addBtn: { ...typography.captionBold, color: colors.accent, fontSize: 14 },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xxxl, alignItems: 'center', ...shadows.sm },
  emptyIcon: { fontSize: 32, marginBottom: spacing.sm },
  emptyTitle: { ...typography.bodySemibold, color: colors.text2 },
  emptySubtitle: { ...typography.caption, color: colors.text3, textAlign: 'center', marginTop: 4, maxWidth: 260 },

  // Counter cards
  counterCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
  counterHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  counterLabel: { ...typography.h3, color: colors.text1, fontSize: 15 },
  counterPct: { fontSize: 11, color: colors.text3, fontWeight: '500' },
  removeBtn: { fontSize: 16, color: colors.text3, padding: 4 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  counterNumbers: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 6 },
  counterBig: { fontSize: 28, fontWeight: '900', lineHeight: 28 },
  counterSlash: { fontSize: 16, fontWeight: '300', color: colors.text3 },
  counterDaysLabel: { fontSize: 12, color: colors.text3, fontWeight: '500' },
  counterBtns: { gap: 6 },
  cBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cBtnText: { fontSize: 18, fontWeight: '700', color: colors.text2 },
  counterFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  autoChip: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.borderLight },
  autoChipText: { fontSize: 11, fontWeight: '700', color: colors.text2 },
  resetText: { fontSize: 12, color: colors.text3, fontWeight: '600' },

  // Checklist
  checklistCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
  checklistHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  clLabel: { ...typography.h3, color: colors.text1 },
  clProgress: { fontSize: 11, color: colors.text3 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkText: { ...typography.body, color: colors.text1, fontSize: 13, flex: 1 },
  checkTextDone: { color: colors.text3, textDecorationLine: 'line-through' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  customInput: { flex: 1, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: colors.text1 },
  customAddBtn: { backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  disclaimer: { fontSize: 11, color: colors.text3, marginTop: 10, fontStyle: 'italic', lineHeight: 16 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '80%', paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  modalBack: { ...typography.bodySemibold, color: colors.accent, fontSize: 14 },
  modalTitle: { ...typography.h3, color: colors.text1 },
  templateRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.screen, borderBottomWidth: 1, borderBottomColor: colors.borderLight, gap: spacing.md },
  tLabel: { ...typography.bodySemibold, color: colors.text1, fontSize: 14 },
  tDesc: { ...typography.caption, color: colors.text3, fontSize: 12, marginTop: 1 },
  addedBadge: { ...typography.caption, color: colors.success, fontWeight: '600', fontSize: 12 },
  fieldLabel: { ...typography.captionBold, color: colors.text2, marginBottom: 6 },
  fieldInput: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: 14, fontSize: 15, color: colors.text1 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
});
