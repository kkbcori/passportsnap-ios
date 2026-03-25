// ═══════════════════════════════════════════════════════════════
// StatusVault — Checklist Templates
// Sourced from USCIS, State Dept, university ISSS offices
// Each template includes all real required steps/documents
// ═══════════════════════════════════════════════════════════════

import { ChecklistItem } from '../types';

export interface ChecklistTemplate {
  id: string;
  label: string;
  icon: string;
  description: string;
  items: Omit<ChecklistItem, 'done'>[];
}

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  // ─── OPT Application ──────────────────────────────────────
  {
    id: 'opt-application',
    label: 'OPT Application',
    icon: '📋',
    description: 'Post-Completion Optional Practical Training (I-765)',
    items: [
      { id: 'opt-01', text: 'Confirm graduation eligibility with academic department', category: 'OPT' },
      { id: 'opt-02', text: 'Request OPT recommendation from DSO (I-20 endorsement)', category: 'OPT' },
      { id: 'opt-03', text: 'Receive OPT-endorsed I-20 from international office', category: 'OPT' },
      { id: 'opt-04', text: 'Sign I-20 Student Attestation section (page 1)', category: 'OPT' },
      { id: 'opt-05', text: 'Complete Form I-765 (online or paper)', category: 'OPT' },
      { id: 'opt-06', text: 'Prepare two U.S. passport-style photos (white background, <30 days old)', category: 'OPT' },
      { id: 'opt-07', text: 'Copy of passport identity page (all correction/extension pages)', category: 'OPT' },
      { id: 'opt-08', text: 'Copy of most recent F-1 visa stamp (or change of status notice)', category: 'OPT' },
      { id: 'opt-09', text: 'Copy of most recent I-94 arrival record (electronic printout)', category: 'OPT' },
      { id: 'opt-10', text: 'Copies of all previous I-20s for current degree level', category: 'OPT' },
      { id: 'opt-11', text: 'Copy of previous EAD card (front and back) — if applicable', category: 'OPT' },
      { id: 'opt-12', text: 'Pay I-765 filing fee ($470 — check USCIS for current amount)', category: 'OPT' },
      { id: 'opt-13', text: 'File I-765 within 30 days of OPT I-20 issuance date', category: 'OPT' },
      { id: 'opt-14', text: 'File no later than 60 days after program end date', category: 'OPT' },
      { id: 'opt-15', text: 'Receive USCIS receipt notice (I-797C)', category: 'OPT' },
      { id: 'opt-16', text: 'Receive EAD card from USCIS', category: 'OPT' },
      { id: 'opt-17', text: 'Report employment details to DSO within 10 days of start', category: 'OPT' },
      { id: 'opt-18', text: 'Update SEVP Portal with employer information', category: 'OPT' },
    ],
  },

  // ─── STEM OPT Extension ────────────────────────────────────
  {
    id: 'stem-opt',
    label: 'STEM OPT Extension',
    icon: '🔬',
    description: '24-month STEM OPT extension (I-765 + I-983)',
    items: [
      { id: 'stem-01', text: 'Confirm STEM degree is on DHS STEM Designated Degree List', category: 'STEM OPT' },
      { id: 'stem-02', text: 'Verify employer is enrolled in E-Verify', category: 'STEM OPT' },
      { id: 'stem-03', text: 'Complete Form I-983 Training Plan with employer', category: 'STEM OPT' },
      { id: 'stem-04', text: 'Get I-983 signed by employer and student', category: 'STEM OPT' },
      { id: 'stem-05', text: 'Submit I-983 to DSO for review and approval', category: 'STEM OPT' },
      { id: 'stem-06', text: 'Request STEM OPT I-20 endorsement from DSO', category: 'STEM OPT' },
      { id: 'stem-07', text: 'Receive STEM OPT endorsed I-20', category: 'STEM OPT' },
      { id: 'stem-08', text: 'File I-765 for STEM extension (up to 90 days before OPT expires)', category: 'STEM OPT' },
      { id: 'stem-09', text: 'Include copy of STEM OPT I-20 with application', category: 'STEM OPT' },
      { id: 'stem-10', text: 'Include copy of previous EAD card', category: 'STEM OPT' },
      { id: 'stem-11', text: 'Include copy of degree and transcripts', category: 'STEM OPT' },
      { id: 'stem-12', text: 'Pay I-765 filing fee', category: 'STEM OPT' },
      { id: 'stem-13', text: 'Receive 180-day automatic extension while pending', category: 'STEM OPT' },
      { id: 'stem-14', text: 'Receive STEM OPT EAD card', category: 'STEM OPT' },
      { id: 'stem-15', text: 'Report to DSO every 6 months (self-evaluation on I-983)', category: 'STEM OPT' },
      { id: 'stem-16', text: 'Submit 12-month I-983 evaluation to DSO', category: 'STEM OPT' },
      { id: 'stem-17', text: 'Submit final I-983 evaluation at end of STEM OPT', category: 'STEM OPT' },
    ],
  },

  // ─── H-1B Visa Petition ────────────────────────────────────
  {
    id: 'h1b-petition',
    label: 'H-1B Visa Petition',
    icon: '💼',
    description: 'H-1B specialty occupation visa (employer-sponsored)',
    items: [
      { id: 'h1b-01', text: 'Employer creates USCIS online account', category: 'H-1B' },
      { id: 'h1b-02', text: 'Employer submits H-1B electronic registration (March)', category: 'H-1B' },
      { id: 'h1b-03', text: 'Pay H-1B registration fee ($215 per beneficiary)', category: 'H-1B' },
      { id: 'h1b-04', text: 'Wait for lottery selection notification', category: 'H-1B' },
      { id: 'h1b-05', text: 'Employer files Labor Condition Application (LCA) with DOL', category: 'H-1B' },
      { id: 'h1b-06', text: 'Receive LCA certification from DOL', category: 'H-1B' },
      { id: 'h1b-07', text: 'Prepare copy of passport (bio page + all stamps)', category: 'H-1B' },
      { id: 'h1b-08', text: 'Prepare copy of all degree diplomas and transcripts', category: 'H-1B' },
      { id: 'h1b-09', text: 'Credential evaluation report (for foreign degrees)', category: 'H-1B' },
      { id: 'h1b-10', text: 'Updated resume/CV with current job details', category: 'H-1B' },
      { id: 'h1b-11', text: 'Copy of current I-94 arrival record', category: 'H-1B' },
      { id: 'h1b-12', text: 'Copy of all previous I-797 approval notices', category: 'H-1B' },
      { id: 'h1b-13', text: 'Copy of all previous I-20s / DS-2019s (if former student)', category: 'H-1B' },
      { id: 'h1b-14', text: 'Copy of OPT/STEM OPT EAD cards (if applicable)', category: 'H-1B' },
      { id: 'h1b-15', text: 'Three most recent pay stubs', category: 'H-1B' },
      { id: 'h1b-16', text: 'Employer files Form I-129 with USCIS (within 90 days)', category: 'H-1B' },
      { id: 'h1b-17', text: 'Pay I-129 filing fees (base + fraud prevention + ACWIA)', category: 'H-1B' },
      { id: 'h1b-18', text: 'Receive I-797 receipt notice from USCIS', category: 'H-1B' },
      { id: 'h1b-19', text: 'Receive I-797 approval notice', category: 'H-1B' },
      { id: 'h1b-20', text: 'Schedule visa stamping interview (if consular processing)', category: 'H-1B' },
    ],
  },

  // ─── H-1B Visa Stamping ───────────────────────────────────
  {
    id: 'h1b-stamping',
    label: 'H-1B Visa Stamping',
    icon: '🛂',
    description: 'Documents for H-1B visa interview at U.S. consulate',
    items: [
      { id: 'h1bs-01', text: 'Complete DS-160 online visa application', category: 'H-1B Stamping' },
      { id: 'h1bs-02', text: 'Pay MRV visa application fee ($205)', category: 'H-1B Stamping' },
      { id: 'h1bs-03', text: 'Schedule visa interview appointment', category: 'H-1B Stamping' },
      { id: 'h1bs-04', text: 'DS-160 confirmation page (printed)', category: 'H-1B Stamping' },
      { id: 'h1bs-05', text: 'Passport (current — valid 6+ months)', category: 'H-1B Stamping' },
      { id: 'h1bs-06', text: 'Old passport(s) with previous visa stamps', category: 'H-1B Stamping' },
      { id: 'h1bs-07', text: 'I-797 approval notice (original)', category: 'H-1B Stamping' },
      { id: 'h1bs-08', text: 'Approved petition (Form I-129 copy)', category: 'H-1B Stamping' },
      { id: 'h1bs-09', text: 'Employer support/offer letter with job details and salary', category: 'H-1B Stamping' },
      { id: 'h1bs-10', text: 'Three most recent pay stubs', category: 'H-1B Stamping' },
      { id: 'h1bs-11', text: 'Resume/CV (updated)', category: 'H-1B Stamping' },
      { id: 'h1bs-12', text: 'Degree certificates and transcripts (originals)', category: 'H-1B Stamping' },
      { id: 'h1bs-13', text: 'U.S. passport-style photo (2x2 inch)', category: 'H-1B Stamping' },
      { id: 'h1bs-14', text: 'Marriage certificate (if bringing dependents)', category: 'H-1B Stamping' },
      { id: 'h1bs-15', text: 'Attend visa interview at U.S. consulate', category: 'H-1B Stamping' },
      { id: 'h1bs-16', text: 'Receive passport with H-1B visa stamp', category: 'H-1B Stamping' },
    ],
  },

  // ─── U.S. Passport Renewal ─────────────────────────────────
  {
    id: 'passport-renewal',
    label: 'U.S. Passport Renewal',
    icon: '🇺🇸',
    description: 'Renew by mail using Form DS-82',
    items: [
      { id: 'pass-01', text: 'Confirm eligibility: passport issued at age 16+, within last 15 years, undamaged', category: 'Passport' },
      { id: 'pass-02', text: 'Complete Form DS-82 (Passport Renewal Application)', category: 'Passport' },
      { id: 'pass-03', text: 'Sign and date the form', category: 'Passport' },
      { id: 'pass-04', text: 'Take new passport photo (2x2 inch, white background)', category: 'Passport' },
      { id: 'pass-05', text: 'Staple photo to the form', category: 'Passport' },
      { id: 'pass-06', text: 'Include most recent passport book/card', category: 'Passport' },
      { id: 'pass-07', text: 'Include name change documents if applicable (marriage cert/court order)', category: 'Passport' },
      { id: 'pass-08', text: 'Prepare payment: $130 for passport book ($30 additional for card)', category: 'Passport' },
      { id: 'pass-09', text: 'Optional: Add $60 for expedited processing', category: 'Passport' },
      { id: 'pass-10', text: 'Optional: Add $22.05 for 1-3 day delivery', category: 'Passport' },
      { id: 'pass-11', text: 'Mail application to address listed on DS-82', category: 'Passport' },
      { id: 'pass-12', text: 'Track status at passportstatus.state.gov', category: 'Passport' },
      { id: 'pass-13', text: 'Receive new passport (8-11 weeks routine / 5-7 weeks expedited)', category: 'Passport' },
      { id: 'pass-14', text: 'Receive old passport returned separately (allow 4 weeks)', category: 'Passport' },
    ],
  },

  // ─── First U.S. Passport (New) ─────────────────────────────
  {
    id: 'passport-new',
    label: 'First U.S. Passport Application',
    icon: '🛂',
    description: 'First-time application using Form DS-11 (in person)',
    items: [
      { id: 'pnew-01', text: 'Complete Form DS-11 online (do NOT sign until in person)', category: 'Passport' },
      { id: 'pnew-02', text: 'Proof of U.S. citizenship (original birth certificate or naturalization cert)', category: 'Passport' },
      { id: 'pnew-03', text: 'Photocopy of citizenship document (front and back)', category: 'Passport' },
      { id: 'pnew-04', text: 'Valid government-issued photo ID (driver\'s license, state ID)', category: 'Passport' },
      { id: 'pnew-05', text: 'Photocopy of photo ID (front and back)', category: 'Passport' },
      { id: 'pnew-06', text: 'One passport photo (2x2 inch, white background)', category: 'Passport' },
      { id: 'pnew-07', text: 'Know your Social Security number', category: 'Passport' },
      { id: 'pnew-08', text: 'Prepare payment: $165 total ($130 application + $35 execution fee)', category: 'Passport' },
      { id: 'pnew-09', text: 'Find and schedule at passport acceptance facility', category: 'Passport' },
      { id: 'pnew-10', text: 'Apply in person — sign form in front of acceptance agent', category: 'Passport' },
      { id: 'pnew-11', text: 'Track status at passportstatus.state.gov', category: 'Passport' },
      { id: 'pnew-12', text: 'Receive new passport', category: 'Passport' },
    ],
  },

  // ─── F-1 Visa Application ──────────────────────────────────
  {
    id: 'f1-visa',
    label: 'F-1 Student Visa Application',
    icon: '🎓',
    description: 'Initial F-1 visa application at U.S. consulate',
    items: [
      { id: 'f1-01', text: 'Receive I-20 from SEVP-certified school', category: 'F-1 Visa' },
      { id: 'f1-02', text: 'Pay SEVIS I-901 fee ($350)', category: 'F-1 Visa' },
      { id: 'f1-03', text: 'Complete DS-160 online visa application', category: 'F-1 Visa' },
      { id: 'f1-04', text: 'Upload photo meeting State Department requirements', category: 'F-1 Visa' },
      { id: 'f1-05', text: 'Pay visa application fee (MRV fee ~$185)', category: 'F-1 Visa' },
      { id: 'f1-06', text: 'Schedule visa interview at nearest U.S. embassy/consulate', category: 'F-1 Visa' },
      { id: 'f1-07', text: 'Passport valid for 6+ months beyond period of stay', category: 'F-1 Visa' },
      { id: 'f1-08', text: 'DS-160 confirmation page (printed)', category: 'F-1 Visa' },
      { id: 'f1-09', text: 'SEVIS I-901 fee receipt', category: 'F-1 Visa' },
      { id: 'f1-10', text: 'Signed I-20 form', category: 'F-1 Visa' },
      { id: 'f1-11', text: 'School acceptance/admission letter', category: 'F-1 Visa' },
      { id: 'f1-12', text: 'Financial documents proving ability to pay (bank statements, I-134, scholarship letter)', category: 'F-1 Visa' },
      { id: 'f1-13', text: 'Academic transcripts and diplomas', category: 'F-1 Visa' },
      { id: 'f1-14', text: 'Standardized test scores (GRE/GMAT/TOEFL if applicable)', category: 'F-1 Visa' },
      { id: 'f1-15', text: 'Evidence of ties to home country (property, family, employment)', category: 'F-1 Visa' },
      { id: 'f1-16', text: 'Attend visa interview', category: 'F-1 Visa' },
      { id: 'f1-17', text: 'Receive passport with F-1 visa stamp', category: 'F-1 Visa' },
    ],
  },

  // ─── Green Card (AOS) ──────────────────────────────────────
  {
    id: 'green-card-aos',
    label: 'Green Card (Adjustment of Status)',
    icon: '🟢',
    description: 'Employment-based I-485 AOS application',
    items: [
      { id: 'gc-01', text: 'Employer files PERM Labor Certification (ETA Form 9089)', category: 'Green Card' },
      { id: 'gc-02', text: 'Receive PERM approval from DOL', category: 'Green Card' },
      { id: 'gc-03', text: 'Employer files Form I-140 (Immigrant Petition)', category: 'Green Card' },
      { id: 'gc-04', text: 'Receive I-140 approval', category: 'Green Card' },
      { id: 'gc-05', text: 'Wait for priority date to become current (check Visa Bulletin)', category: 'Green Card' },
      { id: 'gc-06', text: 'File Form I-485 (Adjustment of Status)', category: 'Green Card' },
      { id: 'gc-07', text: 'File I-131 (Advance Parole for travel) concurrently', category: 'Green Card' },
      { id: 'gc-08', text: 'File I-765 (EAD work permit) concurrently', category: 'Green Card' },
      { id: 'gc-09', text: 'Prepare passport copies (all pages with stamps)', category: 'Green Card' },
      { id: 'gc-10', text: 'Birth certificate (with certified translation if not English)', category: 'Green Card' },
      { id: 'gc-11', text: 'Six passport-style photos', category: 'Green Card' },
      { id: 'gc-12', text: 'Complete medical examination (Form I-693) by USCIS civil surgeon', category: 'Green Card' },
      { id: 'gc-13', text: 'Vaccination records', category: 'Green Card' },
      { id: 'gc-14', text: 'Copy of all immigration documents (I-94, visa stamps, I-797s)', category: 'Green Card' },
      { id: 'gc-15', text: 'Financial evidence / Affidavit of Support (I-864 if applicable)', category: 'Green Card' },
      { id: 'gc-16', text: 'Attend biometrics appointment', category: 'Green Card' },
      { id: 'gc-17', text: 'Attend I-485 interview (if required)', category: 'Green Card' },
      { id: 'gc-18', text: 'Receive Green Card approval', category: 'Green Card' },
    ],
  },
];

/** Get template by ID */
export const getChecklistTemplate = (id: string): ChecklistTemplate | undefined =>
  CHECKLIST_TEMPLATES.find((t) => t.id === id);
