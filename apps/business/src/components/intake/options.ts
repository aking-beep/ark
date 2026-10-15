import type { DataClass, TaskShape } from '@ark/core';
import type { Regime } from '@/lib/intake-state';

/**
 * The intake's option lists, grouped. Ten chips in one wall reads as ten equal
 * choices; they are not. Calculate and Look up are the fork where the report
 * stops recommending a model, so they sit apart and say so.
 */

export interface Option<T extends string> {
  id: T;
  label: string;
  help?: string;
}

export interface OptionGroup<T extends string> {
  label: string;
  note?: string;
  /** The not-AI fork: drawn apart from the rest. */
  fork?: boolean;
  options: Option<T>[];
}

export const SHAPE_GROUPS: OptionGroup<TaskShape>[] = [
  {
    label: 'Language work',
    options: [
      { id: 'classify', label: 'Classify', help: 'route, tag, triage, score' },
      { id: 'extract', label: 'Extract', help: 'pull fields out of unstructured input' },
      { id: 'summarize', label: 'Summarise', help: 'compress long material' },
      { id: 'generate', label: 'Generate', help: 'draft prose, code, replies' },
      { id: 'converse', label: 'Converse', help: 'multi-turn dialogue with a person' },
      { id: 'search', label: 'Search', help: 'find material in a corpus' },
    ],
  },
  {
    label: 'Consequential',
    options: [
      { id: 'decide', label: 'Decide', help: 'choose among options with consequences' },
      { id: 'act', label: 'Act', help: 'take an action in another system' },
    ],
  },
  {
    label: 'Deterministic — usually not AI',
    note: 'Pick only these and the verdict is decided here: a query or a rule, not a model.',
    fork: true,
    options: [
      { id: 'calculate', label: 'Calculate', help: 'deterministic arithmetic or logic' },
      { id: 'lookup', label: 'Look up', help: 'fetch a known record by key' },
    ],
  },
];

export const DATA_CLASS_GROUPS: OptionGroup<DataClass>[] = [
  {
    label: 'Low sensitivity',
    options: [
      { id: 'public', label: 'Public', help: 'Already published. No disclosure risk.' },
      { id: 'internal', label: 'Internal', help: 'Not secret, not for outsiders.' },
    ],
  },
  {
    label: 'Personal',
    options: [
      { id: 'pii', label: 'Personal data', help: 'Names, emails, addresses, identifiers.' },
      { id: 'sensitive_pii', label: 'Sensitive personal data', help: 'Government ID, biometrics.' },
      { id: 'phi', label: 'Health data', help: 'Anything that makes this HIPAA-shaped.' },
      { id: 'minors', label: 'Data about minors', help: 'People under 18.' },
    ],
  },
  {
    label: 'Financial and secrets',
    options: [
      { id: 'pci', label: 'Cardholder data', help: 'PANs, CVVs, anything in PCI scope.' },
      { id: 'financial', label: 'Financial', help: 'Balances, transactions, payroll.' },
      { id: 'credentials', label: 'Credentials', help: 'Keys, tokens, passwords.' },
      { id: 'trade_secret', label: 'Trade secret', help: 'Source, formulas, unreleased strategy.' },
    ],
  },
];

export const REGIME_GROUPS: OptionGroup<Regime>[] = [
  { label: 'None', options: [{ id: 'none', label: 'None that I know of' }] },
  {
    label: 'Privacy',
    options: [
      { id: 'gdpr', label: 'GDPR' },
      { id: 'ccpa', label: 'CCPA/CPRA' },
    ],
  },
  {
    label: 'Sector',
    options: [
      { id: 'hipaa', label: 'HIPAA' },
      { id: 'pci', label: 'PCI DSS' },
      { id: 'sox', label: 'SOX' },
      { id: 'glba', label: 'GLBA' },
      { id: 'ferpa', label: 'FERPA' },
    ],
  },
  { label: 'AI-specific', options: [{ id: 'eu_ai_act', label: 'EU AI Act' }] },
];
