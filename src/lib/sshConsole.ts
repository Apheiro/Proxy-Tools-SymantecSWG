export interface SshBlock {
  id: number;
  command: string;
  createdAt: string;
  bytes: number;
  complete: boolean;
}
export interface SshSession {
  id: string;
  appliance: string;
  address: string;
  mocked: boolean;
  createdAt: string;
  phase: string;
  connected: boolean;
  busy: boolean;
  inputMode: 'command' | 'secret' | 'response' | 'waiting' | 'closed';
  prompt: string;
  error: string | null;
  blocks: SshBlock[];
}
export interface SshOutputPage {
  text: string;
  nextOffset: number;
  total: number;
}
