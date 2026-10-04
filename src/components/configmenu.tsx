/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
'use client';
import { useForm } from '@mantine/form';
import { cva } from 'class-variance-authority';
import {
  Check,
  Database,
  KeyRound,
  Moon,
  Settings,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import * as v from 'valibot';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import useTheme from '@/hook/useTheme';
import useDataSourceMode from '@/lib/useDataSourceMode';
import {
  deleteLocalStorage,
  getLocalStorage,
  postLocalStorage,
} from '@/lib/utilsClient';

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

function CredentialsDialog({
  open,
  setOpen,
  credentials,
  saveCredentials,
  deleteCredentials,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
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
    <Drawer direction='right' open={open} onOpenChange={setOpen}>
      <DrawerContent className='border-none bg-transparent p-3'>
        <div className='flex h-full flex-col gap-5 rounded-2xl bg-[var(--background)] p-5'>
          <DrawerHeader className='p-0'>
            <div className='mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary'>
              <Settings className='size-5' />
            </div>
            <DrawerTitle className='text-xl'>Settings</DrawerTitle>
            <DrawerDescription>
              Manage your connection, credentials, and appearance.
            </DrawerDescription>
          </DrawerHeader>
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col gap-4 pr-3'>
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
                    <p className='text-sm font-medium'>
                      Use live proxy data
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {mode === 'live'
                        ? 'HTTPS certificate checks are enabled.'
                        : 'Switch on to contact the configured proxy.'}
                    </p>
                  </div>
                  <Switch
                    id='data-source-mode'
                    checked={mode === 'live'}
                    onCheckedChange={(checked) =>
                      setMode(checked ? 'live' : 'mock')
                    }
                    aria-label='Use live proxy data'
                  />
                </div>
                <div className='mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground'>
                  <ShieldCheck className='mt-0.5 size-3.5 shrink-0' />
                  Live requests use the selected proxy and saved
                  credentials. Private or self-signed certificates may
                  require CA support before connecting.
                </div>
              </section>

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
                    Credentials are stored in this app and sent only
                    with proxy requests.
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
                        className='self-end bg-red-500/90 border-red-500/50 border-1'
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
                      <Label
                        htmlFor='delete_close'
                        className='text-sm'
                      >
                        Clear temporary credentials on exit
                      </Label>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Remove one-time credentials when the app
                        closes.
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
          </ScrollArea>

          <DrawerFooter>
            <DrawerClose asChild>
              <Button size='sm'>close</Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

const configMenuBtnStyles = cva([
  'h-7',
  'w-7',
  'text-muted-foreground',
  'hover:text-foreground',
]);

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
  const saveCredentials = (cred: Credentials) => {
    postLocalStorage('credentials', cred);
    setCredentials(cred);
    toast.success('Credentials saved successfully.');
  };

  const deleteCredentials = () => {
    deleteLocalStorage('credentials');
    setCredentials(null);
  };

  useEffect(() => {
    setCredentials(getLocalStorage('credentials') || null);
  }, []);

  return (
    <>
      <Button
        variant='ghost'
        size='icon'
        className={configMenuBtnStyles({ className })}
        onClick={() => {
          setOpenCredentialsForm(true);
        }}
      >
        <Settings className='h-4! w-4! ' />
      </Button>
      <CredentialsDialog
        open={openCredentialsForm}
        setOpen={setOpenCredentialsForm}
        credentials={credentials}
        saveCredentials={saveCredentials}
        deleteCredentials={deleteCredentials}
      />
    </>
  );
}
