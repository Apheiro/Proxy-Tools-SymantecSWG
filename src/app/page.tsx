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
import DotField from '@/components/dots';
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
import getCredentials from '@/lib/getCredentials';
import {
  deleteLocalStorage,
  getLocalStorage,
  postLocalStorage,
} from '@/lib/utilsClient';

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
  return (
    <main className='flex flex-col min-h-dvh w-dvw items-center gap-10 p-5'>
      <Card className='w-full overflow-hidden max-w-250 min-w-100 h-55'>
        <CardContent className='relative flex flex-col items-end  h-full '>
          <div className='self-start bold  backdrop-blur-[1px] rounded-md bg-[var(--card)]/50 relative z-10 p-4'>
            <h5 className='font-bold text-2xl'>Proxy Log Tool</h5>
            <p className='max-w-100 overflow-ellipsis'>
              Add a new proxy and check if is reachable from your
              network device to start using the logging UI tool
            </p>
          </div>
          <div className='absolute flex justify-center items-start flex-col left-[-5] top-[-30] w-full [mask-image:radial-gradient(circle_1000px_at_15%_-80%,black_30%,transparent_70%)]'>
            <DotField
              width={1000}
              height={500}
              density={14}
              darkAreas={7}
              maxDotSize={4}
              minDotSize={2}
              contrast={4}
              seed={132}
            />
          </div>
          <form
            onSubmit={form.onSubmit((values) => {
              addProxy(values.hostname);
            })}
            className='max-w-70 gap-5 flex items-center mt-auto relative z-10 backdrop-blur-[1px] rounded-md bg-[var(--card)]/50 p-2'
          >
            <FormItem>
              <Input
                {...form.getInputProps('hostname')}
                placeholder='e.g.: proxy02'
              />
              {form.errors.ip && (
                <FormMessage>{form.errors.ip}</FormMessage>
              )}
            </FormItem>
            <Button size='sm' type='submit' disabled={disable}>
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
