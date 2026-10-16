import { invoke } from '@tauri-apps/api/core';
import { inventoryProxyId } from '@/lib/proxyTags';
import { getLocalStorage } from '@/lib/utilsClient';
export const POLICY_SETTINGS_EVENT = 'policy-settings-changed';
export const MOCK_POLICY_PASSWORD = 'mock-central-policy-password';
export interface CentralSettings {
  host: string;
  port: number;
  path: string;
  username: string;
  shell: string;
  transport?: 'ssh' | 'https';
  format?: 'cpl' | 'project';
  url?: string;
}
export interface PolicySettings {
  centralEnabled: boolean;
  directEnabled: boolean;
  central: CentralSettings;
  hasPassword: boolean;
}
export const defaultPolicySettings: PolicySettings = {
  centralEnabled: false,
  directEnabled: true,
  central: {
    host: '',
    port: 22,
    path: '',
    username: '',
    shell: 'posix',
    transport: 'ssh',
    format: 'cpl',
    url: '',
  },
  hasPassword: false,
};
export interface PolicyHealth {
  healthy: boolean;
  issues: string[];
  warnings: string[];
}
export interface PolicyTarget {
  id: string;
  name: string;
  address: string;
}
export interface Inspection {
  target: PolicyTarget;
  fingerprint: string | null;
  health: PolicyHealth | null;
  error: string | null;
}
export interface Census {
  id: string;
  mocked: boolean;
  inspectedAt: string;
  rows: Inspection[];
  majority: string | null;
}
export interface FileDocument {
  id: string;
  content: string;
  health: PolicyHealth;
}
export interface PolicyProgress {
  id: string;
  running: boolean;
  mocked: boolean;
  rows: {
    id: string;
    name: string;
    status: string;
    message: string;
  }[];
}
export interface DiffLine {
  kind: 'equal' | 'delete' | 'insert';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}
export function getPolicySettings(mocked: boolean) {
  return invoke<PolicySettings>('get_policy_settings', {
    mocked,
  }).then((value) => ({
    ...defaultPolicySettings,
    ...value,
    central: { ...defaultPolicySettings.central, ...value.central },
  }));
}
export function policyTargets(): PolicyTarget[] {
  return (getLocalStorage<Proxy[]>('proxies') || []).map((proxy) => ({
    id: inventoryProxyId(proxy),
    name:
      proxy.hostname ||
      proxy.hostinfo?.hostname ||
      proxy.registered_address ||
      'Proxy',
    address:
      proxy.primary_address ||
      proxy.registered_address ||
      proxy.hostinfo?.ip ||
      proxy.hostname,
  }));
}
export function eligible(row: Inspection, census: Census) {
  return (
    !!census.majority &&
    row.health?.healthy &&
    row.fingerprint === census.majority
  );
}
export function editorText(value: string) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}
export function mockPolicyPassword(mocked: boolean) {
  return mocked ? localStorage.getItem(MOCK_POLICY_PASSWORD) : null;
}
