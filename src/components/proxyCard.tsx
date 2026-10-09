import { useForm } from '@mantine/form';
import { invoke } from '@tauri-apps/api/core';
import dayjs from 'dayjs';
import { AlertCircle } from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useId, useState } from 'react';
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
import { getLocalStorage } from '@/lib/utilsClient';
import { Button } from './ui/button';
import { Input } from './ui/input';

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
  children,
  open,
  setOpen,
}: {
  pingLog: string;
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
            <pre className='whitespace-pre-wrap break-words'>
              {pingLog}
            </pre>
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
}: {
  proxy: Proxy;
  deleteProxy: (proxy: Proxy) => void;
}) {
  const [openLog, setOpenLog] = useState(false);
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
    <Card className='w-full h-fit'>
      <LogDialog
        open={openLog}
        setOpen={setOpenLog}
        pingLog={proxy.pinglog}
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
      <CardHeader className='flex flex-col'>
        {proxy.hostinfo.ip.split(' ').length > 1 && (
          <TooltipOne
            content='There are multiple devices associated with this
                hostname. We recommend you delete this entry and
                generate a new one with the direct IP address.'
          >
            <Badge variant='destructive' className='h-7 self-end'>
              <AlertCircle className='mr-2 h-4! w-5! stroke-3' />{' '}
              Multiple devices detected
            </Badge>
          </TooltipOne>
        )}
        <p className='text-xs text-muted-foreground self-end'>
          {dayjs(proxy.last_check).format('MM/DD/YYYY hh:mm:ss A')}
        </p>
        <CardTitle className='flex items-center gap-2'>
          <span>{proxy.hostname}</span>
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
                <AlertCircle className='size-4' aria-hidden='true' />
              </button>
            </TooltipOne>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <p className='text-muted-foreground'>
          IP:{' '}
          {proxy.hostinfo.ip
            .split(' ')
            .filter((ip) => ip.trim() !== '')
            .map((ip) => (
              <Fragment key={ip}>
                {ip.trim()} <br />
              </Fragment>
            ))}
        </p>
        <p className='text-muted-foreground'>
          Dns Name: {proxy.hostinfo.dnsname}
        </p>
        <p className='text-muted-foreground'>
          Dns IP: {proxy.hostinfo.dnsip}
        </p>
        <div className='flex justify-between items-end'>
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost'>...</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
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
                    const cred = getLocalStorage('credentials');
                    if (!cred) {
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
        </div>
      </CardContent>
    </Card>
  );
}
