/** biome-ignore-all lint/style/useNamingConvention: <> */
/** biome-ignore-all lint/performance/noImgElement: <> */
'use client';
import { useForm } from '@mantine/form';
import { invoke } from '@tauri-apps/api/core';
import { some } from 'lodash-es';
import {
  Activity,
  RefreshCcw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import * as v from 'valibot';
import PageHeader from '@/components/pageHeader';
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
import { SelectField, SelectOption } from '@/components/ui/select';
import getCredentials from '@/lib/getCredentials';
import {
  getProxyPrimaryAddress,
  mergeProxyCheck,
  normalizeProxyIdentity,
} from '@/lib/proxyIdentity';
import {
  groupProxies,
  inventoryProxyId,
  inventoryTags,
  normalizeProxyTags,
  PROXY_GROUPING_KEY,
  type ProxyGrouping,
} from '@/lib/proxyTags';
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

export default function Page() {
  const addTitleId = useId();
  const hostnameId = useId();
  const inventoryTitleId = useId();
  const groupById = useId();
  const tagFilterId = useId();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [grouping, setGrouping] = useState<ProxyGrouping>({
    groupBy: 'none',
    tag: '',
  });
  const [disable, setDisable] = useState(false);
  const [disableReCheck, setDisableReCheck] = useState(false);

  useEffect(() => {
    const storedProxies: Proxy[] = getLocalStorage('proxies') || [];
    const savedGrouping = getLocalStorage<ProxyGrouping>(
      PROXY_GROUPING_KEY,
    );
    if (savedGrouping?.groupBy === 'tags') {
      const tag =
        typeof savedGrouping.tag === 'string'
          ? savedGrouping.tag
          : '';
      const validTag = groupProxies(storedProxies, {
        groupBy: 'tags',
        tag: '',
      }).some((group) => group.key === tag);
      setGrouping({ groupBy: 'tags', tag: validTag ? tag : '' });
    }
    const normalizedProxies = storedProxies.map(
      normalizeProxyIdentity,
    );
    setProxies(normalizedProxies);
    if (
      normalizedProxies.some(
        (proxy, index) =>
          proxy.primary_address !==
            storedProxies[index]?.primary_address ||
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
        if (
          proxy.hostinfo.ip.split(/\s+/).filter(Boolean).length > 1
        ) {
          return proxy;
        }
        const address = getProxyPrimaryAddress(proxy);
        if (!address) return proxy;

        const check = await invoke<Proxy>('getproxystatus', {
          hostname: address,
        });
        return check;
      }),
    )
      .then((result) => {
        setProxies((current) => {
          const updated = current.map((proxy) => {
            const index = proxies.findIndex(
              (saved) =>
                inventoryProxyId(saved) === inventoryProxyId(proxy),
            );
            return index < 0
              ? proxy
              : mergeProxyCheck(proxy, result[index]);
          });
          postLocalStorage('proxies', updated);
          return updated;
        });
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
    setProxies((current) => {
      const updated = current.filter(
        (proxy) =>
          inventoryProxyId(proxy) !== inventoryProxyId(proxyToDelete),
      );
      postLocalStorage('proxies', updated);
      return updated;
    });
  };
  const updateTags = (target: Proxy, tags: string[]) => {
    setProxies((current) => {
      const updated = current.map((proxy) =>
        inventoryProxyId(proxy) === inventoryProxyId(target)
          ? { ...proxy, tags: normalizeProxyTags(tags) }
          : proxy,
      );
      postLocalStorage('proxies', updated);
      return updated;
    });
  };
  const updateIsgAppliance = (
    target: Proxy,
    appliance?: IsgAppliance,
  ) => {
    setProxies((current) => {
      const updated = current.map((proxy) =>
        inventoryProxyId(proxy) === inventoryProxyId(target)
          ? { ...proxy, isg_appliance: appliance }
          : proxy,
      );
      postLocalStorage('proxies', updated);
      return updated;
    });
  };
  const changeGrouping = (next: ProxyGrouping) => {
    setGrouping(next);
    postLocalStorage(PROXY_GROUPING_KEY, next);
  };
  const allTags = inventoryTags(proxies);
  const allGroups = groupProxies(proxies, {
    groupBy: 'tags',
    tag: '',
  });
  const activeGrouping = {
    ...grouping,
    tag: allGroups.some((group) => group.key === grouping.tag)
      ? grouping.tag
      : '',
  };
  const proxyGroups = groupProxies(proxies, activeGrouping);
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
          setProxies((current) => {
            const updated = [...current, result];
            postLocalStorage('proxies', updated);
            return updated;
          });
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
    <main className='flex min-w-0 flex-col gap-8'>
      <PageHeader
        icon={ShieldCheck}
        eyebrow='Proxy management'
        title='Proxy workspace'
        description='Add a proxy, check its reachability, and open its diagnostic tools.'
        actions={
          <div className='grid grid-cols-2 gap-2 sm:min-w-64'>
            <div className='rounded-lg border bg-card px-4 py-3'>
              <p className='text-xs text-muted-foreground'>
                Configured
              </p>
              <p className='mt-1 flex items-center gap-2 text-xl font-semibold'>
                <Server className='size-4 text-muted-foreground' />
                {proxies.length}
              </p>
            </div>
            <div className='rounded-lg border bg-card px-4 py-3'>
              <p className='text-xs text-muted-foreground'>
                Reachable
              </p>
              <p className='mt-1 flex items-center gap-2 text-xl font-semibold'>
                <Activity className='size-4 text-green-500' />
                {activeCount}
              </p>
            </div>
          </div>
        }
      />

      <section aria-labelledby={addTitleId}>
        <Card>
          <CardContent className='flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6'>
            <div className='min-w-0 md:max-w-md'>
              <div className='flex flex-col gap-1'>
                <h2 id={addTitleId} className='text-lg font-semibold'>
                  Add a proxy
                </h2>
                <p className='max-w-lg text-sm text-muted-foreground'>
                  Register an appliance by hostname or IP. Its
                  reachability will be checked automatically.
                </p>
              </div>
            </div>

            <form
              onSubmit={form.onSubmit((values) => {
                addProxy(values.hostname);
              })}
              className='flex w-full flex-col gap-3 sm:flex-row sm:items-start md:max-w-lg'
            >
              <FormItem className='min-w-0 flex-1'>
                <FormLabel htmlFor={hostnameId}>
                  Hostname or IP
                </FormLabel>
                <Input
                  id={hostnameId}
                  {...form.getInputProps('hostname')}
                  placeholder='e.g. proxy02 or 192.0.2.10'
                />
                {form.errors.hostname && (
                  <FormMessage>{form.errors.hostname}</FormMessage>
                )}
              </FormItem>
              <Button
                type='submit'
                disabled={disable}
                className='shrink-0 self-end'
              >
                Add proxy
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section
        className='flex flex-col gap-4'
        aria-labelledby={inventoryTitleId}
      >
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <div className='flex items-center gap-2'>
              <h2
                id={inventoryTitleId}
                className='text-xl font-semibold'
              >
                Configured proxies
              </h2>
              <Badge variant='secondary'>{proxies.length}</Badge>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>
              Current reachability and diagnostic access for saved
              proxies.
            </p>
          </div>
          <Button
            variant='outline'
            onClick={reCheckProxies}
            disabled={disableReCheck}
            className='w-fit'
          >
            <RefreshCcw
              className={disableReCheck ? 'animate-spin' : ''}
            />
            Re-check proxies
          </Button>
        </div>

        {proxies.length > 0 && (
          <div className='flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3'>
            <div className='flex min-w-40 flex-col gap-1.5'>
              <label
                htmlFor={groupById}
                className='text-xs font-medium text-muted-foreground'
              >
                Group by
              </label>
              <SelectField
                id={groupById}
                value={grouping.groupBy}
                onValueChange={(value) =>
                  changeGrouping({
                    groupBy: value === 'tags' ? 'tags' : 'none',
                    tag: '',
                  })
                }
              >
                <SelectOption value='none'>No grouping</SelectOption>
                <SelectOption value='tags'>Tags</SelectOption>
              </SelectField>
            </div>
            {grouping.groupBy === 'tags' && (
              <div className='flex min-w-40 flex-col gap-1.5'>
                <label
                  htmlFor={tagFilterId}
                  className='text-xs font-medium text-muted-foreground'
                >
                  Show tag
                </label>
                <SelectField
                  id={tagFilterId}
                  value={activeGrouping.tag}
                  onValueChange={(tag) =>
                    changeGrouping({ groupBy: 'tags', tag })
                  }
                >
                  <SelectOption value=''>All tags</SelectOption>
                  {allGroups.map((group) => (
                    <SelectOption key={group.key} value={group.key}>
                      {group.label}
                    </SelectOption>
                  ))}
                </SelectField>
              </div>
            )}
            <p className='text-xs text-muted-foreground'>
              Tags and grouping are saved on this device.
              {grouping.groupBy === 'tags' &&
                ' Proxies with multiple tags appear in each matching group.'}
            </p>
          </div>
        )}

        {proxies.length > 0 ? (
          <div className='flex flex-col gap-6'>
            {proxyGroups.map((group) => (
              <section
                key={group.key}
                aria-label={group.label || 'All proxies'}
                className='space-y-3'
              >
                {grouping.groupBy === 'tags' && (
                  <div className='flex min-w-0 items-center gap-2 border-b pb-2'>
                    <h3 className='min-w-0 break-words font-semibold'>
                      {group.label}
                    </h3>
                    <Badge variant='secondary'>
                      {group.proxies.length}
                    </Badge>
                  </div>
                )}
                <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                  {group.proxies.map((proxy) => (
                    <ProxyCard
                      key={inventoryProxyId(proxy)}
                      proxy={proxy}
                      deleteProxy={deleteProxy}
                      availableTags={allTags}
                      onTagsChange={updateTags}
                      onIsgChange={updateIsgAppliance}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className='flex min-h-52 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center'>
            <span className='flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground'>
              <Server className='size-5' />
            </span>
            <h3 className='mt-2 font-medium'>No proxies added yet</h3>
            <p className='max-w-sm text-sm text-muted-foreground'>
              Add a hostname or IP above. Reachability results and
              saved proxies will appear here.
            </p>
          </div>
        )}

        {proxies.length > 0 && (
          <p className='text-xs text-muted-foreground'>
            {inactiveCount}{' '}
            {inactiveCount === 1 ? 'proxy is' : 'proxies are'}{' '}
            currently marked unreachable.
          </p>
        )}
      </section>
    </main>
  );
}
