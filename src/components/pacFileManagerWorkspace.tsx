'use client';

import { invoke } from '@tauri-apps/api/core';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  CloudDownload,
  Download,
  FileCode2,
  Plus,
  RefreshCcw,
  Router,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import {
  generatePac,
  type PacCondition,
  type PacDestination,
  type PacFetch,
  type PacRule,
  type PacSource,
  parsePac,
  proxyIdentity,
  rulesEqual,
  urlMatches,
} from '@/lib/pac';
import { getLocalStorage, postLocalStorage } from '@/lib/utilsClient';

const STORAGE_KEY = 'pac-sources';
const statusText = {
  synced: 'Sincronizado',
  'local-changes': 'Cambios locales',
  'remote-changes': 'Cambios remotos',
  conflict: 'Conflicto',
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
  return !rulesEqual(source.rules, source.baseRules);
}
function labelCondition(condition: PacCondition) {
  return condition.kind === 'always'
    ? 'Por defecto'
    : condition.kind === 'domain'
      ? 'Dominio'
      : condition.kind === 'url'
        ? 'URL (glob)'
        : condition.kind === 'host'
          ? 'Host'
          : 'Regex avanzada';
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
}: {
  proxies: Proxy[];
}) {
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
  const [regexTarget, setRegexTarget] = useState<'url' | 'host'>(
    'url',
  );
  const [destinationKind, setDestinationKind] = useState<
    'direct' | 'proxy'
  >('direct');
  const [proxyRef, setProxyRef] = useState('');
  const [trafficProtocol, setTrafficProtocol] = useState<
    'PROXY' | 'HTTPS' | 'SOCKS' | 'SOCKS5'
  >('PROXY');
  const [trafficPort, setTrafficPort] = useState('');

  useEffect(() => {
    setSources(getLocalStorage<PacSource[]>(STORAGE_KEY) ?? []);
    setSelectedId(localStorage.getItem('pac-selected-source') ?? '');
    setLoadedSources(true);
  }, []);
  useEffect(() => {
    if (loadedSources) postLocalStorage(STORAGE_KEY, sources);
  }, [sources, loadedSources]);
  useEffect(() => {
    if (selectedId)
      localStorage.setItem('pac-selected-source', selectedId);
  }, [selectedId]);

  const selected = sources.find((source) => source.id === selectedId);
  const dirty = selected ? isDirty(selected) : false;
  const matchedRule = useMemo(() => {
    if (!selected || selected.parseError || !testUrl)
      return undefined;
    let host = '';
    try {
      host = new URL(testUrl).hostname;
    } catch {
      return undefined;
    }
    return selected.rules.find((rule) =>
      urlMatches(testUrl, host, rule.condition),
    );
  }, [selected, testUrl]);

  const updateSource = (source: PacSource) =>
    setSources((current) =>
      current.map((item) => (item.id === source.id ? source : item)),
    );
  const setSourceRules = (source: PacSource, rules: PacRule[]) => {
    const changed = !rulesEqual(rules, source.baseRules);
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
      toast.success(`Fuente descargada (${result.status})`);
    } catch (error) {
      updateSource({ ...source, status: 'offline' });
      toast.error(
        `No se pudo sincronizar ${source.name}: ${String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const addSource = async () => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      toast.error('Ingresá una URL válida.');
      return;
    }
    if (
      !['http:', 'https:'].includes(parsedUrl.protocol) ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      toast.error(
        'La URL debe usar HTTP o HTTPS y no incluir credenciales.',
      );
      return;
    }
    if (
      sources.some((source) => source.url === parsedUrl.toString())
    ) {
      toast.error('Esa fuente ya está registrada.');
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
  };

  const removeSource = (source: PacSource) => {
    setSources((current) =>
      current.filter((item) => item.id !== source.id),
    );
    if (selectedId === source.id)
      setSelectedId(
        sources.find((item) => item.id !== source.id)?.id ?? '',
      );
  };
  const updateRule = (ruleId: string, changes: Partial<PacRule>) => {
    if (!selected || selected.parseError) return;
    const rules = selected.rules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...changes } : rule,
    );
    setSourceRules(selected, rules);
  };
  const addRule = () => {
    if (!selected || selected.parseError) return;
    if (conditionKind === 'regex') {
      try {
        new RegExp(conditionValue);
      } catch {
        toast.error('La expresión regular no es válida.');
        return;
      }
    }
    let destination: PacDestination = { kind: 'direct' };
    if (destinationKind === 'proxy') {
      const proxy = proxies.find(
        (item) => proxyIdentity(item) === proxyRef,
      );
      if (!proxy) {
        toast.error('Seleccioná un proxy existente.');
        return;
      }
      if (
        !/^\d{1,5}$/.test(trafficPort) ||
        Number(trafficPort) < 1 ||
        Number(trafficPort) > 65535
      ) {
        toast.error('Ingresá un puerto de tráfico válido.');
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
    const value =
      conditionKind === 'always' ? '' : conditionValue.trim();
    if (conditionKind !== 'always' && !value) {
      toast.error('Ingresá el valor de la condición.');
      return;
    }
    if (
      conditionKind === 'always' &&
      selected.rules.some((rule) => rule.condition.kind === 'always')
    ) {
      toast.error('Solo puede existir una regla por defecto.');
      return;
    }
    const rule: PacRule = {
      id: crypto.randomUUID(),
      condition: {
        kind: conditionKind,
        value,
        ...(conditionKind === 'regex' ? { target: regexTarget } : {}),
      },
      destination,
      editable: true,
    };
    const index = selected.rules.findIndex(
      (item) => item.condition.kind === 'always',
    );
    const rules = [...selected.rules];
    rules.splice(index < 0 ? rules.length : index, 0, rule);
    setSourceRules(selected, rules);
    setConditionValue('');
  };
  const moveRule = (rule: PacRule, delta: number) => {
    if (!selected || rule.condition.kind === 'always') return;
    const list = selected.rules.filter(
      (item) => item.condition.kind !== 'always',
    );
    const index = list.findIndex((item) => item.id === rule.id),
      next = index + delta;
    if (next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]];
    const fallback = selected.rules.find(
      (item) => item.condition.kind === 'always',
    );
    setSourceRules(selected, fallback ? [...list, fallback] : list);
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
      prefix: parsed.prefix,
      suffix: parsed.suffix,
      pendingContent: undefined,
      pendingHash: undefined,
      status: rulesEqual(selected.rules, parsed.rules)
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
      toast.error('No hay contenido PAC para exportar.');
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
      issues.push(
        'Agregá al menos una regla antes de generar el PAC.',
      );
    if (
      source.rules.filter((rule) => rule.condition.kind === 'always')
        .length > 1
    )
      issues.push('Solo puede existir una regla por defecto.');
    for (const rule of source.rules) {
      if (
        rule.condition.kind !== 'always' &&
        !rule.condition.value.trim()
      )
        issues.push('Hay una condición vacía.');
      if (rule.condition.kind === 'regex') {
        try {
          new RegExp(rule.condition.value);
        } catch {
          issues.push(
            `La regex “${rule.condition.value}” no es válida.`,
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
            'Una regla apunta a un proxy que ya no está registrado.',
          );
        if (
          !/^\d{1,5}$/.test(destination.port) ||
          Number(destination.port) < 1 ||
          Number(destination.port) > 65535
        )
          issues.push(
            'Una regla tiene un puerto de tráfico inválido.',
          );
      }
    }
    return issues;
  };

  return (
    <div className='grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]'>
      <aside className='flex flex-col gap-4'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Plus className='size-4' />
              Registrar fuente PAC
            </CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            <Input
              aria-label='Nombre de la fuente'
              placeholder='Nombre (opcional)'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              aria-label='URL de WPAD o PAC'
              placeholder='http://servidor.domain/wpad.dat'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button onClick={addSource} disabled={loading}>
              <CloudDownload className='size-4' />
              Agregar y cargar
            </Button>
            <p className='text-xs text-muted-foreground'>
              La aplicación descarga la fuente. No intenta escribir en
              el servidor.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>
              Fuentes registradas{' '}
              <Badge variant='secondary' className='ml-1'>
                {sources.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            {sources.length === 0 && (
              <p className='text-sm text-muted-foreground'>
                Todavía no hay fuentes PAC.
              </p>
            )}
            {sources.map((source) => (
              <button
                key={source.id}
                type='button'
                onClick={() => setSelectedId(source.id)}
                className={`rounded-lg border p-3 text-left transition-colors ${selectedId === source.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'}`}
              >
                <span className='flex items-start justify-between gap-2'>
                  <span className='min-w-0'>
                    <span className='block truncate text-sm font-medium'>
                      {source.name}
                    </span>
                    <span className='mt-1 block truncate text-xs text-muted-foreground'>
                      {source.url}
                    </span>
                  </span>
                  <Badge variant={statusVariant[source.status]}>
                    {statusText[source.status]}
                  </Badge>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      </aside>

      {!selected ? (
        <Card className='flex min-h-80 items-center justify-center'>
          <div className='max-w-md px-6 text-center'>
            <FileCode2 className='mx-auto size-10 text-muted-foreground' />
            <h2 className='mt-4 font-semibold'>PAC File Manager</h2>
            <p className='mt-2 text-sm text-muted-foreground'>
              Registrá una fuente WPAD/PAC para cargar y revisar sus
              reglas de routing.
            </p>
          </div>
        </Card>
      ) : (
        <div className='flex min-w-0 flex-col gap-4'>
          <Card>
            <CardContent className='flex flex-col gap-5 p-5 md:flex-row md:items-start md:justify-between'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-2'>
                  <h2 className='text-xl font-semibold'>
                    {selected.name}
                  </h2>
                  <Badge variant={statusVariant[selected.status]}>
                    {statusText[selected.status]}
                  </Badge>
                </div>
                <p className='mt-1 break-all text-sm text-muted-foreground'>
                  Origen: {selected.url}
                </p>
                {selected.resolvedUrl &&
                  selected.resolvedUrl !== selected.url && (
                    <p className='mt-1 break-all text-xs text-muted-foreground'>
                      URL final tras redirecciones:{' '}
                      {selected.resolvedUrl}
                    </p>
                  )}
                <p className='mt-1 text-xs text-muted-foreground'>
                  {selected.lastSyncedAt
                    ? `Última sincronización: ${new Date(selected.lastSyncedAt).toLocaleString()}`
                    : 'Aún no sincronizada'}{' '}
                  · {selected.rules.length} reglas
                </p>
              </div>
              <div className='flex shrink-0 flex-wrap gap-2'>
                <Button
                  variant='outline'
                  onClick={() => synchronize(selected)}
                  disabled={loading}
                >
                  <RefreshCcw
                    className={
                      loading ? 'size-4 animate-spin' : 'size-4'
                    }
                  />
                  Sincronizar
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
                  Exportar PAC
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Eliminar fuente'
                  onClick={() => removeSource(selected)}
                >
                  <Trash2 className='size-4' />
                </Button>
              </div>
            </CardContent>
          </Card>

          {selected.pendingContent && (
            <Card className='border-amber-500/40'>
              <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
                <p className='flex items-center gap-2 text-sm'>
                  <CircleAlert className='size-4 shrink-0 text-amber-500' />
                  {dirty
                    ? 'La fuente remota cambió y también hay cambios locales. Elegí qué versión conservar.'
                    : 'Se detectaron cambios remotos. Aplicarlos actualizará el editor local.'}
                </p>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={applyRemote}
                  >
                    Cargar versión remota
                  </Button>
                  {dirty && (
                    <Button size='sm' onClick={keepLocal}>
                      Conservar local
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {selected.status === 'offline' && (
            <p className='rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
              <WifiOff className='mr-2 inline size-4' />
              No se pudo alcanzar la fuente. Se conserva la
              configuración local.
            </p>
          )}
          {selected.parseError && (
            <Card className='border-amber-500/40'>
              <CardContent className='p-4 text-sm'>
                <p className='font-medium'>
                  El contenido descargado se conserva en modo de solo
                  lectura.
                </p>
                <p className='mt-1 text-muted-foreground'>
                  {selected.parseError} Podés inspeccionarlo y
                  descargar el PAC original; no se generará una
                  versión parcial.
                </p>
              </CardContent>
            </Card>
          )}

          {!selected.parseError && (
            <>
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='flex items-center justify-between gap-2 text-base'>
                    <span>
                      Reglas de routing{' '}
                      <Badge variant='secondary' className='ml-1'>
                        {selected.rules.length}
                      </Badge>
                    </span>
                    <span className='text-xs font-normal text-muted-foreground'>
                      El orden define la prioridad
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  {selected.rules.map((rule, index) => (
                    <div
                      key={rule.id}
                      className='rounded-lg border p-3'
                    >
                      <div className='flex flex-wrap items-center gap-2'>
                        <Badge variant='outline'>
                          {rule.condition.kind === 'always'
                            ? 'Final'
                            : `#${index + 1}`}
                        </Badge>
                        <span className='font-medium'>
                          {labelCondition(rule.condition)}
                        </span>
                        <span className='min-w-0 flex-1 truncate text-sm text-muted-foreground'>
                          {rule.condition.value ||
                            'cualquier destino restante'}
                        </span>
                        <span className='inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs'>
                          <Router className='size-3' />
                          {displayDestination(
                            rule.destination,
                            proxies,
                          )}
                        </span>
                        {rule.condition.kind !== 'always' && (
                          <span className='flex'>
                            <Button
                              variant='ghost'
                              size='icon'
                              aria-label='Subir prioridad'
                              disabled={index === 0}
                              onClick={() => moveRule(rule, -1)}
                            >
                              <ArrowUp className='size-4' />
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon'
                              aria-label='Bajar prioridad'
                              disabled={
                                index ===
                                selected.rules.filter(
                                  (item) =>
                                    item.condition.kind !== 'always',
                                ).length -
                                  1
                              }
                              onClick={() => moveRule(rule, 1)}
                            >
                              <ArrowDown className='size-4' />
                            </Button>
                          </span>
                        )}
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Eliminar regla'
                          onClick={() =>
                            setSourceRules(
                              selected,
                              selected.rules.filter(
                                (item) => item.id !== rule.id,
                              ),
                            )
                          }
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </div>
                      <div className='mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_minmax(220px,0.8fr)]'>
                        <select
                          aria-label='Tipo de condición'
                          className='h-9 rounded-md border bg-background px-3 text-sm'
                          value={rule.condition.kind}
                          disabled={rule.condition.kind === 'always'}
                          onChange={(event) =>
                            updateRule(rule.id, {
                              condition: {
                                ...rule.condition,
                                kind: event.target
                                  .value as PacCondition['kind'],
                              },
                            })
                          }
                        >
                          <option value='domain'>Dominio</option>
                          <option value='url'>URL (glob)</option>
                          <option value='host'>Host</option>
                          <option value='regex'>
                            Regex avanzada
                          </option>
                          {rule.condition.kind === 'always' && (
                            <option value='always'>
                              Por defecto
                            </option>
                          )}
                        </select>
                        <Input
                          aria-label='Condición de la regla'
                          value={rule.condition.value}
                          onChange={(event) =>
                            updateRule(rule.id, {
                              condition: {
                                ...rule.condition,
                                value: event.target.value,
                              },
                            })
                          }
                        />
                        <select
                          aria-label='Destino de la regla'
                          className='h-9 rounded-md border bg-background px-3 text-sm'
                          value={
                            rule.destination.kind === 'direct'
                              ? 'direct'
                              : rule.destination.proxyRef
                          }
                          onChange={(event) => {
                            if (event.target.value === 'direct')
                              updateRule(rule.id, {
                                destination: { kind: 'direct' },
                              });
                            else {
                              const proxy = proxies.find(
                                (item) =>
                                  proxyIdentity(item) ===
                                  event.target.value,
                              );
                              if (proxy)
                                updateRule(rule.id, {
                                  destination: {
                                    kind: 'proxy',
                                    proxyRef: proxyIdentity(proxy),
                                    host:
                                      proxy.primary_address ||
                                      proxy.hostinfo?.ip ||
                                      proxy.registered_address ||
                                      proxy.hostname,
                                    port:
                                      rule.destination.kind ===
                                      'proxy'
                                        ? rule.destination.port
                                        : '',
                                    protocol:
                                      rule.destination.kind ===
                                      'proxy'
                                        ? rule.destination.protocol
                                        : 'PROXY',
                                  },
                                });
                            }
                          }}
                        >
                          <option value='direct'>DIRECT</option>
                          {proxies.map((proxy) => (
                            <option
                              key={proxyIdentity(proxy)}
                              value={proxyIdentity(proxy)}
                            >
                              {proxy.hostname ||
                                proxy.hostinfo?.hostname ||
                                proxyIdentity(proxy)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {rule.destination.kind === 'proxy' && (
                        <div className='mt-2 grid gap-2 sm:grid-cols-[150px_150px]'>
                          <select
                            aria-label='Protocolo PAC'
                            className='h-9 rounded-md border bg-background px-3 text-sm'
                            value={rule.destination.protocol}
                            onChange={(event) =>
                              updateRule(rule.id, {
                                destination: {
                                  ...(rule.destination as Extract<
                                    PacDestination,
                                    { kind: 'proxy' }
                                  >),
                                  protocol: event.target.value as
                                    | 'PROXY'
                                    | 'HTTPS'
                                    | 'SOCKS'
                                    | 'SOCKS5',
                                },
                              })
                            }
                          >
                            <option>PROXY</option>
                            <option>HTTPS</option>
                            <option>SOCKS</option>
                            <option>SOCKS5</option>
                          </select>
                          <Input
                            aria-label='Puerto de tráfico del proxy'
                            placeholder='Puerto de tráfico'
                            value={rule.destination.port}
                            onChange={(event) =>
                              updateRule(rule.id, {
                                destination: {
                                  ...(rule.destination as Extract<
                                    PacDestination,
                                    { kind: 'proxy' }
                                  >),
                                  port: event.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  {selected.rules.length === 0 && (
                    <p className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                      No se encontraron reglas visuales. Agregá una
                      regla para empezar.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Agregar regla
                  </CardTitle>
                </CardHeader>
                <CardContent className='grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_150px_150px_auto]'>
                  <select
                    aria-label='Tipo de condición nueva'
                    className='h-9 rounded-md border bg-background px-3 text-sm'
                    value={conditionKind}
                    onChange={(event) =>
                      setConditionKind(
                        event.target.value as PacCondition['kind'],
                      )
                    }
                  >
                    <option value='domain'>Dominio</option>
                    <option value='url'>URL (glob)</option>
                    <option value='host'>Host</option>
                    <option value='regex'>Regex avanzada</option>
                    <option value='always'>Por defecto</option>
                  </select>
                  {conditionKind === 'regex' && (
                    <select
                      aria-label='Objetivo del regex'
                      className='h-9 rounded-md border bg-background px-3 text-sm'
                      value={regexTarget}
                      onChange={(event) =>
                        setRegexTarget(
                          event.target.value as 'url' | 'host',
                        )
                      }
                    >
                      <option value='url'>URL</option>
                      <option value='host'>Host</option>
                    </select>
                  )}
                  <Input
                    aria-label='Valor de condición nueva'
                    placeholder={
                      conditionKind === 'domain'
                        ? 'example.com'
                        : conditionKind === 'url'
                          ? '*example.com/path*'
                          : conditionKind === 'host'
                            ? 'server.example.com'
                            : conditionKind === 'regex'
                              ? '^https://.*\\.example\\.com/'
                              : 'Se aplica al final'
                    }
                    value={conditionValue}
                    disabled={conditionKind === 'always'}
                    onChange={(event) =>
                      setConditionValue(event.target.value)
                    }
                  />
                  <select
                    aria-label='Destino nuevo'
                    className='h-9 rounded-md border bg-background px-3 text-sm'
                    value={destinationKind}
                    onChange={(event) =>
                      setDestinationKind(
                        event.target.value as 'direct' | 'proxy',
                      )
                    }
                  >
                    <option value='direct'>DIRECT</option>
                    <option value='proxy'>Proxy registrado</option>
                  </select>
                  {destinationKind === 'proxy' ? (
                    <select
                      aria-label='Proxy destino'
                      className='h-9 rounded-md border bg-background px-3 text-sm'
                      value={proxyRef}
                      onChange={(event) =>
                        setProxyRef(event.target.value)
                      }
                    >
                      <option value=''>Elegir proxy</option>
                      {proxies.map((proxy) => (
                        <option
                          key={proxyIdentity(proxy)}
                          value={proxyIdentity(proxy)}
                        >
                          {proxy.hostname || proxyIdentity(proxy)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span />
                  )}
                  {destinationKind === 'proxy' && (
                    <>
                      <select
                        aria-label='Protocolo destino nuevo'
                        className='h-9 rounded-md border bg-background px-3 text-sm'
                        value={trafficProtocol}
                        onChange={(event) =>
                          setTrafficProtocol(
                            event.target
                              .value as typeof trafficProtocol,
                          )
                        }
                      >
                        <option>PROXY</option>
                        <option>HTTPS</option>
                        <option>SOCKS</option>
                        <option>SOCKS5</option>
                      </select>
                      <Input
                        aria-label='Puerto destino nuevo'
                        placeholder='Puerto de tráfico'
                        value={trafficPort}
                        onChange={(event) =>
                          setTrafficPort(event.target.value)
                        }
                      />
                    </>
                  )}
                  <Button
                    className='md:col-span-full md:justify-self-end'
                    onClick={addRule}
                  >
                    <Plus className='size-4' />
                    Agregar regla
                  </Button>
                </CardContent>
              </Card>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <p className='text-xs text-muted-foreground'>
                  {dirty
                    ? 'Los cambios se guardan localmente automáticamente; falta sincronizar o exportar.'
                    : 'La configuración local coincide con la versión base.'}
                </p>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Probar una URL
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  <div className='flex flex-col gap-2 sm:flex-row'>
                    <Input
                      aria-label='URL para probar'
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
                      Evaluar reglas
                    </Button>
                  </div>
                  {testUrl &&
                    (selected.parseError ? (
                      <p className='text-sm text-amber-600'>
                        No se evalúa: el PAC contiene lógica que el
                        editor todavía no interpreta.
                      </p>
                    ) : matchedRule ? (
                      <p className='rounded-md bg-muted p-3 text-sm'>
                        Coincide con{' '}
                        <strong>
                          {labelCondition(matchedRule.condition)}:{' '}
                          {matchedRule.condition.value ||
                            'regla final'}
                        </strong>{' '}
                        · destino:{' '}
                        <strong>
                          {displayDestination(
                            matchedRule.destination,
                            proxies,
                          )}
                        </strong>
                      </p>
                    ) : (
                      <p className='text-sm text-muted-foreground'>
                        No coincide con ninguna regla y no hay una
                        regla por defecto.
                      </p>
                    ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Vista previa del PAC generado
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
                      ? 'Corregí los errores de validación para generar la vista previa.'
                      : generatePac(selected)}
                  </pre>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Publicación
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-2 text-sm'>
                  <p>
                    Esta fuente solo se lee. No se supone que el
                    servidor acepte escrituras; exportá el PAC
                    generado y publicalo con el mecanismo autorizado
                    de tu servidor.
                  </p>
                  <div>
                    <Button variant='outline' onClick={exportPac}>
                      <Download className='size-4' />
                      Descargar PAC generado
                    </Button>
                  </div>
                  {selected.remoteContent && (
                    <details>
                      <summary className='cursor-pointer text-xs text-muted-foreground'>
                        Ver contenido PAC remoto actual
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
        </div>
      )}
    </div>
  );
}
