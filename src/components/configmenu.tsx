/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
'use client';
import { useForm } from '@mantine/form';
import { cva } from '@/lib/cva';
import {
  Check,
  Database,
  KeyRound,
  Moon,
  Settings,
  ShieldCheck,
  Wifi,
  X,
} from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import * as v from 'valibot';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import useTheme from '@/hook/useTheme';
import {
  removeCredentials,
  storeCredentials,
  useCredentialRevision,
} from '@/lib/credentialStore';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { getLocalStorage, postLocalStorage } from '@/lib/utilsClient';
import UpdateSettings from '@/components/updateSettings';

const credentialSchema = v.object({
  username: v.pipe(
    v.string(),
    v.nonEmpty('Please enter a username before proceeding.'),
  ),
  password: v.pipe(
    v.string(),
    v.nonEmpty('Please enter a password before proceeding.'),
  ),
});

function SettingsDialog({
  credentials,
  saveCredentials,
  deleteCredentials,
}: {
  credentials: Credentials | null;
  saveCredentials: (credentials: Credentials) => void;
  deleteCredentials: () => void;
}) {
  const { setTheme, theme } = useTheme();
  const { mode, setMode } = useDataSourceMode();
  const [deleteCredOnClose, setDeleteCredOnClose] = useState(false);
  const form = useForm({
    validate: valibotResolver(credentialSchema),
    initialValues: {
      username: credentials?.username ?? '',
      password: credentials?.password ?? '',
    },
  });

  const usrId = useId();
  const pswId = useId();

  useEffect(() => {
    form.setValues({
      username: credentials?.username ?? '',
      password: credentials?.password ?? '',
    });
    setTheme(getLocalStorage('dark_mode') ? 'dark' : 'light');
    setDeleteCredOnClose(getLocalStorage('delete_on_close'));
  }, [credentials]);

  return (
    <DialogContent className='flex h-[85dvh] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl'>
      <DialogHeader className='relative shrink-0 border-b px-6 py-5 text-left'>
        <div className='flex items-center gap-3 pr-9'>
          <span className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'>
            <Settings className='size-5' />
          </span>
          <div className='min-w-0'>
            <DialogTitle className='text-xl'>Settings</DialogTitle>
            <DialogDescription className='mt-1'>
              Manage connections, credentials, updates, and
              appearance.
            </DialogDescription>
          </div>
        </div>
        <DialogClose asChild>
          <Button
            variant='ghost'
            size='icon'
            className='absolute right-4 top-4'
            aria-label='Close settings'
          >
            <X className='size-4' />
          </Button>
        </DialogClose>
      </DialogHeader>
      <ScrollArea
        className='min-h-0 flex-1'
        role='region'
        aria-label='Settings preferences'
      >
        <div className='grid gap-5 p-4 sm:p-6 md:grid-cols-2'>
          <div className='min-w-0 space-y-5'>
            <section className='rounded-xl border bg-muted/20 p-4'>
              <div className='mb-4 flex items-start gap-3'>
                <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground'>
                  {mode === 'mock' ? (
                    <Database className='size-4' />
                  ) : (
                    <Wifi className='size-4' />
                  )}
                </span>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold'>
                      Data source
                    </h2>
                    <span className='rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                      {mode === 'mock' ? 'Mock' : 'Live'}
                    </span>
                  </div>
                  <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
                    {mode === 'mock'
                      ? 'Use the local sample server for offline development.'
                      : 'Connect to the selected ProxySG over HTTPS.'}
                  </p>
                </div>
              </div>
              <div className='flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2.5'>
                <div>
                  <p className='text-sm font-medium'>Mocked data</p>
                  <p className='text-xs text-muted-foreground'>
                    {mode === 'mock'
                      ? 'Use sample data for offline development.'
                      : 'Live proxy data is used by default.'}
                  </p>
                </div>
                <Switch
                  id='data-source-mode'
                  checked={mode === 'mock'}
                  onCheckedChange={(checked) =>
                    setMode(checked ? 'mock' : 'live')
                  }
                  aria-label='Mocked data'
                />
              </div>
              <div className='mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground'>
                <ShieldCheck className='mt-0.5 size-3.5 shrink-0' />
                Live requests use the selected proxy and saved
                credentials. Rust accepts untrusted management
                certificates in the current environment.
              </div>
            </section>
            <section className='rounded-xl border p-4'>
              <div className='mb-3 flex items-center gap-3'>
                <span className='flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
                  <Moon className='size-4' />
                </span>
                <div>
                  <h2 className='text-sm font-semibold'>
                    Appearance & privacy
                  </h2>
                  <p className='text-xs text-muted-foreground'>
                    Personalize this device.
                  </p>
                </div>
              </div>
              <div className='flex flex-col divide-y'>
                <div className='flex items-center justify-between gap-3 py-3'>
                  <Label htmlFor='d_mode' className='text-sm'>
                    Dark mode
                  </Label>
                  <Switch
                    id='d_mode'
                    checked={theme === 'dark'}
                    onCheckedChange={(checked) => {
                      setTheme(checked ? 'dark' : 'light');
                      postLocalStorage('dark_mode', checked);
                    }}
                  />
                </div>
                <div className='flex items-center justify-between gap-3 py-3'>
                  <div>
                    <Label htmlFor='delete_close' className='text-sm'>
                      Clear temporary credentials on exit
                    </Label>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Remove one-time credentials when the app closes.
                    </p>
                  </div>
                  <Switch
                    id='delete_close'
                    checked={deleteCredOnClose}
                    onCheckedChange={(checked) => {
                      setDeleteCredOnClose(checked);
                      postLocalStorage('delete_on_close', checked);
                    }}
                  />
                </div>
              </div>
            </section>
          </div>
          <div className='min-w-0 space-y-5'>
            <section className='rounded-xl border p-4'>
              <div className='mb-4 flex items-start gap-3'>
                <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                  <KeyRound className='size-4' />
                </span>
                <div>
                  <h2 className='text-sm font-semibold'>
                    Proxy credentials
                  </h2>
                  <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
                    {credentials
                      ? 'Saved credentials are used for proxy requests.'
                      : 'Save credentials to authenticate with your proxy.'}
                  </p>
                </div>
              </div>
              <form
                className='flex flex-col gap-4'
                onSubmit={form.onSubmit((data) => {
                  saveCredentials(data);
                })}
              >
                <p className='text-xs text-muted-foreground'>
                  {mode === 'mock'
                    ? 'Mock credentials are saved in localStorage on this device. Local SSH backups use them.'
                    : 'Saved credentials are protected by Windows Credential Manager. Mock HTTP requests never include them.'}
                </p>

                <div className='flex flex-col gap-2'>
                  <FormLabel htmlFor={usrId}>Username</FormLabel>
                  <Input
                    id={usrId}
                    {...form.getInputProps('username')}
                    placeholder='Username'
                  />
                  <FormLabel htmlFor={pswId}>Password</FormLabel>
                  <Input
                    id={pswId}
                    {...form.getInputProps('password')}
                    type='password'
                    placeholder='Password'
                  />
                </div>
                <div className='flex self-end gap-2'>
                  {credentials && (
                    <Button
                      type='button'
                      size='sm'
                      variant='destructive'
                      onClick={() => {
                        deleteCredentials();
                        form.reset();
                      }}
                    >
                      Delete
                    </Button>
                  )}

                  <Button type='submit' size='sm'>
                    {credentials && <Check className='size-4' />}
                    {credentials ? 'Update' : 'Save'}
                  </Button>
                </div>
              </form>
            </section>
            <UpdateSettings key={mode} mode={mode} />
          </div>
        </div>
      </ScrollArea>
      <DialogFooter className='shrink-0 flex-col border-t bg-muted/20 px-6 py-4 sm:items-center sm:justify-between'>
        <p className='text-xs text-muted-foreground'>
          Changes are saved per section.
        </p>
        <DialogClose asChild>
          <Button size='sm'>Done</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

const configMenuBtnStyles = cva({
  base: [
    'h-7',
    'w-7',
    'text-muted-foreground',
    'hover:text-foreground',
  ],
});

export default function ConfigMenu({
  className,
}: {
  className?: string;
}) {
  const [openCredentialsForm, setOpenCredentialsForm] =
    useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(
    null,
  );
  const revision = useCredentialRevision();
  const saveCredentials = (cred: Credentials) => {
    void storeCredentials(cred)
      .then(() => {
        toast.success('Credentials saved.');
      })
      .catch((error) => toast.error(String(error)));
  };

  const deleteCredentials = () => {
    void removeCredentials('credentials').catch((error) =>
      toast.error(String(error)),
    );
  };

  useEffect(() => {
    setCredentials(getLocalStorage('credentials') || null);
  }, [revision]);

  return (
    <Dialog
      open={openCredentialsForm}
      onOpenChange={setOpenCredentialsForm}
    >
      <DialogTrigger asChild>
        <Button
          variant='ghost'
          aria-label='Open settings'
          size='icon'
          className={configMenuBtnStyles({ className })}
        >
          <Settings className='h-4! w-4! ' />
        </Button>
      </DialogTrigger>
      <SettingsDialog
        credentials={credentials}
        saveCredentials={saveCredentials}
        deleteCredentials={deleteCredentials}
      />
    </Dialog>
  );
}
