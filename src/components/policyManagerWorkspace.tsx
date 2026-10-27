'use client';
import { Channel, invoke } from '@tauri-apps/api/core';
import {
  Download,
  FileCode2,
  FilePlus2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import CplEditor from '@/components/cplEditor';
import PageHeader from '@/components/pageHeader';
import PolicyDiff from '@/components/policyDiff';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import { cva } from '@/lib/cva';
import getCredentials from '@/lib/getCredentials';
import {
  type Census,
  type DiffLine,
  defaultPolicySettings,
  editorText,
  eligible,
  type FileDocument,
  getPolicySettings,
  mockPolicyPassword,
  POLICY_SETTINGS_EVENT,
  type PolicyHealth,
  type PolicyProgress,
  type PolicySettings,
  policyTargets,
} from '@/lib/policyManager';
import {
  decodeSharedPolicy,
  encodeSharedPolicy,
} from '@/lib/policySharedDocument';
import useDataSourceMode from '@/lib/useDataSourceMode';

const rowStyle = cva({
  base: 'flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-3',
  variants: {
    excluded: {
      true: 'border-destructive/40 bg-destructive/5',
      false: 'border-border',
    },
  },
});
const statusStyle = cva({
  base: 'rounded border px-2 py-0.5 text-[11px]',
  variants: {
    status: {
      pending: 'text-muted-foreground',
      running: 'border-primary/40 text-primary',
      success:
        'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
      failed: 'border-destructive/40 text-destructive',
      conflict: 'border-destructive/40 text-destructive',
    },
  },
});
type Confirmation = {
  kind: 'central' | 'direct';
  lines: DiffLine[];
  ids: string[];
  repair: boolean;
};
export default function PolicyManagerWorkspace() {
  const { mode, ready } = useDataSourceMode();
  // Mount a new controller for each profile: drafts and snapshots never cross profiles.
  return ready ? (
    <PolicyWorkspace key={mode} mocked={mode === 'mock'} />
  ) : (
    <p className='text-sm text-muted-foreground'>
      Loading policy workspace…
    </p>
  );
}
function PolicyWorkspace({ mocked }: { mocked: boolean }) {
  const id = useId();
  const [settings, setSettings] = useState<PolicySettings>(
    defaultPolicySettings,
  );
  const [loaded, setLoaded] = useState(false);
  const [method, setMethod] = useState<'central' | 'direct'>(
    'direct',
  );
  const [census, setCensus] = useState<Census | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionRows, setInspectionRows] = useState<{
    id: string;
    name: string;
    status: string;
    message: string;
  }[]>([]);
  const [source, setSource] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [original, setOriginal] = useState('');
  const [draft, setDraft] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [draftOrigin, setDraftOrigin] = useState<
    'new' | 'imported' | 'shared'
  >('new');
  const [newPolicyOpen, setNewPolicyOpen] = useState(false);
  const [newPolicyRevision, setNewPolicyRevision] = useState(0);
  const [health, setHealth] = useState<PolicyHealth | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [sharedDocumentId, setSharedDocumentId] = useState('');
  const [forceSource, setForceSource] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<PolicyProgress | null>(
    null,
  );
  const [comparison, setComparison] = useState<{
    title: string;
    lines: DiffLine[];
    latest?: FileDocument;
  } | null>(null);
  const [confirmation, setConfirmation] =
    useState<Confirmation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const firstSettings = useRef(true);
  const mounted = useRef(true);
  const dirty = draft !== (creatingNew ? '' : editorText(original));
  const running = !!progress?.running;
  const blocked = !!busy || running;
  const available =
    method === 'central'
      ? settings.centralEnabled
      : settings.directEnabled;
  const inspected =
    creatingNew ||
    !!(method === 'central' ? documentId : source && census);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const read = () =>
      getPolicySettings(mocked)
        .then((value) => {
          if (!active || !value) return;
          setSettings(value);
          setLoaded(true);
          if (firstSettings.current) {
            setMethod(value.centralEnabled ? 'central' : 'direct');
            firstSettings.current = false;
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    void read();
    window.addEventListener(POLICY_SETTINGS_EVENT, read);
    return () => {
      active = false;
      window.removeEventListener(POLICY_SETTINGS_EVENT, read);
    };
  }, [mocked]);
  useEffect(() => {
    let active = true;
    const poll = () =>
      invoke<PolicyProgress | null>('get_policy_progress', { mocked })
        .then((value) => {
          if (active) setProgress(value);
        })
        .catch(() => undefined);
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [mocked]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || running) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, running]);
  async function action(label: string, task: () => Promise<void>) {
    if (blocked) return;
    setBusy(label);
    setError('');
    try {
      await task();
    } catch (e) {
      if (mounted.current) {
        setError(String(e));
        toast.error(String(e));
      }
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  function credentials() {
    const value = getCredentials();
    if (!value)
      throw new Error(
        'Save proxy SSH credentials in Settings first.',
      );
    return value;
  }
  function loadText(text: string, nextHealth: PolicyHealth) {
    setSharedDocumentId('');
    setCreatingNew(false);
    setOriginal(text);
    setDraft(editorText(text));
    setHealth(nextHealth);
  }
  function startNewPolicy() {
    setSharedDocumentId('');
    setDraftOrigin('new');
    setCreatingNew(true);
    setNewPolicyRevision((value) => value + 1);
    setOriginal('');
    setDraft('');
    setDocumentId('');
    setHealth({
      healthy: true,
      issues: [],
      warnings: [
        'New local draft. CPL is validated by the appliance compiler when applied.',
      ],
    });
    setSource(
      census?.rows.find((row) => eligible(row, census))?.target.id ||
        '',
    );
    setForceSource(false);
    setError('');
    setNewPolicyOpen(false);
  }
  function exportPolicy(shared = false) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(
      new Blob([shared ? encodeSharedPolicy(draft) : draft], {
        type: shared
          ? 'application/json'
          : 'text/plain;charset=utf-8',
      }),
    );
    anchor.download = shared
      ? 'local-policy.json'
      : 'local-policy.cpl';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  async function scan() {
    await action('Inspecting all configured proxies…', async () => {
      if (dirty && !creatingNew)
        throw new Error(
          'Discard your draft before starting a new inspection.',
        );
      const targets = policyTargets();
      if (!targets.length)
        throw new Error('Add proxies in Proxy Workspace first.');
      const savedCredentials = credentials();
      setInspectionRows(targets.map((target) => ({
        id: target.id, name: target.name, status: 'pending',
        message: 'Queued (up to four SSH connections at once)',
      })));
      setInspecting(true);
      const onProgress = new Channel<{ id: string; status: string; message: string }>();
      onProgress.onmessage = (update) => {
        if (mounted.current) setInspectionRows((rows) => rows.map((row) =>
          row.id === update.id ? { ...row, ...update } : row,
        ));
      };
      let result: Census;
      try {
        result = await invoke<Census>('inspect_policies', {
          mocked, targets, ...savedCredentials, onProgress,
        });
        if (mounted.current) setInspectionRows((rows) => rows.map((row) => {
          const captured = result.rows.find((item) => item.target.id === row.id);
          return captured ? {
            ...row,
            status: captured.error ? 'failed' : 'complete',
            message: captured.error || (captured.health?.healthy
              ? 'Policy received and structural checks completed.'
              : `Policy received; review required: ${captured.health?.issues.join('; ') || 'Unknown format'}`),
          } : row;
        }));
      } catch (error) {
        if (mounted.current) setInspectionRows((rows) => rows.map((row) =>
          row.status === 'pending' || row.status === 'running'
            ? { ...row, status: 'failed', message: String(error) } : row,
        ));
        throw error;
      } finally {
        if (mounted.current) setInspecting(false);
      }
      if (!mounted.current) return;
      setCensus(result);
      if (creatingNew) {
        setSource(
          result.rows.find((row) => eligible(row, result))?.target
            .id || '',
        );
      } else {
        setSource('');
        setOriginal('');
        setDraft('');
        setHealth(null);
      }
      setSelected(
        result.rows
          .filter((row) => eligible(row, result))
          .map((row) => row.target.id),
      );
      setForceSource(false);
    });
  }
  async function selectSource(id: string) {
    await action('Reading captured source…', async () => {
      if (dirty && !creatingNew)
        throw new Error(
          'Discard your draft before changing the reference proxy.',
        );
      if (!census) return;
      if (creatingNew) {
        setSource(id);
        setForceSource(false);
        return;
      }
      const text = await invoke<string>('read_policy_snapshot', {
        mocked,
        scanId: census.id,
        targetId: id,
      });
      if (!mounted.current) return;
      const row = census.rows.find((r) => r.target.id === id);
      setSource(id);
      loadText(text, row!.health!);
      setForceSource(false);
    });
  }
  async function loadCentral() {
    await action('Reading remote CPL file…', async () => {
      if (dirty)
        throw new Error(
          'Discard your draft before reloading the remote file.',
        );
      const doc = await invoke<FileDocument>('read_central_policy', {
        mocked,
        mockPassword: mockPolicyPassword(mocked),
      });
      if (mounted.current) {
        setDocumentId(doc.id);
        loadText(doc.content, doc.health);
      }
    });
  }
  function changeMethod(next: 'central' | 'direct') {
    if (dirty) {
      toast.error(
        'Discard your draft before changing the editing method.',
      );
      return;
    }
    setCreatingNew(false);
    setSharedDocumentId('');
    setMethod(next);
    setOriginal('');
    setDraft('');
    setHealth(null);
    setDocumentId('');
    setSource('');
  }
  async function compare(targetId: string) {
    await action('Comparing policies…', async () => {
      if (!census) return;
      const row = census.rows.find((r) => r.target.id === targetId)!;
      const reference = census.rows.find(
        (r) => r.fingerprint === census.majority && r.health?.healthy,
      );
      if (!reference)
        throw new Error(
          'No strict majority exists. Load an explicit source to compare against.',
        );
      const [old, next] = await Promise.all([
        invoke<string>('read_policy_snapshot', {
          mocked,
          scanId: census.id,
          targetId: reference.target.id,
        }),
        invoke<string>('read_policy_snapshot', {
          mocked,
          scanId: census.id,
          targetId,
        }),
      ]);
      const lines = await invoke<DiffLine[]>('compare_policy_text', {
        old: editorText(old),
        new: editorText(next),
      });
      if (mounted.current)
        setComparison({
          title: `${reference.target.name} → ${row.target.name}`,
          lines,
        });
    });
  }
  async function compareLatestCentral() {
    await action(
      'Comparing latest remote file with your draft…',
      async () => {
        const latest = await invoke<FileDocument>(
          'read_central_policy',
          { mocked, mockPassword: mockPolicyPassword(mocked) },
        );
        const lines = await invoke<DiffLine[]>(
          'compare_policy_text',
          { old: editorText(latest.content), new: draft },
        );
        if (mounted.current)
          setComparison({
            title: 'Latest remote file → current draft',
            lines,
            latest,
          });
      },
    );
  }
  async function review(ids = selected, repair = false) {
    await action('Preparing replacement preview…', async () => {
      if (!inspected) throw new Error('Load a policy first.');
      if (method === 'direct' && !ids.length)
        throw new Error('Select a destination.');
      if (!draft.trim())
        throw new Error('Add policy content before continuing.');
      let baseline = original;
      if (method === 'central' && creatingNew && !documentId) {
        const doc = await invoke<FileDocument>(
          'read_central_policy',
          {
            mocked,
            mockPassword: mockPolicyPassword(mocked),
          },
        );
        if (!doc.health.healthy)
          throw new Error(
            'The remote file is not healthy. Review it before replacing it.',
          );
        if (!mounted.current) return;
        setDocumentId(doc.id);
        setOriginal(doc.content);
        baseline = doc.content;
      }
      const destination =
        method === 'direct' && census
          ? await invoke<string>('read_policy_snapshot', {
              mocked,
              scanId: census.id,
              targetId: ids[0],
            })
          : baseline;
      const lines = await invoke<DiffLine[]>('compare_policy_text', {
        old: editorText(destination),
        new: draft,
      });
      if (mounted.current) {
        setConfirmed(false);
        setConfirmation({ kind: method, lines, ids, repair });
      }
    });
  }
  async function apply() {
    if (!confirmation || !confirmed) return;
    const current = confirmation;
    setConfirmation(null);
    await action(
      current.kind === 'central'
        ? 'Saving remote file…'
        : 'Starting distribution…',
      async () => {
        if (current.kind === 'central') {
          const doc = await invoke<FileDocument>(
            'save_central_policy',
            {
              mocked,
              documentId,
              draft,
              mockPassword: mockPolicyPassword(mocked),
            },
          );
          if (mounted.current) {
            loadText(doc.content, doc.health);
            toast.success(
              'Remote CPL saved and verified. Distribution is handled by the external server.',
            );
          }
        } else {
          if (!census) return;
          const value = await invoke<PolicyProgress>(
            'distribute_policy',
            {
              request: {
                scanId: census.id,
                sourceId: source,
                targetIds: current.ids,
                draft,
                mocked,
                ...credentials(),
                forceSource,
                repair: current.repair,
                sharedDocumentId: sharedDocumentId || null,
                mockSharedPassword: sharedDocumentId
                  ? mockPolicyPassword(mocked)
                  : null,
              },
            },
          );
          if (mounted.current) {
            setProgress(value);
            setCensus(null);
            setSource('');
            toast.success(
              'Distribution started. Progress will remain available if you leave this page.',
            );
          }
        }
      },
    );
  }
  const sourceRow = census?.rows.find(
    (row) => row.target.id === source,
  );
  const sourceAllowed =
    !!sourceRow?.health?.healthy &&
    (forceSource ||
      (!!census?.majority &&
        sourceRow.fingerprint === census.majority));
  return (
    <>
      <Dialog open={newPolicyOpen} onOpenChange={setNewPolicyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new policy?</DialogTitle>
            <DialogDescription>
              Your unsaved draft will be discarded. The new policy
              starts empty and does not change any proxy or remote
              file until you review and confirm a replacement.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setNewPolicyOpen(false)}
            >
              Keep draft
            </Button>
            <Button onClick={startNewPolicy}>Discard & create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        icon={ShieldCheck}
        eyebrow='Policy operations'
        title='Local Policy Manager'
        description='Inspect, edit and distribute CPL without reordering existing rules. Central files and direct proxy distribution are independent.'
        actions={
          <span className='rounded-full border px-3 py-1 text-xs text-muted-foreground'>
            {mocked ? 'Mock · SSH localhost:2222' : 'Live · SSH'}
          </span>
        }
      />
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant={method === 'central' ? 'default' : 'outline'}
          disabled={blocked || !settings.centralEnabled}
          onClick={() => changeMethod('central')}
        >
          Central file{settings.centralEnabled ? '' : ' · disabled'}
        </Button>
        <Button
          size='sm'
          variant={method === 'direct' ? 'default' : 'outline'}
          disabled={blocked || !settings.directEnabled}
          onClick={() => changeMethod('direct')}
        >
          Direct proxies
          {settings.centralEnabled ? ' · alternative' : ''}
          {settings.directEnabled ? '' : ' · disabled'}
        </Button>
        <span className='text-xs text-muted-foreground'>
          Enable each method and configure central SSH in Settings.
        </span>
      </div>
      {error && (
        <div
          role='alert'
          className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
        >
          {error}
        </div>
      )}
      {!loaded ? (
        <p className='text-sm text-muted-foreground'>
          Loading settings…
        </p>
      ) : !available ? (
        <Card className='p-6 text-sm text-muted-foreground'>
          This method is disabled. Enable it in Settings → Local
          Policy Manager.
        </Card>
      ) : (
        <div className='flex min-w-0 flex-col gap-4'>
          <div className='min-w-0 space-y-4'>
            {method === 'central' ? (
              <Card className='gap-3 p-4'>
                <h2 className='text-sm font-semibold'>
                  Shared policy source
                </h2>
                <dl className='space-y-2 break-all text-xs'>
                  <div>
                    <dt className='text-muted-foreground'>Server</dt>
                    <dd>
                      {settings.central.transport === 'https' ? (
                        settings.central.url
                      ) : (
                        <>
                          {settings.central.host}:
                          {mocked ? 2222 : settings.central.port}
                          {mocked && ' (routed to localhost)'}
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>Path</dt>
                    <dd>
                      {settings.central.transport === 'https'
                        ? 'Direct download'
                        : settings.central.path}
                    </dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>Shell</dt>
                    <dd>
                      {settings.central.transport === 'https'
                        ? 'HTTPS · read-only'
                        : settings.central.shell}{' '}
                      ·{' '}
                      {settings.central.format === 'project'
                        ? 'Shared JSON v1'
                        : 'CPL'}
                    </dd>
                  </div>
                </dl>
                <p className='text-xs text-muted-foreground'>
                  {settings.central.transport === 'https'
                    ? 'Read-only HTTPS source. Export and upload through your hosting service to publish changes.'
                    : 'SSH scripts read and replace this file under a remote lock and check existing bytes before saving.'}{' '}
                  This app does not trigger the server’s HTTP/FTP
                  distribution.
                </p>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={blocked || dirty}
                  onClick={loadCentral}
                >
                  <RefreshCw className='size-4' />
                  Read remote file
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={
                    blocked ||
                    !inspected ||
                    !health?.healthy ||
                    !settings.directEnabled
                  }
                  onClick={() => {
                    setSharedDocumentId(documentId);
                    setDraftOrigin('shared');
                    setMethod('direct');
                    setCreatingNew(true);
                    setDocumentId('');
                    setSource(
                      census?.rows.find((row) =>
                        eligible(row, census),
                      )?.target.id || '',
                    );
                    setForceSource(false);
                  }}
                >
                  Use draft for direct distribution
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={blocked || !documentId}
                  onClick={compareLatestCentral}
                >
                  Compare remote & draft
                </Button>
              </Card>
            ) : (
              <Card className='gap-3 p-4'>
                <div className='flex items-center justify-between gap-2'>
                  <h2 className='text-sm font-semibold'>
                    Proxy inspection
                  </h2>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={blocked || (dirty && !creatingNew)}
                    onClick={scan}
                  >
                    {inspecting ? <LoaderCircle className='size-3.5 motion-safe:animate-spin' /> : <RefreshCw className='size-3.5' />}
                    {inspecting ? 'Inspecting…' : 'Inspect all'}
                  </Button>
                </div>
                <p className='text-xs text-muted-foreground'>
                  Every configured proxy is queried over SSH. A strict
                  majority is a comparison baseline, not a guarantee
                  that its policy is correct.
                </p>
                {inspectionRows.length > 0 && (
                  <div className='space-y-2' aria-label='Inspection progress' aria-busy={inspecting}>
                    <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                      <span aria-live='polite'>
                        {inspectionRows.filter((row) => row.status === 'complete' || row.status === 'failed').length} / {inspectionRows.length} proxies completed
                      </span>
                      <span>{inspecting ? 'Inspecting over SSH' : 'Inspection finished'}</span>
                    </div>
                    <progress
                      className='h-1.5 w-full accent-primary'
                      aria-label='Completed proxy inspections'
                      max={inspectionRows.length}
                      value={inspectionRows.filter((row) => row.status === 'complete' || row.status === 'failed').length}
                    />
                    <ScrollArea className='max-h-64 [&>[data-slot=scroll-area-viewport]]:max-h-64'>
                      <div className='space-y-2 pr-3'>
                        {inspectionRows.map((row) => (
                          <div key={row.id} className='flex items-start gap-2 rounded-md border p-2 text-xs'>
                            {row.status === 'running' && <LoaderCircle className='mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin' />}
                            <div className='min-w-0 flex-1'>
                              <div className='flex flex-wrap justify-between gap-2'>
                                <span className='font-medium'>{row.name}</span>
                                <span className={row.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{row.status}</span>
                              </div>
                              <p className='mt-1 break-words text-muted-foreground'>{row.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
                {census && (
                  <>
                    <p className='text-xs text-muted-foreground'>
                      {census.rows.length} proxies ·{' '}
                      {new Date(census.inspectedAt).toLocaleString()}
                    </p>
                    <p className='text-xs font-medium'>
                      {census.majority
                        ? `${census.rows.filter((row) => eligible(row, census)).length} in majority · ${census.rows.filter((row) => !eligible(row, census)).length} excluded`
                        : 'No strict majority — bulk distribution is disabled.'}
                    </p>
                    <label
                      htmlFor={`${id}-source`}
                      className='space-y-1 text-xs'
                    >
                      <span>
                        {creatingNew
                          ? 'Validation baseline'
                          : 'Reference source'}
                      </span>
                      <SelectField
                        id={`${id}-source`}
                        aria-label={
                          creatingNew
                            ? 'Validation baseline'
                            : 'Reference source'
                        }
                        value={source}
                        disabled={blocked || (dirty && !creatingNew)}
                        placeholder='Choose a captured policy'
                        onValueChange={selectSource}
                      >
                        {census.rows
                          .filter((row) => row.fingerprint)
                          .map((row) => (
                            <SelectOption
                              key={row.target.id}
                              value={row.target.id}
                            >
                              {row.target.name}
                              {eligible(row, census)
                                ? ' · majority'
                                : ' · differs / review'}
                            </SelectOption>
                          ))}
                      </SelectField>
                    </label>
                    {source && (
                      <label className='flex items-start gap-2 text-xs'>
                        <input
                          type='checkbox'
                          checked={forceSource}
                          disabled={blocked}
                          onChange={(e) =>
                            setForceSource(e.target.checked)
                          }
                          className='mt-0.5 accent-primary'
                        />
                        <span>
                          Explicitly use this proxy as reference
                          instead of the majority. Excluded proxies
                          stay excluded from bulk actions.
                        </span>
                      </label>
                    )}
                    <div className='flex gap-2'>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={blocked}
                        onClick={() =>
                          setSelected(
                            census.rows
                              .filter((row) => eligible(row, census))
                              .map((row) => row.target.id),
                          )
                        }
                      >
                        Select majority
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={blocked}
                        onClick={() => setSelected([])}
                      >
                        Clear
                      </Button>
                    </div>
                    <ScrollArea
                      className='h-56'
                      aria-label='Configured proxy policies'
                    >
                      <div className='grid gap-2 pr-3 sm:grid-cols-2 xl:grid-cols-3'>
                        {census.rows.map((row) => {
                          const isEligible = eligible(row, census);
                          return (
                            <div
                              key={row.target.id}
                              className={rowStyle({
                                excluded: !isEligible,
                              })}
                            >
                              <label className='flex min-w-0 flex-1 items-center gap-2'>
                                <input
                                  type='checkbox'
                                  aria-label={`Distribute to ${row.target.name}`}
                                  checked={selected.includes(
                                    row.target.id,
                                  )}
                                  disabled={blocked || !isEligible}
                                  onChange={(e) =>
                                    setSelected((ids) =>
                                      e.target.checked
                                        ? [...ids, row.target.id]
                                        : ids.filter(
                                            (id) =>
                                              id !== row.target.id,
                                          ),
                                    )
                                  }
                                  className='accent-primary'
                                />
                                <span className='min-w-0'>
                                  <span className='block truncate text-xs font-medium'>
                                    {row.target.name}
                                  </span>
                                  <span className='block truncate text-[11px] text-muted-foreground'>
                                    {row.target.address}
                                  </span>
                                </span>
                              </label>
                              <span className='text-[10px] text-muted-foreground'>
                                {isEligible ? 'Majority' : 'Excluded'}
                              </span>
                              <p className='w-full break-words text-[11px] text-muted-foreground'>
                                {row.error ||
                                  row.health?.issues.join(' ') ||
                                  (!isEligible
                                    ? 'Different CPL. Review manually before replacement.'
                                    : `SHA-256 ${row.fingerprint?.slice(0, 12)}`)}
                              </p>
                              {row.fingerprint && (
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  disabled={
                                    blocked || !census.majority
                                  }
                                  onClick={() =>
                                    compare(row.target.id)
                                  }
                                >
                                  Compare with majority
                                </Button>
                              )}
                              {!isEligible &&
                                row.health?.healthy &&
                                sourceAllowed && (
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    disabled={blocked}
                                    onClick={() =>
                                      review([row.target.id], true)
                                    }
                                  >
                                    Review individual replacement
                                  </Button>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </Card>
            )}
            {progress && (
              <Card className='gap-3 p-4'>
                <h2 className='text-sm font-semibold'>
                  {progress.running
                    ? 'Distribution in progress'
                    : 'Last distribution'}
                </h2>
                <ScrollArea className='h-64'>
                  <div className='space-y-3'>
                    {progress.rows.map((row) => (
                      <div key={row.id} className='space-y-1 text-xs'>
                        <div className='flex items-center justify-between gap-2'>
                          <strong className='truncate'>
                            {row.name}
                          </strong>
                          <span
                            className={statusStyle({
                              status: row.status as
                                | 'pending'
                                | 'running'
                                | 'success'
                                | 'failed'
                                | 'conflict',
                            })}
                          >
                            {row.status}
                          </span>
                        </div>
                        <p className='break-words text-muted-foreground'>
                          {row.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                {!progress.running && (
                  <p className='text-xs text-muted-foreground'>
                    Inspect all proxies again before the next
                    distribution. Successful targets are not rolled
                    back if another target fails.
                  </p>
                )}
              </Card>
            )}
          </div>
          <Card className='min-w-0 gap-0 overflow-hidden py-0'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
              <div>
                <h2 className='flex items-center gap-2 text-sm font-semibold'>
                  <FileCode2 className='size-4' />
                  {method === 'central'
                    ? 'Remote CPL editor'
                    : 'Local Policy CPL editor'}
                </h2>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {inspected
                    ? `${draft.split('\n').length.toLocaleString()} lines · ${creatingNew ? (draftOrigin === 'new' ? 'New policy' : draftOrigin === 'shared' ? 'Shared source draft' : 'Imported draft') : dirty ? 'Unsaved draft' : 'Captured source'}`
                    : 'Create a new policy or load an existing source.'}
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={blocked}
                  onClick={() =>
                    dirty ? setNewPolicyOpen(true) : startNewPolicy()
                  }
                >
                  <FilePlus2 className='size-3.5' />
                  New policy
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={blocked || !inspected || !draft.trim()}
                  onClick={() => exportPolicy()}
                >
                  <Download className='size-3.5' />
                  Export CPL
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={blocked || !inspected || !draft.trim()}
                  onClick={() => exportPolicy(true)}
                >
                  Export shared JSON
                </Button>
                <label className='inline-flex cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted'>
                  Import CPL / JSON
                  <input
                    type='file'
                    accept='.cpl,.txt,.json'
                    className='sr-only'
                    disabled={blocked}
                    aria-label='Import policy file'
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      if (dirty) {
                        toast.error(
                          'Discard the current draft before importing another policy.',
                        );
                        return;
                      }
                      try {
                        if (file.size > 4 * 1024 * 1024)
                          throw new Error(
                            'Policy file exceeds 4 MiB.',
                          );
                        const raw = await file.text();
                        const text = file.name
                          .toLowerCase()
                          .endsWith('.json')
                          ? decodeSharedPolicy(raw)
                          : raw;
                        if (!text.trim())
                          throw new Error(
                            'The imported policy is empty.',
                          );
                        startNewPolicy();
                        setDraftOrigin('imported');
                        setDraft(editorText(text));
                      } catch (e) {
                        toast.error(String(e));
                      }
                    }}
                  />
                </label>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={blocked || !dirty}
                  onClick={() =>
                    setDraft(creatingNew ? '' : editorText(original))
                  }
                >
                  Discard draft
                </Button>
                <Button
                  size='sm'
                  disabled={
                    blocked ||
                    !inspected ||
                    !draft.trim() ||
                    !health?.healthy ||
                    (method === 'direct' &&
                      (!sourceAllowed || !selected.length)) ||
                    (method === 'central' &&
                      (!dirty ||
                        settings.central.transport === 'https'))
                  }
                  onClick={() => review()}
                >
                  <Upload className='size-3.5' />
                  {method === 'central'
                    ? 'Review & save'
                    : `Review & distribute (${selected.length})`}
                </Button>
              </div>
            </div>
            {!!sharedDocumentId && (
              <p className='border-b px-4 py-2 text-xs text-muted-foreground'>
                Shared source snapshot retained. It is rechecked
                before distribution and before each destination is
                modified.
              </p>
            )}
            {creatingNew && (
              <p className='border-b bg-muted/30 px-4 py-3 text-xs text-muted-foreground'>
                {draftOrigin === 'new'
                  ? 'Start with an empty policy: add layers, rules and objects below. No existing rules are imported.'
                  : draftOrigin === 'shared'
                    ? 'This draft was loaded from the shared source. Destination policies are used only as validation baselines.'
                    : 'This draft was imported from a local file. Destination policies are used only as validation baselines.'}{' '}
                Export locally, or inspect destinations before
                reviewing a full replacement.
                {method === 'central' &&
                  ' The existing remote file is read for conflict checks when you review the save.'}
              </p>
            )}
            <CplEditor
              key={
                creatingNew
                  ? `new-${newPolicyRevision}`
                  : `${method}-${documentId}-${source}`
              }
              value={draft}
              onChange={setDraft}
              disabled={blocked || !inspected || !health?.healthy}
            />
            <div className='space-y-1 border-t p-3 text-xs text-muted-foreground'>
              {health?.issues.map((issue) => (
                <p key={issue} className='text-destructive'>
                  {issue}
                </p>
              ))}
              {health?.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <p>
                CPL source only · VPM projects cannot be reconstructed
                from CPL · 4 MiB per policy.
              </p>
              <p>
                Concurrent edits are rechecked before writing and
                verified afterward. A CLI replacement cannot provide
                an atomic compare-and-swap against other
                administrators.
              </p>
            </div>
          </Card>
        </div>
      )}
      {busy && (
        <output className='text-sm text-muted-foreground'>
          {busy}
        </output>
      )}
      <Dialog
        open={!!comparison}
        onOpenChange={(open) => {
          if (!open) setComparison(null);
        }}
      >
        <DialogContent className='flex h-[80dvh] flex-col sm:max-w-5xl'>
          <DialogHeader className='pr-10'>
            <DialogTitle>Policy comparison</DialogTitle>
            <DialogDescription>
              {comparison?.title} · original on the left, compared
              source on the right.
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              variant='ghost'
              size='icon'
              className='absolute right-3 top-3'
              aria-label='Close comparison'
            >
              <X className='size-4' />
            </Button>
          </DialogClose>
          <div className='min-h-0 flex-1'>
            <PolicyDiff lines={comparison?.lines || []} />
          </div>
          {comparison?.latest && (
            <DialogFooter>
              <p className='mr-auto max-w-lg text-xs text-muted-foreground'>
                After reviewing all remote changes, you can use this
                version as the next conflict-check baseline while
                keeping your draft. Saving still requires a complete
                replacement review.
              </p>
              <Button
                disabled={!comparison.latest.health.healthy}
                onClick={() => {
                  const latest = comparison.latest!;
                  setDocumentId(latest.id);
                  setOriginal(latest.content);
                  setHealth(latest.health);
                  setComparison(null);
                }}
              >
                Use latest baseline · keep draft
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent className='flex h-[85dvh] flex-col sm:max-w-5xl'>
          <DialogHeader className='pr-10'>
            <DialogTitle>
              {confirmation?.kind === 'central'
                ? 'Review central file replacement'
                : confirmation?.repair
                  ? 'Review individual proxy replacement'
                  : 'Review policy distribution'}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.kind === 'central'
                ? 'Save the complete CPL file over SSH. The external distribution mechanism may pick it up afterward.'
                : `Replace the complete Local Policy on ${confirmation?.ids.length || 0} proxy/proxies using inline policy local. Existing local rules omitted from this draft will be removed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              variant='ghost'
              size='icon'
              className='absolute right-3 top-3'
              aria-label='Close replacement preview'
            >
              <X className='size-4' />
            </Button>
          </DialogClose>
          {confirmation?.kind === 'direct' && (
            <p className='text-xs text-muted-foreground'>
              Destinations:{' '}
              {confirmation.ids
                .map(
                  (id) =>
                    census?.rows.find((r) => r.target.id === id)
                      ?.target.name || id,
                )
                .join(', ')}
              .{' '}
              {forceSource && 'Explicit reference override enabled.'}{' '}
              {confirmation.repair &&
                'This is a manual replacement of one excluded proxy, outside the bulk selection.'}
            </p>
          )}
          <div className='min-h-0 flex-1'>
            <PolicyDiff lines={confirmation?.lines || []} />
          </div>
          <p className='text-xs text-muted-foreground'>
            The diff compares the captured destination policy with the
            draft. Bulk destinations share the majority fingerprint.
            Existing destination rules shown as removed will be
            replaced.
          </p>
          <label className='flex items-start gap-2 text-sm'>
            <input
              type='checkbox'
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className='mt-1 accent-primary'
            />
            <span>
              I reviewed the complete policy and the intended
              destination(s). Replace the existing CPL.
            </span>
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant='outline'>Cancel</Button>
            </DialogClose>
            <Button disabled={!confirmed || blocked} onClick={apply}>
              {confirmation?.kind === 'central'
                ? 'Save remote CPL'
                : 'Apply complete Local Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
