'use client';

import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudDownload,
  Download,
  FileCode2,
  Pencil,
  Plus,
  RefreshCcw,
  Router,
  Save,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  generatePac,
  type PacCondition,
  type PacDestination,
  type PacFetch,
  type PacGroup,
  type PacRule,
  type PacSource,
  parseIpNetwork,
  parsePac,
  proxyIdentity,
  rulesEqual,
  urlMatches,
} from '@/lib/pac';
import { getLocalStorage, postLocalStorage } from '@/lib/utilsClient';

const STORAGE_KEY = 'pac-sources';
const statusText = {
  synced: 'Synced',
  'local-changes': 'Local changes',
  'remote-changes': 'Remote changes',
  conflict: 'Conflict',
  offline: 'Offline',
};
const statusVariant = {
  synced: 'default',
  'local-changes': 'secondary',
  'remote-changes': 'secondary',
  conflict: 'destructive',
  offline: 'outline',
} as const;

function hash(content: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(content))
    .then((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    );
}

function isDirty(source: PacSource) {
  return (
    !rulesEqual(source.rules, source.baseRules) ||
    JSON.stringify(source.groups ?? []) !==
      JSON.stringify(source.baseGroups ?? [])
  );
}
function labelCondition(condition: PacCondition) {
  if (condition.kind === 'always') return 'Default';
  if (condition.kind === 'domain') return 'Domain';
  if (condition.kind === 'url') return 'URL pattern';
  if (condition.kind === 'host') return 'Exact host';
  if (condition.kind === 'regex') return 'Advanced regex';
  if (condition.kind === 'ip-network') return 'IP range';
  if (condition.kind === 'expression') return 'Custom PAC expression';
  const target = condition.target === 'host' ? 'Host' : 'URL';
  const matcher =
    condition.kind === 'starts-with'
      ? 'starts with'
      : condition.kind === 'ends-with'
        ? 'ends with'
        : 'contains';
  return `${target} ${matcher}`;
}

function validateCondition(
  condition: PacCondition,
): string | undefined {
  const value = condition.value.trim();
  if (condition.kind === 'always') return undefined;
  if (!value) return 'Enter a condition value.';
  if (condition.kind === 'ip-network')
    return parseIpNetwork(value)
      ? undefined
      : 'Enter an IPv4/IPv6 address or CIDR network, such as 192.168.1.0/24 or 2001:db8::/32.';
  if (condition.kind === 'expression') {
    if (/[;{}]/.test(value))
      return 'Enter a boolean expression only; statements and braces are not allowed here.';
    return undefined;
  }
  if (/\s/.test(value) && condition.kind !== 'regex')
    return 'Values cannot contain whitespace.';
  if (condition.kind === 'domain' || condition.kind === 'host') {
    if (/[/:?#*]/.test(value))
      return condition.kind === 'domain'
        ? 'Enter a domain only, without a protocol or path.'
        : 'Enter a host only, without a protocol or path.';
    const hostname = value.replace(/^\./, '').replace(/\.$/, '');
    if (
      !hostname ||
      hostname.length > 253 ||
      !hostname
        .split('.')
        .every((label) =>
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(
            label,
          ),
        )
    )
      return condition.kind === 'domain'
        ? 'The domain format is invalid.'
        : 'The host format is invalid.';
  }
  if (condition.kind === 'url') {
    if (!/^(?:https?:\/\/|\*|[^/]+\/)/i.test(value))
      return 'Enter a URL or URL pattern. For example, use *example.com/path* for a wildcard.';
    const normalized = value.replace(/[?*]/g, 'x');
    const candidate = /^https?:\/\//i.test(normalized)
      ? normalized
      : `http://${normalized.replace(/^\*+/, 'x')}`;
    try {
      if (!new URL(candidate).hostname)
        return 'The pattern must include a valid host.';
    } catch {
      return 'The URL or pattern format is invalid.';
    }
  }
  if (
    ['starts-with', 'ends-with', 'contains'].includes(
      condition.kind,
    ) &&
    condition.target === 'host' &&
    /[/:?#]/.test(value)
  )
    return 'For host matching, enter host text without a protocol or path.';
  if (
    condition.kind === 'starts-with' &&
    condition.target !== 'host' &&
    !/^https?:\/\//i.test(value)
  )
    return 'A URL starts-with value must begin with http:// or https://.';
  if (condition.kind === 'regex') {
    try {
      new RegExp(value);
    } catch {
      return 'The regular expression is invalid.';
    }
  }
  return undefined;
}

function sameCondition(a: PacCondition, b: PacCondition) {
  const normalize = (condition: PacCondition) => ({
    kind: condition.kind,
    target: condition.target ?? '',
    value:
      condition.kind === 'domain' ||
      condition.kind === 'host' ||
      condition.target === 'host'
        ? condition.value.trim().toLowerCase()
        : condition.value.trim(),
  });
  return (
    JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
  );
}

function conditionPlaceholder(
  kind: PacCondition['kind'],
  target: 'url' | 'host' = 'url',
) {
  if (kind === 'domain') return 'example.com';
  if (kind === 'url') return '*example.com/path*';
  if (kind === 'host') return 'server.example.com';
  if (kind === 'regex') return '^https://.*\\.example\\.com/';
  if (kind === 'ip-network') return '192.168.1.0/24 or 2001:db8::/32';
  if (kind === 'expression')
    return 'weekdayRange("MON", "FRI") && isInNet(host, "10.0.0.0", "255.0.0.0")';
  if (kind === 'starts-with')
    return target === 'url'
      ? 'https://intranet.example.com/'
      : 'intranet-';
  if (kind === 'ends-with')
    return target === 'url' ? '/final/path' : '.internal';
  if (kind === 'contains')
    return target === 'url' ? '/private/' : 'intranet';
  return 'Applies last';
}
function displayDestination(
  destination: PacDestination,
  proxies: Proxy[],
) {
  if (destination.kind === 'direct') return 'DIRECT';
  const proxy = proxies.find(
    (item) => proxyIdentity(item) === destination.proxyRef,
  );
  return `${proxy?.hostname || proxy?.hostinfo?.hostname || destination.host}:${destination.port} (${destination.protocol})`;
}

export default function PacFileManagerWorkspace({
  proxies,
  mode = 'manage',
  editorSourceId,
}: {
  proxies: Proxy[];
  mode?: 'manage' | 'edit';
  editorSourceId?: string;
}) {
  const router = useRouter();
  const creatingSource = useRef(false);
  const [sources, setSources] = useState<PacSource[]>([]);
  const [loadedSources, setLoadedSources] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  const [testInput, setTestInput] = useState('');
  const [conditionKind, setConditionKind] =
    useState<PacCondition['kind']>('domain');
  const [conditionValue, setConditionValue] = useState('');
  const [conditionTarget, setConditionTarget] = useState<
    'url' | 'host'
  >('url');
  const [regexTarget, setRegexTarget] = useState<'url' | 'host'>(
    'url',
  );
  const [conditionError, setConditionError] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkValues, setBulkValues] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [newGroupId, setNewGroupId] = useState('general');
  const [editingRule, setEditingRule] = useState<{
    id: string;
    groupId?: string;
    condition: PacCondition;
    destination: PacDestination;
    fallbacks: PacDestination[];
  } | null>(null);
  const [destinationKind, setDestinationKind] = useState<
    'direct' | 'proxy'
  >('direct');
  const [proxyRef, setProxyRef] = useState('');
  const [trafficProtocol, setTrafficProtocol] = useState<
    'PROXY' | 'HTTPS' | 'SOCKS' | 'SOCKS5'
  >('PROXY');
  const [trafficPort, setTrafficPort] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setSources(getLocalStorage<PacSource[]>(STORAGE_KEY) ?? []);
    setSelectedId(localStorage.getItem('pac-selected-source') ?? '');
    setLoadedSources(true);
  }, []);
  useEffect(() => {
    if (!loadedSources || mode !== 'edit' || !editorSourceId) return;
    if (editorSourceId !== 'new') {
      creatingSource.current = false;
      setSelectedId(editorSourceId);
      return;
    }
    if (creatingSource.current) return;
    creatingSource.current = true;
    const id = crypto.randomUUID();
    const source: PacSource = {
      id,
      name: 'New WPAD',
      url: '',
      rules: [{ id: crypto.randomUUID(), groupId: 'general', condition: { kind: 'always', value: '' }, destination: { kind: 'direct' }, editable: true }],
      baseRules: [],
      groups: [{ id: 'general', name: 'General' }],
      baseGroups: [],
      status: 'local-changes',
    };
    postLocalStorage(STORAGE_KEY, [...sources, source]);
    setSources((current) => [...current, source]);
    setSelectedId(id);
      router.replace(`/pac/editor?sourceId=${encodeURIComponent(id)}`);
  }, [loadedSources, mode, editorSourceId, router, sources]);
  useEffect(() => {
    if (loadedSources) postLocalStorage(STORAGE_KEY, sources);
  }, [sources, loadedSources]);
  useEffect(() => {
    if (selectedId)
      localStorage.setItem('pac-selected-source', selectedId);
  }, [selectedId]);

  const selected =
    mode === 'edit'
      ? sources.find((source) => source.id === selectedId)
      : undefined;
  const groups = selected?.groups?.length
    ? selected.groups
    : [{ id: 'general', name: 'General' }];
  const activeGroupId = groups.some(
    (group) => group.id === newGroupId,
  )
    ? newGroupId
    : (groups[0]?.id ?? 'general');
  const activeGroupFilter =
    groupFilter === 'all' ||
    groups.some((group) => group.id === groupFilter)
      ? groupFilter
      : 'all';
  const dirty = selected ? isDirty(selected) : false;
  const preview = useMemo(() => {
    if (!selected || selected.parseError || !testUrl)
      return {
        matchedRule: undefined as PacRule | undefined,
        uncertain: false,
      };
    let host = '';
    try {
      host = new URL(testUrl).hostname;
    } catch {
      return { matchedRule: undefined, uncertain: false };
    }
    for (const rule of selected.rules) {
      if (rule.condition.kind === 'expression')
        return { matchedRule: undefined, uncertain: true };
      if (
        rule.condition.kind === 'ip-network' &&
        !parseIpNetwork(host)
      )
        return { matchedRule: undefined, uncertain: true };
      if (urlMatches(testUrl, host, rule.condition))
        return { matchedRule: rule, uncertain: false };
    }
    return { matchedRule: undefined, uncertain: false };
  }, [selected, testUrl]);
  const matchedRule = preview.matchedRule;

  const updateSource = (source: PacSource) =>
    setSources((current) =>
      current.map((item) => (item.id === source.id ? source : item)),
    );
  const setSourceRules = (source: PacSource, rules: PacRule[]) => {
    const changed =
      !rulesEqual(rules, source.baseRules) ||
      JSON.stringify(source.groups ?? []) !==
        JSON.stringify(source.baseGroups ?? []);
    const status =
      source.status === 'offline'
        ? 'offline'
        : source.pendingContent
          ? changed
            ? 'conflict'
            : 'remote-changes'
          : changed
            ? 'local-changes'
            : 'synced';
    updateSource({ ...source, rules, status });
  };
  const acceptRemote = (
    source: PacSource,
    content: string,
    digest: string,
  ) => {
    const parsed = parsePac(content, proxies);
    const updated: PacSource = {
      ...source,
      remoteContent: parsed.error ? content : undefined,
      baseHash: digest,
      rules: parsed.rules,
      baseRules: parsed.rules,
      baseGroups: [{ id: 'general', name: 'General' }],
      groups: [{ id: 'general', name: 'General' }],
      prefix: parsed.prefix,
      suffix: parsed.suffix,
      parseError: parsed.error,
      pendingContent: undefined,
      pendingHash: undefined,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
    };
    updateSource(updated);
    return updated;
  };

  const synchronize = async (source: PacSource) => {
    setLoading(true);
    try {
      const result = await invoke<PacFetch>('fetch_pac_source', {
        url: source.url,
      });
      const digest = await hash(result.content);
      const localChanges = isDirty(source);
      const sourceWithResponse: PacSource = {
        ...source,
        resolvedUrl: result.finalUrl,
        remoteEtag: result.etag,
        remoteLastModified: result.lastModified,
      };
      if (!source.baseHash && !localChanges) {
        acceptRemote(sourceWithResponse, result.content, digest);
      } else if (!source.baseHash || digest !== source.baseHash) {
        updateSource({
          ...sourceWithResponse,
          pendingContent: result.content,
          pendingHash: digest,
          lastSyncedAt: new Date().toISOString(),
          status: localChanges ? 'conflict' : 'remote-changes',
        });
      } else {
        updateSource({
          ...sourceWithResponse,
          lastSyncedAt: new Date().toISOString(),
          status: localChanges ? 'local-changes' : 'synced',
        });
      }
      toast.success(`Source downloaded (${result.status})`);
    } catch (error) {
      updateSource({ ...source, status: 'offline' });
      toast.error(`Could not sync ${source.name}: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const addSource = async () => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      toast.error('Enter a valid URL.');
      return;
    }
    if (
      !['http:', 'https:'].includes(parsedUrl.protocol) ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      toast.error(
        'The URL must use HTTP or HTTPS and cannot include credentials.',
      );
      return;
    }
    if (
      sources.some((source) => source.url === parsedUrl.toString())
    ) {
      toast.error('That source is already registered.');
      return;
    }
    const source: PacSource = {
      id: crypto.randomUUID(),
      name:
        name.trim() ||
        parsedUrl.pathname.split('/').pop() ||
        parsedUrl.hostname,
      url: parsedUrl.toString(),
      rules: [],
      baseRules: [],
      status: 'offline',
    };
    setSources((current) => [...current, source]);
    setSelectedId(source.id);
    setName('');
    setUrl('');
    await synchronize(source);
    router.push(`/pac/editor?sourceId=${encodeURIComponent(source.id)}`);
  };

  const createSourceFromScratch = () => {
    router.push('/pac/editor?new=1');
  };

  const addGroup = () => {
    if (!selected || !groupName.trim()) return;
    const name = groupName.trim();
    if (
      groups.some(
        (group) => group.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      toast.error('A group with this name already exists.');
      return;
    }
    const group = { id: crypto.randomUUID(), name };
    updateSource({
      ...selected,
      groups: [...groups, group],
      status:
        selected.status === 'offline'
          ? 'offline'
          : selected.pendingContent
            ? 'conflict'
            : 'local-changes',
    });
    setNewGroupId(group.id);
    setGroupFilter(group.id);
    setGroupName('');
  };

  const removeSource = (source: PacSource) => {
    setSources((current) =>
      current.filter((item) => item.id !== source.id),
    );
    if (selectedId === source.id)
      setSelectedId(
        sources.find((item) => item.id !== source.id)?.id ?? '',
      );
    if (mode === 'edit') router.push('/pac');
  };
  const addRule = () => {
    if (!selected || selected.parseError) return;
    if (bulkMode && conditionKind === 'always') {
      setConditionError('The default rule can only be added once.');
      return;
    }
    const entries =
      conditionKind === 'always'
        ? [{ value: '', line: 1 }]
        : (bulkMode ? bulkValues : conditionValue)
            .split(/\r?\n/)
            .map((value, index) => ({
              value: value.trim(),
              line: index + 1,
            }))
            .filter((entry) => Boolean(entry.value));
    if (!entries.length) {
      setConditionError(
        bulkMode
          ? 'Paste at least one value.'
          : 'Enter a condition value.',
      );
      return;
    }
    const conditions = entries.map<PacCondition>(({ value }) => ({
      kind: conditionKind,
      value: conditionKind === 'always' ? '' : value,
      ...(['regex', 'starts-with', 'ends-with', 'contains'].includes(
        conditionKind,
      )
        ? {
            target:
              conditionKind === 'regex'
                ? regexTarget
                : conditionTarget,
          }
        : {}),
    }));
    const seenConditions: PacCondition[] = [];
    for (const [index, condition] of conditions.entries()) {
      const error = validateCondition(condition);
      if (error) {
        setConditionError(
          bulkMode ? `Line ${entries[index].line}: ${error}` : error,
        );
        return;
      }
      if (
        selected.rules.some((rule) =>
          sameCondition(rule.condition, condition),
        ) ||
        seenConditions.some((seen) => sameCondition(seen, condition))
      ) {
        setConditionError(
          bulkMode
            ? `Line ${entries[index].line}: this condition is already in the rules or the pasted list.`
            : 'A rule with this condition already exists.',
        );
        return;
      }
      seenConditions.push(condition);
    }
    setConditionError('');
    let destination: PacDestination = { kind: 'direct' };
    if (destinationKind === 'proxy') {
      const proxy = proxies.find(
        (item) => proxyIdentity(item) === proxyRef,
      );
      if (!proxy) {
        toast.error('Select a registered proxy.');
        return;
      }
      if (
        !/^\d{1,5}$/.test(trafficPort) ||
        Number(trafficPort) < 1 ||
        Number(trafficPort) > 65535
      ) {
        toast.error('Enter a valid proxy traffic port.');
        return;
      }
      destination = {
        kind: 'proxy',
        proxyRef,
        host:
          proxy.primary_address ||
          proxy.hostinfo?.ip ||
          proxy.registered_address ||
          proxy.hostname,
        port: trafficPort,
        protocol: trafficProtocol,
      };
    }
    const newRules = conditions.map<PacRule>((condition) => ({
      id: crypto.randomUUID(),
      groupId: activeGroupId,
      condition,
      destination,
      editable: true,
    }));
    const rules = [...selected.rules];
    const groupIndexes = rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => (rule.groupId ?? 'general') === activeGroupId && rule.condition.kind !== 'always');
    const defaultIndex = rules.findIndex((item) => item.condition.kind === 'always');
    const insertAt = groupIndexes.length
      ? groupIndexes[groupIndexes.length - 1].index + 1
      : defaultIndex < 0
        ? rules.length
        : defaultIndex;
    rules.splice(insertAt, 0, ...newRules);
    setSourceRules(selected, rules);
    setConditionValue('');
    setBulkValues('');
    if (bulkMode) toast.success(`${newRules.length} rules added.`);
  };
  const saveEditedRule = () => {
    if (!selected || !editingRule || selected.parseError) return;
    const validationError = validateCondition(editingRule.condition);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const editedDestination = editingRule.destination;
    if (editedDestination.kind === 'proxy') {
      if (
        !proxies.some(
          (proxy) =>
            proxyIdentity(proxy) === editedDestination.proxyRef,
        )
      ) {
        toast.error('Select a proxy that is still registered.');
        return;
      }
      if (
        !/^\d{1,5}$/.test(editedDestination.port) ||
        Number(editedDestination.port) < 1 ||
        Number(editedDestination.port) > 65535
      ) {
        toast.error('Enter a valid proxy traffic port.');
        return;
      }
    }
    for (const destination of editingRule.fallbacks) {
      if (destination.kind === 'proxy') {
        if (
          !proxies.some(
            (proxy) => proxyIdentity(proxy) === destination.proxyRef,
          )
        ) {
          toast.error(
            'A fallback points to a proxy that is no longer registered.',
          );
          return;
        }
        if (
          !/^\d{1,5}$/.test(destination.port) ||
          Number(destination.port) < 1 ||
          Number(destination.port) > 65535
        ) {
          toast.error('Enter a valid fallback proxy traffic port.');
          return;
        }
      }
    }
    if (
      selected.rules.some(
        (rule) =>
          rule.id !== editingRule.id &&
          sameCondition(rule.condition, editingRule.condition),
      )
    ) {
      toast.error('A rule with this condition already exists.');
      return;
    }
    const changedRules = selected.rules.map((rule) =>
      rule.id === editingRule.id
        ? {
            ...rule,
            groupId: editingRule.groupId,
            condition: editingRule.condition,
            destination: editingRule.destination,
            fallbacks: editingRule.fallbacks,
          }
        : rule,
    );
    const rules = groups.flatMap((group) =>
      changedRules.filter((rule) => (rule.groupId ?? 'general') === group.id),
    );
    setSourceRules(selected, rules);
    setEditingRule(null);
  };
  const moveRule = (rule: PacRule, delta: number) => {
    if (!selected || rule.condition.kind === 'always') return;
    const groupId = rule.groupId ?? 'general';
    const peers = selected.rules.filter(
      (item) => (item.groupId ?? 'general') === groupId && item.condition.kind !== 'always',
    );
    const peerIndex = peers.findIndex((item) => item.id === rule.id);
    const nextPeer = peerIndex + delta;
    if (nextPeer < 0 || nextPeer >= peers.length) return;
    const rules = [...selected.rules];
    const index = rules.findIndex((item) => item.id === rule.id);
    const nextIndex = rules.findIndex((item) => item.id === peers[nextPeer].id);
    [rules[index], rules[nextIndex]] = [rules[nextIndex], rules[index]];
    setSourceRules(selected, rules);
  };
  const moveGroup = (groupId: string, delta: number) => {
    if (!selected) return;
    const nextGroups = [...groups];
    const index = nextGroups.findIndex((group) => group.id === groupId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= nextGroups.length) return;
    [nextGroups[index], nextGroups[nextIndex]] = [nextGroups[nextIndex], nextGroups[index]];
    const nextRules = nextGroups.flatMap((group) =>
      selected.rules.filter((rule) => (rule.groupId ?? 'general') === group.id),
    );
    setSourceRules({ ...selected, groups: nextGroups }, nextRules);
  };
  const applyRemote = () => {
    if (selected?.pendingContent && selected.pendingHash)
      acceptRemote(
        selected,
        selected.pendingContent,
        selected.pendingHash,
      );
  };
  const keepLocal = () => {
    if (!selected?.pendingContent || !selected.pendingHash) return;
    const parsed = parsePac(selected.pendingContent, proxies);
    updateSource({
      ...selected,
      baseHash: selected.pendingHash,
      remoteContent: parsed.error
        ? selected.pendingContent
        : undefined,
      baseRules: parsed.rules,
      baseGroups: [{ id: 'general', name: 'General' }],
      prefix: parsed.prefix,
      suffix: parsed.suffix,
      pendingContent: undefined,
      pendingHash: undefined,
      status:
        rulesEqual(selected.rules, parsed.rules) &&
        JSON.stringify(selected.groups ?? []) ===
          JSON.stringify([{ id: 'general', name: 'General' }])
          ? 'synced'
          : 'local-changes',
    });
  };
  const exportPac = () => {
    if (!selected) return;
    const issues = validateSource(selected);
    if (!selected.parseError && issues.length) {
      toast.error(issues[0]);
      return;
    }
    const content = selected.parseError
      ? selected.remoteContent
      : generatePac(selected);
    if (!content) {
      toast.error('There is no PAC content to export.');
      return;
    }
    const blob = new Blob([content], {
      type: 'application/x-ns-proxy-autoconfig',
    });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${selected.name.replace(/[^\w.-]+/g, '-')}.pac`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const validateSource = (source: PacSource) => {
    const issues: string[] = [];
    if (!source.rules.length)
      issues.push('Add at least one rule before generating the PAC.');
    if (
      source.rules.filter((rule) => rule.condition.kind === 'always')
        .length > 1
    )
      issues.push('Only one default rule is allowed.');
    for (const rule of source.rules) {
      if (
        rule.condition.kind !== 'always' &&
        !rule.condition.value.trim()
      )
        issues.push('A condition is empty.');
      if (rule.condition.kind === 'regex') {
        try {
          new RegExp(rule.condition.value);
        } catch {
          issues.push(
            `The regex “${rule.condition.value}” is invalid.`,
          );
        }
      }
      if (rule.destination.kind === 'proxy') {
        const destination = rule.destination;
        if (
          !proxies.some(
            (proxy) => proxyIdentity(proxy) === destination.proxyRef,
          )
        )
          issues.push(
            'A rule points to a proxy that is no longer registered.',
          );
        if (
          !/^\d{1,5}$/.test(destination.port) ||
          Number(destination.port) < 1 ||
          Number(destination.port) > 65535
        )
          issues.push('A rule has an invalid traffic port.');
      }
      for (const fallback of rule.fallbacks ?? []) {
        if (fallback.kind !== 'proxy') continue;
        if (
          !proxies.some(
            (proxy) => proxyIdentity(proxy) === fallback.proxyRef,
          )
        )
          issues.push(
            'A fallback points to a proxy that is no longer registered.',
          );
        if (
          !/^\d{1,5}$/.test(fallback.port) ||
          Number(fallback.port) < 1 ||
          Number(fallback.port) > 65535
        )
          issues.push('A fallback has an invalid traffic port.');
      }
    }
    return issues;
  };

  return (
    <div className={mode === 'manage' ? 'grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]' : 'flex min-w-0 flex-col gap-4'}>
      {mode === 'manage' && (
      <aside className='flex flex-col gap-4'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Plus className='size-4' />
              Register PAC source
            </CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            <Input
              aria-label='Source name'
              placeholder='Name (optional)'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              aria-label='WPAD or PAC URL'
              placeholder='http://server.domain/wpad.dat'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button onClick={addSource} disabled={loading}>
              <CloudDownload className='size-4' />
              Add and load
            </Button>
            <div className='flex items-center gap-3 text-xs text-muted-foreground'>
              <span className='h-px flex-1 bg-border' />
              or
              <span className='h-px flex-1 bg-border' />
            </div>
            <Button
              variant='outline'
              onClick={createSourceFromScratch}
              disabled={loading}
            >
              <Plus className='size-4' />
              Create PAC from scratch
            </Button>
            <p className='text-xs text-muted-foreground'>
              Import an existing source or create a local PAC with a
              DIRECT fallback. Remote sources are read-only; export
              changes as a file.
            </p>
          </CardContent>
        </Card>
      </aside>
      )}

      {mode === 'manage' ? (
        <section className='flex min-w-0 flex-col gap-4'>
          <div className='flex items-center justify-between gap-3'>
            <div>
              <h2 className='text-lg font-semibold'>PAC sources</h2>
              <p className='text-sm text-muted-foreground'>Manage sources and open a PAC to edit its routing rules.</p>
            </div>
            <Badge variant='secondary'>{sources.length} sources</Badge>
          </div>
          {sources.length === 0 ? (
            <Card className='flex min-h-60 items-center justify-center'>
              <div className='px-6 text-center'><FileCode2 className='mx-auto size-9 text-muted-foreground' /><p className='mt-3 font-medium'>No PAC sources yet</p><p className='mt-1 text-sm text-muted-foreground'>Add a remote source or create a PAC file from scratch.</p></div>
            </Card>
          ) : (
            <div className='grid gap-3 xl:grid-cols-2'>
              {sources.map((source) => (
                <Card key={source.id}>
                  <CardContent className='flex flex-col gap-4 p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'><h3 className='truncate font-medium'>{source.name}</h3><p className='mt-1 truncate text-sm text-muted-foreground'>{source.url || 'Local source'}</p><p className='mt-2 text-xs text-muted-foreground'>{source.rules.length} rules · {source.lastSyncedAt ? `Synced ${new Date(source.lastSyncedAt).toLocaleString()}` : 'Not synced'}</p></div>
                      <Badge variant={statusVariant[source.status]}>{statusText[source.status]}</Badge>
                    </div>
                    <div className='flex flex-wrap justify-end gap-2'>
                      {source.url && <Button variant='outline' size='sm' disabled={loading} onClick={() => synchronize(source)}><RefreshCcw className='size-4' />Sync</Button>}
                      <Button size='sm' onClick={() => router.push(`/pac/editor?sourceId=${encodeURIComponent(source.id)}`)}><Pencil className='size-4' />Edit source</Button>
                      <Button variant='ghost' size='icon' aria-label={`Delete ${source.name}`} onClick={() => removeSource(source)}><Trash2 className='size-4' /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : !selected ? (
        <Card className='flex min-h-80 items-center justify-center'>
          <div className='max-w-md px-6 text-center'>
            <FileCode2 className='mx-auto size-10 text-muted-foreground' />
            <h2 className='mt-4 font-semibold'>PAC File Manager</h2>
            <p className='mt-2 text-sm text-muted-foreground'>
              Register a WPAD/PAC source to load and review its
              routing rules.
            </p>
          </div>
        </Card>
      ) : (
        <div className='flex min-w-0 flex-col gap-4'>
          <Card>
            <CardContent className='flex flex-col gap-5 p-5 md:flex-row md:items-start md:justify-between'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Input aria-label='PAC source name' className='h-9 max-w-md text-lg font-semibold' value={selected.name} onChange={(event) => updateSource({ ...selected, name: event.target.value })} />
                  <Badge variant={statusVariant[selected.status]}>
                    {statusText[selected.status]}
                  </Badge>
                </div>
                <p className='mt-1 break-all text-sm text-muted-foreground'>
                  Source:{' '}
                  {selected.url || 'Local source, no remote URL'}
                </p>
                {selected.resolvedUrl &&
                  selected.resolvedUrl !== selected.url && (
                    <p className='mt-1 break-all text-xs text-muted-foreground'>
                      Final URL after redirects:{' '}
                      {selected.resolvedUrl}
                    </p>
                  )}
                <p className='mt-1 text-xs text-muted-foreground'>
                  {selected.lastSyncedAt
                    ? `Last synced: ${new Date(selected.lastSyncedAt).toLocaleString()}`
                    : 'Not synced yet'}{' '}
                  · {selected.rules.length} rules
                </p>
              </div>
              <div className='flex shrink-0 flex-wrap gap-2'>
                <Button
                  variant='outline'
                  onClick={() => synchronize(selected)}
                  disabled={loading || !selected.url}
                >
                  <RefreshCcw
                    className={
                      loading ? 'size-4 animate-spin' : 'size-4'
                    }
                  />
                  Sync
                </Button>
                <Button
                  variant='outline'
                  onClick={exportPac}
                  disabled={
                    !selected.remoteContent &&
                    (!selected.rules.length ||
                      Boolean(selected.parseError))
                  }
                >
                  <Download className='size-4' />
                  Export PAC
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Delete source'
                  onClick={() => removeSource(selected)}
                >
                  <Trash2 className='size-4' />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-3'><CardTitle className='text-base'>Source tools</CardTitle></CardHeader>
            <CardContent className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto] lg:items-end'>
              <div className='space-y-2'><label htmlFor='pac-test-url' className='text-sm font-medium'>Test URL against routing rules</label><div className='flex gap-2'><Input id='pac-test-url' placeholder='https://www.example.com/resource' value={testInput} onChange={(event) => setTestInput(event.target.value)} /><Button variant='outline' disabled={!testInput || Boolean(selected.parseError)} onClick={() => setTestUrl(testInput)}><Check className='size-4' />Evaluate</Button></div></div>
              <div className='space-y-2'><p className='text-sm font-medium'>Publishing</p><p className='text-xs text-muted-foreground'>Remote sources are read-only. Export the generated file and publish it using your server’s approved process.</p></div>
              <div className='flex flex-wrap gap-2 lg:justify-end'><Button variant='outline' onClick={() => setPreviewOpen(true)} disabled={Boolean(selected.parseError)}><FileCode2 className='size-4' />Preview PAC</Button><Button variant='outline' onClick={exportPac}><Download className='size-4' />Export PAC</Button></div>
              {testUrl && <div className='rounded-md bg-muted p-3 text-sm lg:col-span-3'>{selected.parseError ? <span className='text-amber-600'>Not evaluated: this PAC contains logic outside the visual editor.</span> : preview.uncertain ? <span className='text-amber-700'>Preview is uncertain because an earlier condition needs DNS resolution or PAC runtime evaluation.</span> : matchedRule ? <>Matched <strong>{labelCondition(matchedRule.condition)}: {matchedRule.condition.value || 'default rule'}</strong> · destination <strong>{displayDestination(matchedRule.destination, proxies)}{(matchedRule.fallbacks?.length ?? 0) > 0 ? `; ${matchedRule.fallbacks?.map((destination) => displayDestination(destination, proxies)).join('; ')}` : ''}</strong></> : 'No rules matched, and no default rule is configured.'}</div>}
            </CardContent>
          </Card>
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className='max-h-[85dvh] sm:max-w-4xl'>
              <DialogHeader><DialogTitle>Generated PAC preview</DialogTitle><DialogDescription>Review the PAC code generated from this source’s visual rules.</DialogDescription></DialogHeader>
              {validateSource(selected).length > 0 && <p className='text-sm text-destructive'>{validateSource(selected)[0]}</p>}
              <pre className='max-h-[65dvh] overflow-auto rounded-md bg-muted p-4 text-xs'>{validateSource(selected).length ? 'Fix the validation errors to generate a preview.' : generatePac(selected)}</pre>
            </DialogContent>
          </Dialog>

          {selected.pendingContent && (
            <Card className='border-amber-500/40'>
              <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
                <p className='flex items-center gap-2 text-sm'>
                  <CircleAlert className='size-4 shrink-0 text-amber-500' />
                  {dirty
                    ? 'The remote source changed while local edits exist. Choose which version to keep.'
                    : 'Remote changes were detected. Applying them will update the local editor.'}
                </p>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={applyRemote}
                  >
                    Load remote version
                  </Button>
                  {dirty && (
                    <Button size='sm' onClick={keepLocal}>
                      Keep local
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {selected.status === 'offline' && (
            <p className='rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
              <WifiOff className='mr-2 inline size-4' />
              The source could not be reached. The local configuration
              has been preserved.
            </p>
          )}
          {selected.parseError && (
            <Card className='border-amber-500/40'>
              <CardContent className='p-4 text-sm'>
                <p className='font-medium'>
                  The downloaded content is kept read-only.
                </p>
                <p className='mt-1 text-muted-foreground'>
                  {selected.parseError} You can inspect and download
                  the original PAC; no partial version will be
                  generated.
                </p>
              </CardContent>
            </Card>
          )}

          {!selected.parseError && (
            <>
              <div className='grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4'>
                <Card className='order-2 min-h-0'>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center justify-between gap-2 text-base'>
                      <span>
                        Routing rules{' '}
                        <Badge variant='secondary' className='ml-1'>
                          {selected.rules.length}
                        </Badge>
                      </span>
                      <span className='flex items-center gap-2 text-xs font-normal text-muted-foreground'>
                        Order determines priority
                        <SelectField
                          aria-label='Filter rule group'
                          size='sm'
                          className='px-2 text-xs text-foreground'
                          value={activeGroupFilter}
                          onValueChange={(selectedValue) =>
                            setGroupFilter(selectedValue)
                          }
                        >
                          <SelectOption value='all'>All groups</SelectOption>
                          {groups.map((group) => (
                            <SelectOption key={group.id} value={group.id}>
                              {group.name}
                            </SelectOption>
                          ))}
                        </SelectField>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <ScrollArea className='h-[360px] md:h-[440px]'>
                      <div className='flex flex-col gap-2 p-4'>
                        {groups
                          .map((group, groupIndex) => ({ group, groupIndex }))
                          .filter(({ group }) => activeGroupFilter === 'all' || group.id === activeGroupFilter)
                          .map(({ group, groupIndex }) => {
                            const groupRules = selected.rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => (rule.groupId ?? 'general') === group.id);
                            return (
                            <section key={group.id} className='rounded-xl border bg-muted/20 p-3'>
                              <header className='mb-3 flex items-center justify-between gap-2 border-b pb-2'>
                                <div className='flex min-w-0 items-center gap-2'>
                                  <Button type='button' variant='ghost' size='sm' className='h-8 min-w-0 justify-start px-2' aria-expanded={!collapsedGroups[group.id]} aria-label={`${collapsedGroups[group.id] ? 'Expand' : 'Collapse'} ${group.name}`} onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}>
                                    {collapsedGroups[group.id] ? <ChevronRight className='size-4 shrink-0' /> : <ChevronDown className='size-4 shrink-0' />}
                                    <span className='truncate text-sm font-semibold'>{group.name}</span>
                                  </Button>
                                  <Badge variant='outline'>{groupRules.length} rules</Badge>
                                </div>
                                <div className='flex items-center'>
                                  <Button variant='ghost' size='icon' aria-label={`Move ${group.name} up`} disabled={groupIndex === 0} onClick={() => moveGroup(group.id, -1)}><ArrowUp className='size-4' /></Button>
                                  <Button variant='ghost' size='icon' aria-label={`Move ${group.name} down`} disabled={groupIndex === groups.length - 1} onClick={() => moveGroup(group.id, 1)}><ArrowDown className='size-4' /></Button>
                                </div>
                              </header>
                              {!collapsedGroups[group.id] && <div className='flex flex-col gap-2 border-l-2 border-primary/20 pl-3'>
                              {groupRules.map(({ rule, index }) => (
                            <div
                              key={rule.id}
                              className='rounded-lg border p-3'
                            >
                              <div className='flex flex-wrap items-center gap-2'>
                                <Badge variant='outline'>
                                  {rule.condition.kind === 'always'
                                    ? 'Default'
                                    : `#${index + 1}`}
                                </Badge>
                                <span className='font-medium'>
                                  {labelCondition(rule.condition)}
                                </span>
                                <span className='min-w-0 flex-1 truncate text-sm text-muted-foreground'>
                                  {rule.condition.value ||
                                    'any remaining destination'}
                                </span>
                                <span className='inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs'>
                                  <Router className='size-3' />
                                  {displayDestination(
                                    rule.destination,
                                    proxies,
                                  )}
                                  {(rule.fallbacks?.length ?? 0) >
                                    0 && (
                                    <span>
                                      + {rule.fallbacks?.length}{' '}
                                      fallback
                                    </span>
                                  )}
                                </span>
                                {rule.condition.kind !== 'always' && (
                                  <span className='flex'>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      aria-label='Raise priority'
                                      disabled={groupRules.findIndex((item) => item.rule.id === rule.id) === 0}
                                      onClick={() =>
                                        moveRule(rule, -1)
                                      }
                                    >
                                      <ArrowUp className='size-4' />
                                    </Button>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      aria-label='Lower priority'
                                      disabled={groupRules.filter((item) => item.rule.condition.kind !== 'always').findIndex((item) => item.rule.id === rule.id) === groupRules.filter((item) => item.rule.condition.kind !== 'always').length - 1}
                                      onClick={() =>
                                        moveRule(rule, 1)
                                      }
                                    >
                                      <ArrowDown className='size-4' />
                                    </Button>
                                  </span>
                                )}
                                {editingRule?.id === rule.id ? (
                                  <span className='flex items-center gap-1'>
                                    <Button
                                      variant='outline'
                                      size='sm'
                                      onClick={saveEditedRule}
                                    >
                                      <Save className='size-4' />
                                      Save
                                    </Button>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      aria-label='Cancel editing'
                                      onClick={() =>
                                        setEditingRule(null)
                                      }
                                    >
                                      <X className='size-4' />
                                    </Button>
                                  </span>
                                ) : (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    aria-label='Edit rule'
                                    onClick={() =>
                                      setEditingRule({
                                        id: rule.id,
                                        groupId:
                                          rule.groupId ?? 'general',
                                        condition: {
                                          ...rule.condition,
                                        },
                                        destination:
                                          rule.destination.kind ===
                                          'direct'
                                            ? { kind: 'direct' }
                                            : { ...rule.destination },
                                        fallbacks: (
                                          rule.fallbacks ?? []
                                        ).map((item) =>
                                          item.kind === 'direct'
                                            ? { kind: 'direct' }
                                            : { ...item },
                                        ),
                                      })
                                    }
                                  >
                                    <Pencil className='size-4' />
                                  </Button>
                                )}
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  aria-label='Delete rule'
                                  onClick={() => {
                                    if (editingRule?.id === rule.id)
                                      setEditingRule(null);
                                    setSourceRules(
                                      selected,
                                      selected.rules.filter(
                                        (item) => item.id !== rule.id,
                                      ),
                                    );
                                  }}
                                >
                                  <Trash2 className='size-4' />
                                </Button>
                              </div>
                              {editingRule?.id === rule.id && (
                                <>
                                  <div className='mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
                                    <SelectField
                                      aria-label='Rule group'
                                      value={
                                        editingRule.groupId ??
                                        'general'
                                      }
                                      onValueChange={(selectedValue) =>
                                        setEditingRule(
                                          (current) =>
                                            current && {
                                              ...current,
                                              groupId:
                                                selectedValue,
                                            },
                                        )
                                      }
                                    >
                                      {groups.map((group) => (
                                        <SelectOption
                                          key={group.id}
                                          value={group.id}
                                        >
                                          {group.name}
                                        </SelectOption>
                                      ))}
                                    </SelectField>
                                    <SelectField
                                      aria-label='Match type'
                                      value={
                                        editingRule.condition.kind
                                      }
                                      disabled={
                                        rule.condition.kind ===
                                        'always'
                                      }
                                      onValueChange={(selectedValue) =>
                                        setEditingRule(
                                          (current) =>
                                            current && {
                                              ...current,
                                              condition: {
                                                ...current.condition,
                                                kind: selectedValue as PacCondition['kind'],
                                              },
                                            },
                                        )
                                      }
                                    >
                                      <SelectOption value='domain'>
                                        Domain
                                      </SelectOption>
                                      <SelectOption value='url'>
                                        URL pattern
                                      </SelectOption>
                                      <SelectOption value='host'>
                                        Exact host
                                      </SelectOption>
                                      <SelectOption value='starts-with'>
                                        Starts with
                                      </SelectOption>
                                      <SelectOption value='ends-with'>
                                        Ends with
                                      </SelectOption>
                                      <SelectOption value='contains'>
                                        Contains
                                      </SelectOption>
                                      <SelectOption value='ip-network'>
                                        IP address / CIDR range
                                      </SelectOption>
                                      <SelectOption value='expression'>
                                        Custom PAC expression
                                      </SelectOption>
                                      <SelectOption value='regex'>
                                        Advanced regex
                                      </SelectOption>
                                      {rule.condition.kind ===
                                        'always' && (
                                        <SelectOption value='always'>
                                          Default
                                        </SelectOption>
                                      )}
                                    </SelectField>
                                    {[
                                      'regex',
                                      'starts-with',
                                      'ends-with',
                                      'contains',
                                    ].includes(
                                      editingRule.condition.kind,
                                    ) && (
                                      <SelectField
                                        aria-label='Match against'
                                        value={
                                          editingRule.condition
                                            .target ?? 'url'
                                        }
                                        onValueChange={(selectedValue) =>
                                          setEditingRule(
                                            (current) =>
                                              current && {
                                                ...current,
                                                condition: {
                                                  ...current.condition,
                                                  target: selectedValue as
                                                    | 'url'
                                                    | 'host',
                                                },
                                              },
                                          )
                                        }
                                      >
                                        <SelectOption value='url'>
                                          URL
                                        </SelectOption>
                                        <SelectOption value='host'>
                                          Host
                                        </SelectOption>
                                      </SelectField>
                                    )}
                                    <Input
                                      aria-label='Rule condition'
                                      placeholder={conditionPlaceholder(
                                        editingRule.condition.kind,
                                        editingRule.condition.target,
                                      )}
                                      value={
                                        editingRule.condition.value
                                      }
                                      onChange={(event) =>
                                        setEditingRule(
                                          (current) =>
                                            current && {
                                              ...current,
                                              condition: {
                                                ...current.condition,
                                                value:
                                                  event.target.value,
                                              },
                                            },
                                        )
                                      }
                                    />
                                    <SelectField
                                      aria-label='Rule destination'
                                      value={
                                        editingRule.destination
                                          .kind === 'direct'
                                          ? 'direct'
                                          : editingRule.destination
                                              .proxyRef
                                      }
                                      onValueChange={(selectedValue) => {
                                        if (
                                          selectedValue ===
                                          'direct'
                                        )
                                          setEditingRule(
                                            (current) =>
                                              current && {
                                                ...current,
                                                destination: {
                                                  kind: 'direct',
                                                },
                                              },
                                          );
                                        else {
                                          const proxy = proxies.find(
                                            (item) =>
                                              proxyIdentity(item) ===
                                              selectedValue,
                                          );
                                          if (proxy)
                                            setEditingRule(
                                              (current) =>
                                                current && {
                                                  ...current,
                                                  destination: {
                                                    kind: 'proxy',
                                                    proxyRef:
                                                      proxyIdentity(
                                                        proxy,
                                                      ),
                                                    host:
                                                      proxy.primary_address ||
                                                      proxy.hostinfo
                                                        ?.ip ||
                                                      proxy.registered_address ||
                                                      proxy.hostname,
                                                    port:
                                                      current
                                                        .destination
                                                        .kind ===
                                                      'proxy'
                                                        ? current
                                                            .destination
                                                            .port
                                                        : '',
                                                    protocol:
                                                      current
                                                        .destination
                                                        .kind ===
                                                      'proxy'
                                                        ? current
                                                            .destination
                                                            .protocol
                                                        : 'PROXY',
                                                  },
                                                },
                                            );
                                        }
                                      }}
                                    >
                                      <SelectOption value='direct'>
                                        DIRECT
                                      </SelectOption>
                                      {proxies.map((proxy) => (
                                        <SelectOption
                                          key={proxyIdentity(proxy)}
                                          value={proxyIdentity(proxy)}
                                        >
                                          {proxy.hostname ||
                                            proxy.hostinfo
                                              ?.hostname ||
                                            proxyIdentity(proxy)}
                                        </SelectOption>
                                      ))}
                                    </SelectField>
                                  </div>
                                  {editingRule.destination.kind ===
                                    'proxy' && (
                                    <div className='mt-2 grid gap-2 sm:grid-cols-[150px_150px]'>
                                      <SelectField
                                        aria-label='PAC protocol'
                                        value={
                                          editingRule.destination
                                            .protocol
                                        }
                                        onValueChange={(selectedValue) =>
                                          setEditingRule((current) =>
                                            current?.destination
                                              .kind === 'proxy'
                                              ? {
                                                  ...current,
                                                  destination: {
                                                    ...current.destination,
                                                    protocol: selectedValue as
                                                      | 'PROXY'
                                                      | 'HTTP'
                                                      | 'HTTPS'
                                                      | 'SOCKS'
                                                      | 'SOCKS4'
                                                      | 'SOCKS5',
                                                  },
                                                }
                                              : current,
                                          )
                                        }
                                      >
                                        <SelectOption value='PROXY'>PROXY</SelectOption>
                                        <SelectOption value='HTTP'>HTTP</SelectOption>
                                        <SelectOption value='HTTPS'>HTTPS</SelectOption>
                                        <SelectOption value='SOCKS'>SOCKS</SelectOption>
                                        <SelectOption value='SOCKS4'>SOCKS4</SelectOption>
                                        <SelectOption value='SOCKS5'>SOCKS5</SelectOption>
                                      </SelectField>
                                      <Input
                                        aria-label='Proxy traffic port'
                                        placeholder='Traffic port'
                                        value={
                                          editingRule.destination.port
                                        }
                                        onChange={(event) =>
                                          setEditingRule((current) =>
                                            current?.destination
                                              .kind === 'proxy'
                                              ? {
                                                  ...current,
                                                  destination: {
                                                    ...current.destination,
                                                    port: event.target
                                                      .value,
                                                  },
                                                }
                                              : current,
                                          )
                                        }
                                      />
                                    </div>
                                  )}
                                  <div className='mt-3 space-y-2 border-t pt-3'>
                                    <div className='flex items-center justify-between text-xs font-medium'>
                                      <span>
                                        Fallback destinations (used if
                                        the previous proxy is
                                        unavailable)
                                      </span>
                                      <Button
                                        type='button'
                                        size='sm'
                                        variant='outline'
                                        onClick={() =>
                                          setEditingRule(
                                            (current) =>
                                              current && {
                                                ...current,
                                                fallbacks: [
                                                  ...current.fallbacks,
                                                  { kind: 'direct' },
                                                ],
                                              },
                                          )
                                        }
                                      >
                                        <Plus className='size-3' />
                                        Add DIRECT fallback
                                      </Button>
                                    </div>
                                    {editingRule.fallbacks.map(
                                      (
                                        destination,
                                        fallbackIndex,
                                      ) => (
                                        <div
                                          key={fallbackIndex}
                                          className='flex flex-wrap items-center gap-2'
                                        >
                                          <SelectField
                                            aria-label={`Fallback destination ${fallbackIndex + 1}`}
                                            className='min-w-52'
                                            value={
                                              destination.kind ===
                                              'direct'
                                                ? 'direct'
                                                : destination.proxyRef
                                            }
                                            onValueChange={(selectedValue) =>
                                              setEditingRule(
                                                (current) => {
                                                  if (!current)
                                                    return current;
                                                  const fallbacks = [
                                                    ...current.fallbacks,
                                                  ];
                                                  if (
                                                    selectedValue ===
                                                    'direct'
                                                  )
                                                    fallbacks[
                                                      fallbackIndex
                                                    ] = {
                                                      kind: 'direct',
                                                    };
                                                  else {
                                                    const proxy =
                                                      proxies.find(
                                                        (item) =>
                                                          proxyIdentity(
                                                            item,
                                                          ) ===
                                                          selectedValue,
                                                      );
                                                    if (proxy)
                                                      fallbacks[
                                                        fallbackIndex
                                                      ] = {
                                                        kind: 'proxy',
                                                        proxyRef:
                                                          proxyIdentity(
                                                            proxy,
                                                          ),
                                                        host:
                                                          proxy.primary_address ||
                                                          proxy
                                                            .hostinfo
                                                            ?.ip ||
                                                          proxy.registered_address ||
                                                          proxy.hostname,
                                                        port:
                                                          destination.kind ===
                                                          'proxy'
                                                            ? destination.port
                                                            : '8080',
                                                        protocol:
                                                          destination.kind ===
                                                          'proxy'
                                                            ? destination.protocol
                                                            : 'PROXY',
                                                      };
                                                  }
                                                  return {
                                                    ...current,
                                                    fallbacks,
                                                  };
                                                },
                                              )
                                            }
                                          >
                                            <SelectOption value='direct'>
                                              DIRECT
                                            </SelectOption>
                                            {proxies.map((proxy) => (
                                              <SelectOption
                                                key={proxyIdentity(
                                                  proxy,
                                                )}
                                                value={proxyIdentity(
                                                  proxy,
                                                )}
                                              >
                                                {proxy.hostname ||
                                                  proxyIdentity(
                                                    proxy,
                                                  )}
                                              </SelectOption>
                                            ))}
                                          </SelectField>
                                          {destination.kind ===
                                            'proxy' && (
                                            <>
                                              <SelectField
                                                aria-label={`Fallback protocol ${fallbackIndex + 1}`}
                                                value={
                                                  destination.protocol
                                                }
                                                onValueChange={(selectedValue) =>
                                                  setEditingRule(
                                                    (current) =>
                                                      current && {
                                                        ...current,
                                                        fallbacks:
                                                          current.fallbacks.map(
                                                            (
                                                              item,
                                                              index,
                                                            ) =>
                                                              index ===
                                                                fallbackIndex &&
                                                              item.kind ===
                                                                'proxy'
                                                                ? {
                                                                    ...item,
                                                                    protocol:
                                                                      selectedValue as typeof item.protocol,
                                                                  }
                                                                : item,
                                                          ),
                                                      },
                                                  )
                                                }
                                              >
                                                <SelectOption value='PROXY'>PROXY</SelectOption>
                                                <SelectOption value='HTTP'>HTTP</SelectOption>
                                                <SelectOption value='HTTPS'>HTTPS</SelectOption>
                                                <SelectOption value='SOCKS'>SOCKS</SelectOption>
                                                <SelectOption value='SOCKS4'>
                                                  SOCKS4
                                                </SelectOption>
                                                <SelectOption value='SOCKS5'>
                                                  SOCKS5
                                                </SelectOption>
                                              </SelectField>
                                              <Input
                                                aria-label={`Fallback traffic port ${fallbackIndex + 1}`}
                                                className='w-28'
                                                placeholder='Port'
                                                value={
                                                  destination.port
                                                }
                                                onChange={(event) =>
                                                  setEditingRule(
                                                    (current) =>
                                                      current && {
                                                        ...current,
                                                        fallbacks:
                                                          current.fallbacks.map(
                                                            (
                                                              item,
                                                              index,
                                                            ) =>
                                                              index ===
                                                                fallbackIndex &&
                                                              item.kind ===
                                                                'proxy'
                                                                ? {
                                                                    ...item,
                                                                    port: event
                                                                      .target
                                                                      .value,
                                                                  }
                                                                : item,
                                                          ),
                                                      },
                                                  )
                                                }
                                              />
                                            </>
                                          )}
                                          <Button
                                            type='button'
                                            variant='ghost'
                                            size='icon'
                                            aria-label={`Remove fallback ${fallbackIndex + 1}`}
                                            onClick={() =>
                                              setEditingRule(
                                                (current) =>
                                                  current && {
                                                    ...current,
                                                    fallbacks:
                                                      current.fallbacks.filter(
                                                        (_, index) =>
                                                          index !==
                                                          fallbackIndex,
                                                      ),
                                                  },
                                              )
                                            }
                                          >
                                            <Trash2 className='size-4' />
                                          </Button>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                              ))}
                              {groupRules.length === 0 && <p className='py-2 text-xs text-muted-foreground'>No rules in this group yet.</p>}
                              </div>}
                            </section>
                            );
                          })}
                        {selected.rules.length === 0 && (
                          <p className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                            No visual rules found. Add a rule to get
                            started.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className='z-10 order-1 bg-background'>
                  <CardHeader>
                    <CardTitle className='text-base'>
                      {bulkMode ? 'Add rules' : 'Add rule'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
                    <section className='space-y-3 rounded-lg border bg-muted/20 p-4 md:col-span-2 xl:col-span-4'>
                      <div><h3 className='text-sm font-semibold'>Rule group</h3><p className='text-xs text-muted-foreground'>Place this rule in an ordered group.</p></div>
                      <div className='flex flex-wrap gap-2'>
                      <Input
                        aria-label='New rule group name'
                        placeholder='Create a rule group'
                        value={groupName}
                        onChange={(event) =>
                          setGroupName(event.target.value)
                        }
                        onKeyDown={(event) =>
                          event.key === 'Enter' && addGroup()
                        }
                      />
                      <Button
                        type='button'
                        variant='outline'
                        onClick={addGroup}
                      >
                        <Plus className='size-4' />
                        Add group
                      </Button>
                      <SelectField
                        aria-label='New rule group'
                        className='min-w-40'
                        value={activeGroupId}
                        onValueChange={(selectedValue) =>
                          setNewGroupId(selectedValue)
                        }
                      >
                        {groups.map((group) => (
                          <SelectOption key={group.id} value={group.id}>
                            {group.name}
                          </SelectOption>
                        ))}
                      </SelectField>
                      </div>
                    </section>
                    <section className='space-y-3 rounded-lg border bg-muted/20 p-4 md:col-span-2 xl:col-span-4'>
                      <div><h3 className='text-sm font-semibold'>Match condition</h3><p className='text-xs text-muted-foreground'>Choose how the request should match this rule.</p></div>
                      <div className='grid gap-3 md:grid-cols-2'>
                    <SelectField
                      aria-label='New match type'
                      value={conditionKind}
                      onValueChange={(selectedValue) => {
                        const nextKind = selectedValue as PacCondition['kind'];
                        setConditionKind(nextKind);
                        if (
                          nextKind === 'always' ||
                          nextKind === 'expression'
                        )
                          setBulkMode(false);
                        setConditionError('');
                      }}
                    >
                      <SelectOption value='domain'>Domain</SelectOption>
                      <SelectOption value='url'>URL pattern</SelectOption>
                      <SelectOption value='host'>Exact host</SelectOption>
                      <SelectOption value='starts-with'>Starts with</SelectOption>
                      <SelectOption value='ends-with'>Ends with</SelectOption>
                      <SelectOption value='contains'>Contains</SelectOption>
                      <SelectOption value='ip-network'>
                        IP address / CIDR range
                      </SelectOption>
                      <SelectOption value='expression'>
                        Custom PAC expression
                      </SelectOption>
                      <SelectOption value='regex'>Advanced regex</SelectOption>
                      <SelectOption value='always'>Default</SelectOption>
                    </SelectField>
                    {[
                      'regex',
                      'starts-with',
                      'ends-with',
                      'contains',
                    ].includes(conditionKind) && (
                      <SelectField
                        aria-label='Match against'
                        value={
                          conditionKind === 'regex'
                            ? regexTarget
                            : conditionTarget
                        }
                        onValueChange={(selectedValue) =>
                          conditionKind === 'regex'
                            ? setRegexTarget(
                                selectedValue as 'url' | 'host',
                              )
                            : setConditionTarget(
                                selectedValue as 'url' | 'host',
                              )
                        }
                      >
                        <SelectOption value='url'>URL</SelectOption>
                        <SelectOption value='host'>Host</SelectOption>
                      </SelectField>
                    )}
                    <label className='flex items-center gap-2 text-sm md:col-span-2 xl:col-span-4'>
                      <Switch
                        checked={bulkMode}
                        disabled={
                          conditionKind === 'always' ||
                          conditionKind === 'expression'
                        }
                        onCheckedChange={(checked) => {
                          setBulkMode(checked);
                          setConditionError('');
                        }}
                        aria-label='Add multiple rules at once'
                      />
                      Add multiple rules at once
                    </label>
                    {bulkMode ? (
                      <textarea
                        aria-label='Values for multiple rules'
                        className='min-h-28 resize-y rounded-md border bg-background px-3 py-2 text-sm md:col-span-2 xl:col-span-4'
                        placeholder={
                          'domain.com\ndomain2.com\ndomain3.com'
                        }
                        value={bulkValues}
                        onChange={(event) => {
                          setBulkValues(event.target.value);
                          setConditionError('');
                        }}
                      />
                    ) : conditionKind === 'expression' ? (
                      <textarea
                        aria-label='New condition value'
                        className='min-h-24 resize-y rounded-md border bg-background px-3 py-2 text-sm md:col-span-2 xl:col-span-4'
                        placeholder={conditionPlaceholder(
                          conditionKind,
                        )}
                        value={conditionValue}
                        onChange={(event) => {
                          setConditionValue(event.target.value);
                          setConditionError('');
                        }}
                      />
                    ) : (
                      <Input
                        aria-label='New condition value'
                        placeholder={conditionPlaceholder(
                          conditionKind,
                          conditionKind === 'regex'
                            ? regexTarget
                            : conditionTarget,
                        )}
                        value={conditionValue}
                        disabled={conditionKind === 'always'}
                        onChange={(event) => {
                          setConditionValue(event.target.value);
                          setConditionError('');
                        }}
                      />
                    )}
                    {bulkMode && (
                      <p className='text-xs text-muted-foreground md:col-span-2 xl:col-span-4'>
                        Paste one value per line. Every value uses the
                        selected match type and destination.
                      </p>
                    )}
                    {conditionKind === 'ip-network' && (
                      <p className='text-xs text-muted-foreground md:col-span-2 xl:col-span-4'>
                        IPv4 supports addresses and CIDR ranges. IPv6
                        generates FindProxyForURLEx and uses
                        isInNetEx; client support varies.
                      </p>
                    )}
                    {conditionError && (
                      <p
                        className='text-xs text-destructive md:col-span-2 xl:col-span-4'
                        role='alert'
                      >
                        {conditionError}
                      </p>
                    )}
                      </div>
                    </section>
                    <section className='space-y-3 rounded-lg border bg-muted/20 p-4 md:col-span-2 xl:col-span-4'>
                      <div><h3 className='text-sm font-semibold'>Routing destination</h3><p className='text-xs text-muted-foreground'>Choose DIRECT or a registered proxy and connection protocol.</p></div>
                      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
                    <SelectField
                      aria-label='New destination'
                      value={destinationKind}
                      onValueChange={(selectedValue) =>
                        setDestinationKind(
                          selectedValue as 'direct' | 'proxy',
                        )
                      }
                    >
                      <SelectOption value='direct'>DIRECT</SelectOption>
                      <SelectOption value='proxy'>Registered proxy</SelectOption>
                    </SelectField>
                    {destinationKind === 'proxy' ? (
                      <SelectField
                        aria-label='Destination proxy'
                        value={proxyRef}
                        onValueChange={(selectedValue) =>
                          setProxyRef(selectedValue)
                        }
                      >
                        <SelectOption value=''>Select a proxy</SelectOption>
                        {proxies.map((proxy) => (
                          <SelectOption
                            key={proxyIdentity(proxy)}
                            value={proxyIdentity(proxy)}
                          >
                            {proxy.hostname || proxyIdentity(proxy)}
                          </SelectOption>
                        ))}
                      </SelectField>
                    ) : (
                      <span />
                    )}
                    {destinationKind === 'proxy' && (
                      <>
                        <SelectField
                          aria-label='New destination protocol'
                          value={trafficProtocol}
                          onValueChange={(selectedValue) =>
                            setTrafficProtocol(
                              selectedValue as typeof trafficProtocol,
                            )
                          }
                        >
                          <SelectOption value='PROXY'>PROXY</SelectOption>
                          <SelectOption value='HTTP'>HTTP</SelectOption>
                          <SelectOption value='HTTPS'>HTTPS</SelectOption>
                          <SelectOption value='SOCKS'>SOCKS</SelectOption>
                          <SelectOption value='SOCKS4'>SOCKS4</SelectOption>
                          <SelectOption value='SOCKS5'>SOCKS5</SelectOption>
                        </SelectField>
                        <Input
                          aria-label='New destination port'
                          placeholder='Traffic port'
                          value={trafficPort}
                          onChange={(event) =>
                            setTrafficPort(event.target.value)
                          }
                        />
                      </>
                    )}
                      </div>
                    </section>
                    <Button
                      className='md:col-span-full md:justify-self-end'
                      onClick={addRule}
                    >
                      <Plus className='size-4' />
                      {bulkMode ? 'Add rules' : 'Add rule'}
                    </Button>
                  </CardContent>
                </Card>
              </div>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <p className='text-xs text-muted-foreground'>
                  {dirty
                    ? 'Changes are saved locally automatically; sync or export when ready.'
                    : 'The local configuration matches its base version.'}
                </p>
              </div>
              {false && (
              <>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Test a URL
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  <div className='flex flex-col gap-2 sm:flex-row'>
                    <Input
                      aria-label='URL to test'
                      placeholder='https://www.example.com/resource'
                      value={testInput}
                      onChange={(event) =>
                        setTestInput(event.target.value)
                      }
                    />
                    <Button
                      variant='outline'
                      disabled={
                        !testInput || Boolean(selected.parseError)
                      }
                      onClick={() => setTestUrl(testInput)}
                    >
                      <Check className='size-4' />
                      Evaluate rules
                    </Button>
                  </div>
                  {testUrl &&
                    (selected.parseError ? (
                      <p className='text-sm text-amber-600'>
                        Not evaluated: the PAC contains logic the
                        editor does not support yet.
                      </p>
                    ) : preview.uncertain ? (
                      <p className='rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700'>
                        Preview is uncertain: an earlier IP rule
                        requires DNS resolution or a custom PAC
                        expression must be evaluated by a PAC runtime.
                        Later rules are not reported as a definitive
                        match.
                      </p>
                    ) : matchedRule ? (
                      <p className='rounded-md bg-muted p-3 text-sm'>
                        Matched{' '}
                        <strong>
                          {labelCondition(matchedRule.condition)}:{' '}
                          {matchedRule.condition.value ||
                            'default rule'}
                        </strong>{' '}
                        · destination:{' '}
                        <strong>
                          {displayDestination(
                            matchedRule.destination,
                            proxies,
                          )}
                          {(matchedRule.fallbacks?.length ?? 0) > 0 &&
                            `; ${matchedRule.fallbacks?.map((destination) => displayDestination(destination, proxies)).join('; ')}`}
                        </strong>
                      </p>
                    ) : (
                      <p className='text-sm text-muted-foreground'>
                        No rules matched, and no default rule is
                        configured.
                      </p>
                    ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Generated PAC preview
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  {validateSource(selected).length > 0 && (
                    <p className='text-sm text-destructive'>
                      {validateSource(selected)[0]}
                    </p>
                  )}
                  <pre className='max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs'>
                    {validateSource(selected).length
                      ? 'Fix the validation errors to generate a preview.'
                      : generatePac(selected)}
                  </pre>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Publishing
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-2 text-sm'>
                  <p>
                    This source is read-only. The server may not
                    accept writes; export the generated PAC and
                    publish it using your server's approved process.
                  </p>
                  <div>
                    <Button variant='outline' onClick={exportPac}>
                      <Download className='size-4' />
                      Download generated PAC
                    </Button>
                  </div>
                  {selected.remoteContent && (
                    <details>
                      <summary className='cursor-pointer text-xs text-muted-foreground'>
                        View current remote PAC content
                      </summary>
                      <pre className='mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs'>
                        {selected.remoteContent}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
              </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
