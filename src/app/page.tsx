/** biome-ignore-all lint/style/useNamingConvention: <> */
/** biome-ignore-all lint/performance/noImgElement: <> */
'use client';
import { useForm } from '@mantine/form';
import { invoke } from '@tauri-apps/api/core';
import { some } from 'lodash-es';
import {
  Activity,
  Plus,
  RefreshCcw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as v from 'valibot';
import DotField from '@/components/dots';
import ProxyCard from '@/components/proxyCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import getCredentials from '@/lib/getCredentials';
import {
  deleteLocalStorage,
  getLocalStorage,
  postLocalStorage,
} from '@/lib/utilsClient';

const schema = v.object({
  hostname: v.pipe(
    v.string(),
    v.nonEmpty('Please enter a valid hostname before proceeding.'),
  ),
});

function knownProxyValue(value?: string) {
  const normalized = value?.trim();
  const normalizedLowercase = normalized?.toLowerCase();
  return normalized &&
    normalizedLowercase !== 'unknown' &&
    normalizedLowercase !== 'unkown'
    ? normalized
    : undefined;
}

function isIpAddress(value?: string) {
  if (!value || value.trim() !== value || /\s/.test(value)) return false;
  if (value.includes(':')) {
    try {
      return new URL(`http://[${value}]/`).hostname.length > 0;
    } catch {
      return false;
    }
  }
  const octets = value.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) =>
      /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255,
    )
  );
}

function getLoggedHostname(proxy: Proxy) {
  const pingTarget = proxy.pinglog?.match(
    /Pinging\s+([^\s[]+)(?:\s+\[([^\]]+)\])?/i,
  )?.[1];
  if (knownProxyValue(pingTarget) && !isIpAddress(pingTarget)) {
    return pingTarget;
  }

  const dnsQuery = proxy.nslookup?.match(/can't find\s+([^\s:]+)/i)?.[1];
  return knownProxyValue(dnsQuery) && !isIpAddress(dnsQuery)
    ? dnsQuery
    : undefined;
}

function getProxyPrimaryAddress(proxy: Proxy) {
  const primaryAddress = knownProxyValue(proxy.primary_address);
  if (primaryAddress) return primaryAddress;

  const resolvedIp = knownProxyValue(proxy.hostinfo?.ip);
  if (isIpAddress(resolvedIp)) return resolvedIp;

  const registeredAddress = knownProxyValue(proxy.registered_address);
  if (registeredAddress) return registeredAddress;

  const hostname = knownProxyValue(proxy.hostname);
  if (hostname) return hostname;

  const pingTarget = proxy.pinglog?.match(
    /Pinging\s+([^\s[]+)(?:\s+\[([^\]]+)\])?/i,
  );
  if (isIpAddress(pingTarget?.[2])) return pingTarget?.[2];
  if (knownProxyValue(pingTarget?.[1])) return pingTarget?.[1];

  const dnsQuery = proxy.nslookup?.match(/can't find\s+([^\s:]+)/i)?.[1];
  return knownProxyValue(dnsQuery) ?? null;
}

function mergeProxyCheck(previous: Proxy, check: Proxy): Proxy {
  const keepKnown = (latest?: string, saved?: string) =>
    knownProxyValue(latest) ?? knownProxyValue(saved) ?? 'unknown';
  const checkedPrimary = knownProxyValue(check.primary_address);

  return {
    ...previous,
    ...check,
    hostname: keepKnown(check.hostname, previous.hostname),
    registered_address:
      knownProxyValue(previous.registered_address) ??
      knownProxyValue(check.registered_address) ??
      knownProxyValue(previous.hostname) ??
      knownProxyValue(check.hostname),
    primary_address:
      checkedPrimary ?? getProxyPrimaryAddress(previous) ?? undefined,
    hostinfo: {
      hostname: keepKnown(check.hostinfo?.hostname, previous.hostinfo?.hostname),
      ip: keepKnown(check.hostinfo?.ip, previous.hostinfo?.ip),
      dnsname: keepKnown(check.hostinfo?.dnsname, previous.hostinfo?.dnsname),
      dnsip: keepKnown(check.hostinfo?.dnsip, previous.hostinfo?.dnsip),
    },
  };
}

export default function Page() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [disable, setDisable] = useState(false);
  const [disableReCheck, setDisableReCheck] = useState(false);

  useEffect(() => {
    const storedProxies: Proxy[] = getLocalStorage('proxies') || [];
    const normalizedProxies = storedProxies.map((proxy) => {
      const recoveredHostname =
        knownProxyValue(proxy.hostname) ??
        knownProxyValue(proxy.hostinfo?.hostname) ??
        getLoggedHostname(proxy);
      const primaryAddress = getProxyPrimaryAddress(proxy);

      return {
        ...proxy,
        registered_address:
          knownProxyValue(proxy.registered_address) ??
          recoveredHostname ??
          primaryAddress ??
          undefined,
        primary_address: primaryAddress ?? proxy.primary_address,
        hostname: recoveredHostname ?? proxy.hostname,
        hostinfo: {
          ...proxy.hostinfo,
          hostname:
            knownProxyValue(proxy.hostinfo?.hostname) ??
            recoveredHostname ??
            'unknown',
          ip:
            knownProxyValue(proxy.hostinfo?.ip) ??
            (isIpAddress(primaryAddress) ? primaryAddress : 'unknown'),
        },
      };
    });
    setProxies(normalizedProxies);
    if (
      normalizedProxies.some(
        (proxy, index) =>
          proxy.primary_address !== storedProxies[index]?.primary_address ||
          proxy.registered_address !==
            storedProxies[index]?.registered_address ||
          proxy.hostname !== storedProxies[index]?.hostname ||
          proxy.hostinfo.ip !== storedProxies[index]?.hostinfo?.ip ||
          proxy.hostinfo.hostname !==
            storedProxies[index]?.hostinfo?.hostname,
      )
    ) {
      postLocalStorage('proxies', normalizedProxies);
    }
    if (getCredentials('one-time-credentials')) {
      deleteLocalStorage('one-time-credentials');
    }
  }, []);

  const reCheckProxies = () => {
    setDisableReCheck(true);
    const updatePromise = Promise.all(
      proxies.map(async (proxy) => {
        // Preserve the existing behavior of not rechecking ambiguous multi-IP hosts.
        if (proxy.hostinfo.ip.split(/\s+/).filter(Boolean).length > 1) {
          return proxy;
        }
        const address = getProxyPrimaryAddress(proxy);
        if (!address) return proxy;

        const check = await invoke<Proxy>('getproxystatus', {
          hostname: address,
        });
        return mergeProxyCheck(proxy, check);
      }),
    )
      .then((result) => {
        postLocalStorage('proxies', result);
        setProxies(result);
        return result;
      })
      .finally(() => setDisableReCheck(false));

    toast.promise<Proxy[]>(updatePromise, {
      loading: 'Updating proxies status...',
      success: () => 'Proxies updated successfully.',
      error: (e) => `Error checking proxies: ${e}`,
    });
  };

  const deleteProxy = (proxyToDelete: Proxy) => {
    const updatedProxies = proxies.filter((proxy) => proxy !== proxyToDelete);
    postLocalStorage('proxies', updatedProxies);
    setProxies(updatedProxies);
  };
  const addProxy = (hostname: string) => {
    setDisable(true);
    if (
      some(
        proxies,
        (p: Proxy) =>
          p.hostinfo.ip === hostname ||
          p.hostname === hostname ||
          p.registered_address === hostname ||
          p.primary_address === hostname,
      )
    ) {
      setDisable(false);
      toast.error('Proxy already added');
      return;
    }
    toast.promise(
      invoke<Proxy>('getproxystatus', { hostname: hostname }),
      {
        loading: `Checking ${hostname} proxy status...`,
        success: (result) => {
          setDisable(false);
          postLocalStorage('proxies', [...proxies, result]);
          setProxies([...proxies, result]);
          return 'Proxy added successfully.';
        },
        error: (e) => {
          setDisable(false);
          return `Error adding proxy: ${e}`;
        },
      },
    );
  };

  const form = useForm({
    validate: valibotResolver(schema),
    initialValues: {
      hostname: '',
    },
  });
  const activeCount = proxies.filter((proxy) => proxy.active).length;
  const inactiveCount = proxies.length - activeCount;

  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-8 px-4 py-6 md:px-6'>
      <header className='flex flex-col gap-5 border-b pb-6 md:flex-row md:items-end md:justify-between'>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <ShieldCheck className='size-4' />
            Proxy management
          </div>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Proxy workspace
          </h1>
          <p className='max-w-xl text-sm text-muted-foreground'>
            Add a proxy, check its reachability, and open its diagnostic tools.
          </p>
        </div>

        <div className='grid grid-cols-2 gap-2 sm:min-w-64'>
          <div className='rounded-lg border bg-card px-4 py-3'>
            <p className='text-xs text-muted-foreground'>Configured</p>
            <p className='mt-1 flex items-center gap-2 text-xl font-semibold'>
              <Server className='size-4 text-muted-foreground' />
              {proxies.length}
            </p>
          </div>
          <div className='rounded-lg border bg-card px-4 py-3'>
            <p className='text-xs text-muted-foreground'>Reachable</p>
            <p className='mt-1 flex items-center gap-2 text-xl font-semibold'>
              <Activity className='size-4 text-green-500' />
              {activeCount}
            </p>
          </div>
        </div>
      </header>

      <section aria-labelledby='add-proxy-title'>
        <Card className='relative overflow-hidden'>
          <div className='pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 overflow-hidden opacity-30 [mask-image:linear-gradient(to_left,black,transparent)] md:block'>
            <DotField
              width={700}
              height={280}
              density={14}
              darkAreas={7}
              maxDotSize={4}
              minDotSize={2}
              contrast={4}
              seed={132}
            />
          </div>
          <CardContent className='relative flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6'>
            <div className='flex items-start gap-3'>
              <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                <Plus className='size-5' />
              </span>
              <div className='flex flex-col gap-1'>
                <h2 id='add-proxy-title' className='font-semibold'>
                  Add a proxy
                </h2>
                <p className='max-w-lg text-sm text-muted-foreground'>
                  Enter a hostname or IP address to check whether it is reachable from this device.
                </p>
              </div>
            </div>

            <form
              onSubmit={form.onSubmit((values) => {
                addProxy(values.hostname);
              })}
              className='flex w-full flex-col gap-2 sm:flex-row md:max-w-lg'
            >
              <FormItem className='min-w-0 flex-1'>
                <FormLabel htmlFor='proxy-hostname'>Hostname or IP</FormLabel>
                <Input
                  id='proxy-hostname'
                  {...form.getInputProps('hostname')}
                  placeholder='e.g. proxy02 or 192.0.2.10'
                />
                {form.errors.hostname && (
                  <FormMessage>{form.errors.hostname}</FormMessage>
                )}
              </FormItem>
              <Button
                size='sm'
                type='submit'
                disabled={disable}
                className='sm:mt-7'
              >
                Add proxy
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className='flex flex-col gap-4' aria-labelledby='inventory-title'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <div className='flex items-center gap-2'>
              <h2 id='inventory-title' className='text-xl font-semibold'>
                Configured proxies
              </h2>
              <Badge variant='secondary'>{proxies.length}</Badge>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>
              Current reachability and diagnostic access for saved proxies.
            </p>
          </div>
          <Button
            variant='outline'
            onClick={reCheckProxies}
            disabled={disableReCheck}
            className='w-fit'
          >
            <RefreshCcw className={disableReCheck ? 'animate-spin' : ''} />
            Re-check proxies
          </Button>
        </div>

        {proxies.length > 0 ? (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {proxies.map((proxy) => (
              <ProxyCard
                key={
                  proxy.registered_address ||
                  proxy.primary_address ||
                  proxy.hostname
                }
                proxy={proxy}
                deleteProxy={deleteProxy}
              />
            ))}
          </div>
        ) : (
          <div className='flex min-h-52 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center'>
            <span className='flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground'>
              <Server className='size-5' />
            </span>
            <h3 className='mt-2 font-medium'>No proxies added yet</h3>
            <p className='max-w-sm text-sm text-muted-foreground'>
              Add a hostname or IP above. Reachability results and saved proxies will appear here.
            </p>
          </div>
        )}

        {proxies.length > 0 && (
          <p className='text-xs text-muted-foreground'>
            {inactiveCount} {inactiveCount === 1 ? 'proxy is' : 'proxies are'}
            {' '}currently marked unreachable.
          </p>
        )}
      </section>
    </main>
  );
}
