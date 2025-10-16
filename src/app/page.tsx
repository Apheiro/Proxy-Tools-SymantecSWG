/** biome-ignore-all lint/style/useNamingConvention: <> */
/** biome-ignore-all lint/performance/noImgElement: <> */
'use client';
import { useForm } from '@mantine/form';
import { invoke } from '@tauri-apps/api/core';
import { cva } from 'class-variance-authority';
import { some } from 'lodash-es';
import { RefreshCcw } from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as v from 'valibot';
import ProxyCard from '@/components/proxyCard';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import useTheme from '@/hook/useTheme';
import { getLocalStorage, postLocalStorage } from '@/lib/utilsClient';

const logoStyle = cva(['w-[300px]', 'mt-[100px]', 'invert'], {
  variants: {
    theme: {
      light: 'invert-0',
      dark: 'invert',
    },
  },
});

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
  const { theme } = useTheme();
  useEffect(() => {
    setProxies(getLocalStorage('proxies') || []);
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
  return (
    <main className='flex justify-center items-center flex-col min-h-dvh w-dvw gap-4 p-5'>
      <img
        src='/Proxy logo.svg'
        className={logoStyle({
          theme: theme as 'light' | 'dark',
        })}
        alt='logo'
      />
      <Card>
        <CardHeader>
          <CardTitle>New proxy</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.onSubmit((values) => {
              addProxy(values.hostname);
            })}
            className='w-full space-y-6 flex flex-col '
          >
            <FormItem>
              <FormLabel>Proxy IP/Hostname</FormLabel>
              <Input
                {...form.getInputProps('hostname')}
                placeholder='e.g.: proxy02'
              />
              {form.errors.ip && (
                <FormMessage>{form.errors.ip}</FormMessage>
              )}
            </FormItem>
            <Button
              size='sm'
              type='submit'
              className='self-end'
              disabled={disable}
            >
              Add
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className='flex flex-col gap-4 w-full max-w-[1280px]'>
        <Button
          className='w-fit'
          onClick={() => reCheckProxies()}
          disabled={disableReCheck}
        >
          <RefreshCcw /> Re-check proxies
        </Button>
        <div className='grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] w-full gap-4'>
          {proxies?.map((proxy: Proxy) => (
            <ProxyCard
              key={proxy.hostinfo.ip}
              proxy={proxy}
              deleteProxy={deleteProxy}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
