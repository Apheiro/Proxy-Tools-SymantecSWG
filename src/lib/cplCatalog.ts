import {
  POLICY_CAPABILITIES,
  POLICY_COLUMNS,
} from '@/lib/cplCapabilities';
import type { CplAtomKind } from '@/lib/cplDocument';
/** Suggestions from Broadcom examples. Imported/custom gestures are not restricted to this list. */
export interface CplGesture {
  name: string;
  kind: CplAtomKind;
  form: 'equals' | 'call' | 'bare';
  hint: string;
  family: string;
}
/** Both the guided and advanced editors share one capability registry. */
export const CPL_GESTURES: CplGesture[] = [
  ...POLICY_CAPABILITIES.map((capability) => ({
    name: capability.name,
    kind:
      capability.form === 'equals'
        ? ('condition' as const)
        : ('property' as const),
    form: capability.form,
    hint:
      capability.label +
      (capability.choices
        ? `: ${capability.choices.join(' / ')}`
        : ''),
    family:
      POLICY_COLUMNS.find((column) => column.id === capability.column)
        ?.label || 'Advanced',
  })),
  {
    name: 'condition',
    kind: 'condition',
    form: 'equals',
    hint: 'Named condition; !name negates the reference',
    family: 'References',
  },
];
export const CPL_LAYERS = [
  { name: 'Proxy', label: 'Web access / request policy' },
  { name: 'Cache', label: 'Cache and response policy' },
  { name: 'Forward', label: 'Forwarding policy' },
  { name: 'SSL', label: 'SSL policy' },
  { name: 'SSL-Intercept', label: 'TLS interception policy' },
  { name: 'Admin', label: 'Administration access / authentication' },
  { name: 'dns-proxy', label: 'DNS access policy' },
  { name: 'diagnostic', label: 'Diagnostic policy' },
];
export const CPL_REFERENCE =
  'https://techdocs.broadcom.com/us/en/symantec-security-software/web-and-network-security/edge-swg/7-3/overview4/writing_CPL.html';
