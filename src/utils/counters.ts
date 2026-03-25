// ═══════════════════════════════════════════════════════════════
// StatusVault — Immi Counter Templates
// Predefined immigration-related day counters
// ═══════════════════════════════════════════════════════════════

export interface CounterTemplate {
  id: string;
  label: string;
  icon: string;
  maxDays: number;
  description: string;
  warnAt: number;   // days used to turn orange
  critAt: number;   // days used to turn red
}

export const COUNTER_TEMPLATES: CounterTemplate[] = [
  {
    id: 'opt-unemployment',
    label: 'OPT Unemployment Days',
    icon: '⏱️',
    maxDays: 90,
    description: '90-day unemployment limit during post-completion OPT',
    warnAt: 60,
    critAt: 80,
  },
  {
    id: 'stem-unemployment',
    label: 'STEM OPT Unemployment Days',
    icon: '🔬',
    maxDays: 150,
    description: '150-day cumulative unemployment limit during STEM OPT extension',
    warnAt: 100,
    critAt: 130,
  },
  {
    id: 'h1b-grace',
    label: 'H-1B Grace Period',
    icon: '💼',
    maxDays: 60,
    description: '60-day grace period after H-1B employment ends to find new sponsor or change status',
    warnAt: 40,
    critAt: 52,
  },
  {
    id: 'f1-grace',
    label: 'F-1 Grace Period',
    icon: '🎓',
    maxDays: 60,
    description: '60-day grace period after OPT ends or program completion to depart or change status',
    warnAt: 40,
    critAt: 52,
  },
  {
    id: 'visitor-stay',
    label: 'B-1/B-2 Visitor Stay',
    icon: '🛂',
    maxDays: 180,
    description: 'Track days of authorized stay on B-1/B-2 visitor visa (typically up to 180 days)',
    warnAt: 140,
    critAt: 165,
  },
  {
    id: 'tax-presence',
    label: 'Days in US (Tax Year)',
    icon: '📊',
    maxDays: 183,
    description: 'Substantial Presence Test — 183+ days in current year may make you a tax resident',
    warnAt: 150,
    critAt: 175,
  },
  {
    id: 'j1-grace',
    label: 'J-1 Grace Period',
    icon: '🌐',
    maxDays: 30,
    description: '30-day grace period after J-1 program ends to depart the US',
    warnAt: 20,
    critAt: 26,
  },
];

export const getCounterTemplate = (id: string): CounterTemplate | undefined =>
  COUNTER_TEMPLATES.find((t) => t.id === id);
