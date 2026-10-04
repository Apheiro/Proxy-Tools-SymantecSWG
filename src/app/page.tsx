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

export default function Page() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [disable, setDisable] = useState(false);
  const [disableReCheck, setDisableReCheck] = useState(false);

  useEffect(() => {
    setProxies(getLocalStorage('proxies') || []);
    if (getCredentials('one-time-credentials')) {
      deleteLocalStorage('one-time-credentials');
    }
  }, []);

  const reCheckProxies = () => {
    const blockOfPromises: Promise<Proxy>[] = [];
    setDisableReCheck(true);
    for (const proxy of proxies) {
      if (proxy.hostinfo.ip.split(' ').length === 1)
        blockOfPromises.push(
          invoke<Proxy>('getproxystatus', {
            hostname: proxy.hostinfo.ip,
          }),
        );
    }
    toast.promise<Proxy[]>(Promise.all(blockOfPromises), {
      loading: 'Updating proxies status...',
      success: (result: Proxy[]) => {
        postLocalStorage('proxies', result);
        setDisableReCheck(false);
        setProxies(result);
        return 'Proxies updated successfully.';
      },
      error: (e) => `Error checking proxies: ${e}`,
    });
  };

  const deleteProxy = (ip: string) => {
    postLocalStorage(
      'proxies',
      proxies.filter((p: Proxy) => p.hostinfo.ip !== ip),
    );
    setProxies(proxies.filter((p: Proxy) => p.hostinfo.ip !== ip));
  };
  const addProxy = (hostname: string) => {
    setDisable(true);
    if (
      some(
        proxies,
        (p: Proxy) =>
          p.hostinfo.ip === hostname || p.hostname === hostname,
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
        error: (e) => `Error adding proxy: ${e}`,
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
                key={proxy.hostinfo.ip}
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
