// ═══════════════════════════════════════════════════════════════
// StatusVault — Zustand Store (v5)
// Changes: Multiple Immi Counters, removed single unemployment
// ═══════════════════════════════════════════════════════════════

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserDocument, ChecklistItem } from '../types';
import {
  scheduleDocumentNotifications,
  cancelDocumentNotifications,
} from '../utils/notifications';
import { CHECKLIST_TEMPLATES } from '../utils/checklists';
import { COUNTER_TEMPLATES } from '../utils/counters';

const FREE_DOCUMENT_LIMIT = 6;

// ─── Checklist Instance ──────────────────────────────────────
export interface ChecklistInstance {
  templateId: string;
  label: string;
  icon: string;
  items: ChecklistItem[];
}

// ─── Immi Counter Instance ───────────────────────────────────
export interface ImmiCounter {
  templateId: string;
  label: string;
  icon: string;
  maxDays: number;
  warnAt: number;
  critAt: number;
  daysUsed: number;
  isTracking: boolean;       // auto-increment daily
  lastIncrementDate: string | null;
  startDate: string | null;
}

// ─── State ───────────────────────────────────────────────────
interface AppStore {
  hasOnboarded: boolean;
  documents: UserDocument[];
  checklists: ChecklistInstance[];
  counters: ImmiCounter[];
  notificationsEnabled: boolean;
  isPremium: boolean;

  // Documents
  addDocument: (doc: UserDocument) => Promise<boolean>;
  removeDocument: (id: string) => Promise<void>;
  updateDocument: (id: string, updates: Partial<UserDocument>) => Promise<void>;
  canAddDocument: () => boolean;
  getRemainingFreeSlots: () => number;
  setPremium: (v: boolean) => void;

  // Checklists
  addChecklist: (templateId: string) => void;
  removeChecklist: (templateId: string) => void;
  toggleChecklistItem: (templateId: string, itemId: string) => void;
  addCustomChecklistItem: (templateId: string, text: string) => void;
  hasChecklist: (templateId: string) => boolean;

  // Immi Counters
  addCounter: (templateId: string) => void;
  addCustomCounter: (label: string, maxDays: number) => void;
  removeCounter: (templateId: string) => void;
  hasCounter: (templateId: string) => boolean;
  incrementCounter: (templateId: string, days?: number) => void;
  decrementCounter: (templateId: string, days?: number) => void;
  resetCounter: (templateId: string) => void;
  setCounterTracking: (templateId: string, isTracking: boolean) => void;
  autoIncrementCounters: () => void;

  // Settings
  setNotificationsEnabled: (v: boolean) => void;
  setOnboarded: () => void;
  resetAllData: () => void;
  exportData: () => string;
  importData: (json: string) => boolean;
}

const today = () => new Date().toISOString().split('T')[0];

export const FREE_LIMIT = FREE_DOCUMENT_LIMIT;

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      hasOnboarded: false,
      documents: [],
      checklists: [],
      counters: [],
      notificationsEnabled: true,
      isPremium: false,

      // ─── Paywall ───────────────────────────────────────────
      canAddDocument: () => {
        const { documents, isPremium } = get();
        return isPremium || documents.length < FREE_DOCUMENT_LIMIT;
      },
      getRemainingFreeSlots: () => {
        const { documents, isPremium } = get();
        return isPremium ? 999 : Math.max(0, FREE_DOCUMENT_LIMIT - documents.length);
      },
      setPremium: (v) => set({ isPremium: v }),

      // ─── Documents ─────────────────────────────────────────
      addDocument: async (doc) => {
        if (!get().canAddDocument()) return false;
        let notificationIds: string[] = [];
        if (get().notificationsEnabled) {
          try { notificationIds = await scheduleDocumentNotifications(doc); } catch {}
        }
        set((s) => ({ documents: [...s.documents, { ...doc, notificationIds }] }));
        return true;
      },
      removeDocument: async (id) => {
        const doc = get().documents.find((d) => d.id === id);
        if (doc?.notificationIds?.length) await cancelDocumentNotifications(doc.notificationIds);
        set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
      },
      updateDocument: async (id, updates) => {
        const doc = get().documents.find((d) => d.id === id);
        if (doc?.notificationIds?.length) await cancelDocumentNotifications(doc.notificationIds);
        let notificationIds: string[] = [];
        if (get().notificationsEnabled) {
          try { notificationIds = await scheduleDocumentNotifications({ ...doc!, ...updates } as UserDocument); } catch {}
        }
        set((s) => ({
          documents: s.documents.map((d) => d.id === id ? { ...d, ...updates, notificationIds } : d),
        }));
      },

      // ─── Checklists ───────────────────────────────────────
      addChecklist: (templateId) => {
        const t = CHECKLIST_TEMPLATES.find((x) => x.id === templateId);
        if (!t || get().checklists.some((c) => c.templateId === templateId)) return;
        set((s) => ({
          checklists: [...s.checklists, {
            templateId: t.id, label: t.label, icon: t.icon,
            items: t.items.map((i) => ({ ...i, done: false })),
          }],
        }));
      },
      removeChecklist: (templateId) => {
        set((s) => ({ checklists: s.checklists.filter((c) => c.templateId !== templateId) }));
      },
      toggleChecklistItem: (templateId, itemId) => {
        set((s) => ({
          checklists: s.checklists.map((cl) =>
            cl.templateId === templateId
              ? { ...cl, items: cl.items.map((i) => i.id === itemId ? { ...i, done: !i.done } : i) }
              : cl
          ),
        }));
      },
      addCustomChecklistItem: (templateId, text) => {
        set((s) => ({
          checklists: s.checklists.map((cl) =>
            cl.templateId === templateId
              ? { ...cl, items: [...cl.items, { id: `c-${Date.now()}`, text, done: false, category: 'Custom' }] }
              : cl
          ),
        }));
      },
      hasChecklist: (templateId) => get().checklists.some((c) => c.templateId === templateId),

      // ─── Immi Counters ─────────────────────────────────────
      addCounter: (templateId) => {
        const t = COUNTER_TEMPLATES.find((x) => x.id === templateId);
        if (!t || get().counters.some((c) => c.templateId === templateId)) return;
        set((s) => ({
          counters: [...s.counters, {
            templateId: t.id, label: t.label, icon: t.icon,
            maxDays: t.maxDays, warnAt: t.warnAt, critAt: t.critAt,
            daysUsed: 0, isTracking: false, lastIncrementDate: null, startDate: null,
          }],
        }));
      },

      addCustomCounter: (label, maxDays) => {
        const id = `custom-${Date.now()}`;
        set((s) => ({
          counters: [...s.counters, {
            templateId: id, label, icon: '🔢', maxDays,
            warnAt: Math.floor(maxDays * 0.7), critAt: Math.floor(maxDays * 0.9),
            daysUsed: 0, isTracking: false, lastIncrementDate: null, startDate: null,
          }],
        }));
      },

      removeCounter: (templateId) => {
        set((s) => ({ counters: s.counters.filter((c) => c.templateId !== templateId) }));
      },
      hasCounter: (templateId) => get().counters.some((c) => c.templateId === templateId),

      incrementCounter: (templateId, days = 1) => {
        set((s) => ({
          counters: s.counters.map((c) =>
            c.templateId === templateId
              ? { ...c, daysUsed: Math.min(c.maxDays, c.daysUsed + days) }
              : c
          ),
        }));
      },
      decrementCounter: (templateId, days = 1) => {
        set((s) => ({
          counters: s.counters.map((c) =>
            c.templateId === templateId
              ? { ...c, daysUsed: Math.max(0, c.daysUsed - days) }
              : c
          ),
        }));
      },
      resetCounter: (templateId) => {
        set((s) => ({
          counters: s.counters.map((c) =>
            c.templateId === templateId
              ? { ...c, daysUsed: 0, isTracking: false, lastIncrementDate: null, startDate: null }
              : c
          ),
        }));
      },
      setCounterTracking: (templateId, isTracking) => {
        set((s) => ({
          counters: s.counters.map((c) =>
            c.templateId === templateId
              ? { ...c, isTracking, startDate: isTracking ? today() : c.startDate, lastIncrementDate: isTracking ? today() : null }
              : c
          ),
        }));
      },
      autoIncrementCounters: () => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        set((s) => ({
          counters: s.counters.map((c) => {
            if (!c.isTracking || !c.lastIncrementDate) return c;
            const last = new Date(c.lastIncrementDate);
            last.setHours(0, 0, 0, 0);
            const diff = Math.floor((now.getTime() - last.getTime()) / 86400000);
            if (diff <= 0) return c;
            return { ...c, daysUsed: Math.min(c.maxDays, c.daysUsed + diff), lastIncrementDate: today() };
          }),
        }));
      },

      // ─── Settings ──────────────────────────────────────────
      setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
      setOnboarded: () => set({ hasOnboarded: true }),
      resetAllData: () => set({
        hasOnboarded: false, documents: [], checklists: [], counters: [],
        notificationsEnabled: true, isPremium: false,
      }),
      exportData: () => {
        const { documents, checklists, counters, isPremium } = get();
        return JSON.stringify({ app: 'StatusVault', version: '1.1.0', exportedAt: new Date().toISOString(), data: { documents, checklists, counters, isPremium } }, null, 2);
      },
      importData: (json) => {
        try {
          const p = JSON.parse(json);
          if (p.app !== 'StatusVault' || !p.data) return false;
          set({ documents: p.data.documents || [], checklists: p.data.checklists || [], counters: p.data.counters || [], isPremium: p.data.isPremium || false, hasOnboarded: true });
          return true;
        } catch { return false; }
      },
    }),
    {
      name: 'statusvault-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        hasOnboarded: s.hasOnboarded, documents: s.documents, checklists: s.checklists,
        counters: s.counters, notificationsEnabled: s.notificationsEnabled, isPremium: s.isPremium,
      }),
    }
  )
);
