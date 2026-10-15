import { useForm } from '@mantine/form';
import { invoke } from '@tauri-apps/api/core';
import dayjs from 'dayjs';
import { AlertCircle, MoreHorizontal, Tags } from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import * as v from 'valibot';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipOne } from '@/components/ui/tooltip';
import useUrlResolver from '@/hook/useUrlResolver';
import { storeCredentials } from '@/lib/credentialStore';
import getCredentials from '@/lib/getCredentials';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { getLocalStorage } from '@/lib/utilsClient';
import { Button } from './ui/button';
import { Input } from './ui/input';
import ProxyTagsEditor from '@/components/proxyTagsEditor';
import { normalizeProxyTags } from '@/lib/proxyTags';

const credentialSchema = v.object({
  username: v.pipe(
    v.string(),
    v.nonEmpty('Please enter a username before proceeding.'),
  ),
  password: v.pipe(
    v.string(),
    v.nonEmpty('Please enter a password before proceeding.'),
    v.notLength(0, 'Please enter a password before proceeding.'),
  ),
});

function LoginRequiredDialog({
  open,
  setOpen,
  redirection,
  proxyIp,
  onCredentials,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  redirection: string;
  proxyIp: string;
  onCredentials?: (credentials: Credentials) => void;
}) {
  const router = useRouter();
  const url = useUrlResolver(redirection, {
    query: { proxy: proxyIp },
  });
  const usrId = useId();
  const pswId = useId();
  const form = useForm({
    validate: valibotResolver(credentialSchema),
    initialValues: {
      username: '',
      password: '',
    },
  });

  const saveCredentials = (cred: Credentials) => {
    void storeCredentials(cred, false)
      .then(() => {
        toast.success('Session credentials ready.');
        setOpen(false);
        if (onCredentials) onCredentials(cred);
        else router.push(url);
      })
      .catch((error) => toast.error(String(error)));
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className='max-w-70!'>
        <AlertDialogHeader>
          <AlertDialogTitle>Log in</AlertDialogTitle>
          <AlertDialogDescription>
            Credentials needed to request logs.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className='flex flex-col gap-5 '
          onSubmit={form.onSubmit((data) => {
            saveCredentials(data);
          })}
        >
          <div className='flex flex-col gap-2'>
            <Input
              label='Username'
              id={usrId}
              {...form.getInputProps('username')}
              placeholder='J.Doe'
            />
            <Input
              label='Password'
              id={pswId}
              {...form.getInputProps('password')}
              type='password'
              placeholder='Fd********'
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <Button type='submit' size='sm'>
              Continue
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LogDialog({
  pingLog,
  hostinfo,
  children,
  open,
  setOpen,
}: {
  pingLog: string;
  hostinfo: Hostinfo;
  children?: React.ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {children}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ping log</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className='max-h-[60dvh] space-y-4 overflow-y-auto text-left'>
              <dl className='space-y-2 text-sm'>
                <div>
                  <dt className='font-medium'>DNS name</dt>
                  <dd className='break-words'>
                    {hostinfo.dnsname || 'Not available'}
                  </dd>
                </div>
                <div>
                  <dt className='font-medium'>
                    Configured PTR DNS IPs
                  </dt>
                  <dd className='break-words'>
                    {hostinfo.dnsip || 'Not available'}
                  </dd>
                </div>
              </dl>
              <pre className='whitespace-pre-wrap break-words'>
                {pingLog}
              </pre>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DelAlert({
  open,
  setOpen,
  deleteProxy,
  proxy,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  deleteProxy: (proxy: Proxy) => void;
  proxy: Proxy;
}) {
  const [deleteProx, setDelete] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent
        onAnimationEnd={() => {
          if (deleteProx) deleteProxy(proxy);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Deleting proxy {proxy.hostname}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to proceed and delete this proxy?
            (You can re-add it later if needed)
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setDelete(true);
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Status({ status }: { status: boolean }) {
  return status ? (
    <>
      <div className='h-2 w-2 rounded-full bg-green-300' />
      Active
    </>
  ) : (
    <>
      <div className='h-2 w-2 rounded-full bg-red-300' />
      Inactive
    </>
  );
}

export default function ProxyCard({
  proxy,
  deleteProxy,
  availableTags,
  onTagsChange,
}: {
  proxy: Proxy;
  deleteProxy: (proxy: Proxy) => void;
  availableTags: string[];
  onTagsChange: (proxy: Proxy, tags: string[]) => void;
}) {
  const [openLog, setOpenLog] = useState(false);
  const [openTags, setOpenTags] = useState(false);
  const { mode, ready: modeReady } = useDataSourceMode();
  const [delAlert, setOpenAlert] = useState(false);
  const [openLogin, setOpenLogin] = useState(false);
  const [pendingProxyUrl, setPendingProxyUrl] = useState<
    string | null
  >(null);
  const proxyAddress =
    proxy.primary_address && proxy.primary_address !== 'unknown'
      ? proxy.primary_address
      : proxy.hostinfo.ip !== 'unknown' &&
          proxy.hostinfo.ip.split(/\s+/).filter(Boolean).length === 1
        ? proxy.hostinfo.ip
        : proxy.hostname;
  const isIpLiteral = (value: string) =>
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
  const hasHostname = [proxy.hostinfo?.hostname, proxy.hostname].some(
    (value) => {
      const name = value?.trim() ?? '';
      return (
        name !== '' &&
        !/^(?:unknown|unkown)$/i.test(name) &&
        !isIpLiteral(name)
      );
    },
  );
  const reverseHostnameUnavailable =
    isIpLiteral(proxyAddress) && !hasHostname;

  const openProxy = (url: string, credentials?: Credentials) => {
    const auth =
      credentials ||
      getLocalStorage<Credentials>('credentials') ||
      getLocalStorage<Credentials>('one-time-credentials');
    if (!auth) {
      setPendingProxyUrl(url);
      setOpenLogin(true);
      return;
    }

    invoke('open_proxy', {
      url,
      username: auth.username,
      password: auth.password,
    });
    setPendingProxyUrl(null);
  };

  return (
    <Card className='h-fit w-full min-w-0 gap-4 py-4'>
      <LogDialog
        open={openLog}
        setOpen={setOpenLog}
        pingLog={proxy.pinglog}
        hostinfo={proxy.hostinfo}
      />
      <DelAlert
        open={delAlert}
        setOpen={setOpenAlert}
        deleteProxy={deleteProxy}
        proxy={proxy}
      />
      <LoginRequiredDialog
        open={openLogin}
        setOpen={setOpenLogin}
        proxyIp={proxyAddress}
        redirection={'/Diagnostics'}
        onCredentials={(credentials) => {
          if (pendingProxyUrl)
            openProxy(pendingProxyUrl, credentials);
        }}
      />
      <CardHeader className='flex flex-row items-start justify-between gap-3 px-4'>
        <div className='min-w-0 space-y-2'>
          <CardTitle className='flex min-w-0 items-center gap-2 text-base leading-snug'>
            <span className='min-w-0 break-all'>
              {proxy.hostname}
            </span>
            {reverseHostnameUnavailable && (
              <TooltipOne
                classNameContent='max-w-72'
                content='The hostname could not be retrieved through reverse DNS lookup using a PTR record. The appliance remains identified by its IP address.'
              >
                <button
                  type='button'
                  aria-label='Hostname unavailable through reverse DNS (PTR) lookup'
                  className='inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400'
                >
                  <AlertCircle
                    className='size-4'
                    aria-hidden='true'
                  />
                </button>
              </TooltipOne>
            )}
          </CardTitle>
          <TooltipOne
            content={
              proxy.active
                ? 'ICMP Active'
                : 'ICMP disabled or computer unreachable'
            }
          >
            <Badge variant='outline'>
              <Status status={proxy.active} />
            </Badge>
          </TooltipOne>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='size-8 shrink-0'
              aria-label={`Proxy actions for ${proxy.hostname}`}
            >
              <MoreHorizontal className='size-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setOpenTags(true)}>
              <Tags className='size-4' />
              Edit tags
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setOpenAlert(true)}
              variant='destructive'
            >
              Delete
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOpenLog(true)}>
              Ping log
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                openProxy(
                  `https://${proxyAddress}:8082/Secure/Local/console/mc_vpm.html`,
                );
              }}
            >
              Open vpm (Early)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                openProxy(`https://${proxyAddress}:8082/`);
              }}
            >
              Open admin console (Early)
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link
                onNavigate={(e) => {
                  if (!modeReady) {
                    e.preventDefault();
                    return;
                  }
                  if (mode === 'live' && !getCredentials()) {
                    e.preventDefault();
                    setOpenLogin(true);
                  }
                }}
                href={{
                  pathname: '/Diagnostics',
                  query: { proxy: proxyAddress },
                }}
              >
                Diagnostic tools
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className='space-y-3 px-4'>
        <div className='rounded-lg bg-muted/50 px-3 py-2.5'>
          <p className='mb-1 text-xs text-muted-foreground'>
            IP address
          </p>
          <div className='font-mono text-sm'>
            {proxy.hostinfo.ip
              .split(/\s+/)
              .filter(Boolean)
              .map((ip) => (
                <span key={ip} className='block break-all'>
                  {ip}
                </span>
              ))}
          </div>
        </div>
        {proxy.hostinfo.ip.split(' ').length > 1 && (
          <TooltipOne
            content='There are multiple devices associated with this
                hostname. We recommend you delete this entry and
                generate a new one with the direct IP address.'
          >
            <Badge
              variant='destructive'
              className='max-w-full whitespace-normal'
            >
              <AlertCircle className='mr-2 h-4! w-5! stroke-3' />{' '}
              Multiple devices detected
            </Badge>
          </TooltipOne>
        )}

        {!!proxy.tags?.length && (
          <div className='flex flex-wrap gap-1.5'>
            {normalizeProxyTags(proxy.tags).map((tag) => (
              <Badge
                key={tag}
                variant='secondary'
                className='max-w-full whitespace-normal break-words'
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <ProxyTagsEditor
          tags={normalizeProxyTags(proxy.tags)}
          availableTags={availableTags}
          onChange={(tags) => onTagsChange(proxy, tags)}
          open={openTags}
          onOpenChange={setOpenTags}
        />

        <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground'>
          <span>Last checked</span>
          <time dateTime={proxy.last_check}>
            {dayjs(proxy.last_check).format('MM/DD/YYYY hh:mm:ss A')}
          </time>
        </div>
      </CardContent>
    </Card>
  );
}
