// ═══════════════════════════════════════════════════════════════
// DocumentsScreen — Updated with paywall after 6 entries
// Dropdown-driven add flow with premium gate
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, spacing, radius, typography, shadows } from '../theme';
import { useStore, FREE_LIMIT } from '../store';
import { generateDeadlines } from '../utils/dates';
import { ExpiryCard } from '../components';
import {
  DOCUMENT_TEMPLATES,
  CATEGORY_LABELS,
  getTemplatesByCategory,
  DocumentTemplate,
} from '../utils/templates';
import { UserDocument, DocumentCategory } from '../types';

export const DocumentsScreen: React.FC = () => {
  const documents = useStore((s) => s.documents);
  const addDocument = useStore((s) => s.addDocument);
  const removeDocument = useStore((s) => s.removeDocument);
  const canAddDocument = useStore((s) => s.canAddDocument);
  const isPremium = useStore((s) => s.isPremium);
  const getRemainingFreeSlots = useStore((s) => s.getRemainingFreeSlots);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [addStep, setAddStep] = useState<'type' | 'date'>('type');
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [expiryDate, setExpiryDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState('');
  const [filterCategory, setFilterCategory] = useState<DocumentCategory | 'all'>('all');

  const templatesByCategory = getTemplatesByCategory();
  const remaining = getRemainingFreeSlots();

  const filteredDocs =
    filterCategory === 'all'
      ? documents
      : documents.filter((d) => d.category === filterCategory);

  const resetAddFlow = () => {
    setAddStep('type');
    setSelectedTemplate(null);
    setExpiryDate(new Date());
    setNotes('');
    setShowDatePicker(false);
  };

  const openAdd = () => {
    // Check paywall BEFORE opening modal
    if (!canAddDocument()) {
      setShowPaywall(true);
      return;
    }
    resetAddFlow();
    setShowAddModal(true);
  };

  const selectTemplate = (template: DocumentTemplate) => {
    setSelectedTemplate(template);
    setAddStep('date');
    if (Platform.OS !== 'web') {
      setShowDatePicker(true);
    }
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;

    const doc: UserDocument = {
      id: Date.now().toString(),
      templateId: selectedTemplate.id,
      label: selectedTemplate.label,
      category: selectedTemplate.category,
      expiryDate: expiryDate.toISOString().split('T')[0],
      alertDays: selectedTemplate.alertDays,
      icon: selectedTemplate.icon,
      notes: notes.trim(),
      notificationIds: [],
      createdAt: new Date().toISOString(),
    };

    const success = await addDocument(doc);
    if (success) {
      setShowAddModal(false);
      resetAddFlow();
    } else {
      // Paywall hit
      setShowAddModal(false);
      resetAddFlow();
      setShowPaywall(true);
    }
  };

  const handleDelete = (id: string, label: string) => {
    Alert.alert(
      'Remove Document',
      `Remove "${label}" from tracking? This will also cancel its scheduled notifications.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeDocument(id),
        },
      ]
    );
  };

  const handleDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setExpiryDate(selectedDate);
    }
  };

  const categories: (DocumentCategory | 'all')[] = [
    'all', 'visa', 'employment', 'travel', 'academic', 'immigration', 'other',
  ];
  const categoryLabels: Record<string, string> = { all: 'All', ...CATEGORY_LABELS };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Documents</Text>
            <Text style={styles.subtitle}>
              {documents.length} tracked{!isPremium ? ` · ${remaining} free left` : ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {categories.map((cat) => {
            const count =
              cat === 'all'
                ? documents.length
                : documents.filter((d) => d.category === cat).length;
            if (cat !== 'all' && count === 0) return null;
            return (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.filterChip,
                  filterCategory === cat && styles.filterChipActive,
                ]}
                onPress={() => setFilterCategory(cat)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterCategory === cat && styles.filterChipTextActive,
                  ]}
                >
                  {categoryLabels[cat]} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Document List */}
        {filteredDocs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyTitle}>No documents yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap "+ Add" to track your first document
            </Text>
          </View>
        ) : (
          filteredDocs
            .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
            .map((doc) => (
              <ExpiryCard
                key={doc.id}
                document={doc}
                onDelete={() => handleDelete(doc.id, doc.label)}
              />
            ))
        )}

        {/* Notification info */}
        {documents.length > 0 && (
          <View style={styles.infoCard}>
            <Text style={styles.infoIcon}>🔔</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Smart Alerts Active</Text>
              <Text style={styles.infoDesc}>
                Each document type has custom alert windows based on real-world renewal timelines.
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* ═══ ADD DOCUMENT MODAL ═══ */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => {
                  if (addStep === 'date') setAddStep('type');
                  else setShowAddModal(false);
                }}
              >
                <Text style={styles.modalBack}>
                  {addStep === 'date' ? '← Back' : 'Cancel'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {addStep === 'type' ? 'Select Document Type' : 'Set Expiry Date'}
              </Text>
              <View style={{ width: 60 }} />
            </View>

            {/* Step 1: Pick document type */}
            {addStep === 'type' && (
              <FlatList
                data={Object.entries(templatesByCategory)}
                keyExtractor={([category]) => category}
                showsVerticalScrollIndicator={false}
                renderItem={({ item: [category, templates] }) => {
                  if (templates.length === 0) return null;
                  return (
                    <View style={styles.templateSection}>
                      <Text style={styles.templateSectionTitle}>
                        {CATEGORY_LABELS[category as DocumentCategory]}
                      </Text>
                      {templates.map((tmpl) => {
                        const alreadyAdded = documents.some((d) => d.templateId === tmpl.id);
                        return (
                          <TouchableOpacity
                            key={tmpl.id}
                            style={[styles.templateRow, alreadyAdded && styles.templateRowDisabled]}
                            onPress={() => !alreadyAdded && selectTemplate(tmpl)}
                            activeOpacity={alreadyAdded ? 1 : 0.6}
                          >
                            <Text style={styles.templateIcon}>{tmpl.icon}</Text>
                            <View style={styles.templateInfo}>
                              <Text style={styles.templateLabel}>{tmpl.label}</Text>
                              <Text style={styles.templateDesc}>{tmpl.description}</Text>
                            </View>
                            {alreadyAdded ? (
                              <Text style={styles.addedBadge}>Added ✓</Text>
                            ) : (
                              <Text style={styles.templateArrow}>›</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                }}
              />
            )}

            {/* Step 2: Pick date + notes */}
            {addStep === 'date' && selectedTemplate && (
              <ScrollView style={styles.dateStep} showsVerticalScrollIndicator={false}>
                <View style={styles.selectedSummary}>
                  <Text style={styles.selectedIcon}>{selectedTemplate.icon}</Text>
                  <View>
                    <Text style={styles.selectedLabel}>{selectedTemplate.label}</Text>
                    <Text style={styles.selectedDesc}>
                      Alerts at: {selectedTemplate.alertDays.map((d) => `${d}d`).join(', ')}
                    </Text>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Expiry Date</Text>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text style={styles.dateButtonText}>
                    {expiryDate.toLocaleDateString('en-US', {
                      month: 'long', day: 'numeric', year: 'numeric',
                    })}
                  </Text>
                  <Text style={styles.dateButtonArrow}>📅</Text>
                </TouchableOpacity>

                {showDatePicker && (
                  <DateTimePicker
                    value={expiryDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDateChange}
                    minimumDate={new Date()}
                    style={styles.datePicker}
                  />
                )}

                {Platform.OS === 'ios' && showDatePicker && (
                  <TouchableOpacity
                    style={styles.datePickerDone}
                    onPress={() => setShowDatePicker(false)}
                  >
                    <Text style={styles.datePickerDoneText}>Done</Text>
                  </TouchableOpacity>
                )}

                <Text style={[styles.fieldLabel, { marginTop: spacing.xl }]}>
                  Notes (optional)
                </Text>
                <TextInput
                  style={styles.notesInput}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="e.g., Filed at USCIS Nebraska center"
                  placeholderTextColor={colors.text3}
                  multiline
                  maxLength={200}
                />

                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>Add to StatusVault</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ═══ PAYWALL MODAL ═══ */}
      <Modal visible={showPaywall} animationType="fade" transparent>
        <View style={styles.paywallOverlay}>
          <View style={styles.paywallSheet}>
            <Text style={styles.paywallEmoji}>⭐</Text>
            <Text style={styles.paywallTitle}>Upgrade to Premium</Text>
            <Text style={styles.paywallDesc}>
              You've used all {FREE_LIMIT} free document slots. Upgrade to track unlimited documents, get advanced alerts, and export your data.
            </Text>

            <View style={styles.paywallFeatures}>
              {[
                '✓ Unlimited document tracking',
                '✓ Advanced smart alerts',
                '✓ Encrypted data export & import',
                '✓ Priority support',
              ].map((feat, i) => (
                <Text key={i} style={styles.paywallFeature}>{feat}</Text>
              ))}
            </View>

            <View style={styles.paywallPriceRow}>
              <Text style={styles.paywallPrice}>$7.99</Text>
              <Text style={styles.paywallPeriod}>/year</Text>
            </View>
            <Text style={styles.paywallSavings}>Less than $0.67/month to protect your status</Text>

            <TouchableOpacity
              style={styles.paywallBtn}
              onPress={() => {
                // TODO: Integrate RevenueCat / expo-in-app-purchases
                Alert.alert(
                  'Coming Soon',
                  'In-app purchase will be available in the next update. For now, all features are unlocked for testing.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Unlock for Testing',
                      onPress: () => {
                        useStore.getState().setPremium(true);
                        setShowPaywall(false);
                      },
                    },
                  ]
                );
              }}
            >
              <Text style={styles.paywallBtnText}>Subscribe — $7.99/year</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.paywallClose}
              onPress={() => setShowPaywall(false)}
            >
              <Text style={styles.paywallCloseText}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: 20 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.text1 },
  subtitle: { ...typography.caption, color: colors.text3, marginTop: 2 },
  addBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md,
  },
  addBtnText: { ...typography.bodySemibold, color: colors.textInverse, fontSize: 14 },
  filterRow: { paddingHorizontal: spacing.screen, paddingBottom: spacing.lg, gap: spacing.sm },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterChipText: { ...typography.caption, color: colors.text2, fontSize: 12 },
  filterChipTextActive: { color: colors.textInverse, fontWeight: '700' },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xxxl,
    marginHorizontal: spacing.screen, alignItems: 'center', ...shadows.sm,
  },
  emptyIcon: { fontSize: 32, marginBottom: spacing.sm },
  emptyTitle: { ...typography.bodySemibold, color: colors.text2 },
  emptySubtitle: { ...typography.caption, color: colors.text3, textAlign: 'center', marginTop: 4 },
  infoCard: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.lg, marginHorizontal: spacing.screen, marginTop: spacing.md, ...shadows.sm,
  },
  infoIcon: { fontSize: 24 },
  infoContent: { flex: 1 },
  infoTitle: { ...typography.captionBold, color: colors.text1 },
  infoDesc: { ...typography.caption, color: colors.text3, marginTop: 2, fontSize: 12, lineHeight: 18 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, maxHeight: '85%', paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  modalBack: { ...typography.bodySemibold, color: colors.accent, fontSize: 14 },
  modalTitle: { ...typography.h3, color: colors.text1 },

  // Templates
  templateSection: { paddingTop: spacing.lg },
  templateSectionTitle: {
    ...typography.micro, color: colors.text3, letterSpacing: 1, paddingHorizontal: spacing.screen, marginBottom: spacing.sm,
  },
  templateRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.screen,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight, gap: spacing.md,
  },
  templateRowDisabled: { opacity: 0.4 },
  templateIcon: { fontSize: 28 },
  templateInfo: { flex: 1 },
  templateLabel: { ...typography.bodySemibold, color: colors.text1, fontSize: 14 },
  templateDesc: { ...typography.caption, color: colors.text3, fontSize: 12, marginTop: 1 },
  addedBadge: { ...typography.caption, color: colors.success, fontWeight: '600', fontSize: 12 },
  templateArrow: { fontSize: 24, color: colors.text3 },

  // Date step
  dateStep: { padding: spacing.screen },
  selectedSummary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.accentLight,
    padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.xxl,
  },
  selectedIcon: { fontSize: 32 },
  selectedLabel: { ...typography.bodySemibold, color: colors.primary },
  selectedDesc: { ...typography.caption, color: colors.accent, fontSize: 12, marginTop: 2 },
  fieldLabel: { ...typography.captionBold, color: colors.text2, marginBottom: spacing.sm, letterSpacing: 0.3 },
  dateButton: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.card, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border,
  },
  dateButtonText: { ...typography.bodySemibold, color: colors.text1 },
  dateButtonArrow: { fontSize: 20 },
  datePicker: { marginTop: spacing.sm },
  datePickerDone: { alignSelf: 'flex-end', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  datePickerDoneText: { ...typography.bodySemibold, color: colors.accent },
  notesInput: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.lg, ...typography.body, color: colors.text1, minHeight: 80, textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xxl,
  },
  saveBtnText: { ...typography.bodySemibold, color: colors.textInverse, fontSize: 16 },

  // ─── Paywall Modal ─────────────────────────────────────────
  paywallOverlay: {
    flex: 1, backgroundColor: 'rgba(11,31,59,0.7)', justifyContent: 'center',
    alignItems: 'center', padding: 24,
  },
  paywallSheet: {
    backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%',
    maxWidth: 380, alignItems: 'center',
  },
  paywallEmoji: { fontSize: 40, marginBottom: 12 },
  paywallTitle: { fontSize: 22, fontWeight: '800', color: colors.text1, marginBottom: 8, textAlign: 'center' },
  paywallDesc: { fontSize: 14, color: colors.text2, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  paywallFeatures: { width: '100%', marginBottom: 20 },
  paywallFeature: { fontSize: 14, color: colors.text1, fontWeight: '500', paddingVertical: 6 },
  paywallPriceRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 },
  paywallPrice: { fontSize: 36, fontWeight: '900', color: colors.primary },
  paywallPeriod: { fontSize: 16, color: colors.text3, marginLeft: 4 },
  paywallSavings: { fontSize: 12, color: colors.success, fontWeight: '600', marginBottom: 20 },
  paywallBtn: {
    backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16,
    width: '100%', alignItems: 'center', marginBottom: 12,
  },
  paywallBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  paywallClose: { paddingVertical: 10 },
  paywallCloseText: { fontSize: 14, color: colors.text3, fontWeight: '600' },
});
