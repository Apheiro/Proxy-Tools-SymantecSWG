/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
'use client';
import { useForm } from '@mantine/form';
import { cva } from 'class-variance-authority';
import { Settings } from 'lucide-react';
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
import useTheme from '@/hook/useTheme';
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
    setTheme(getLocalStorage('dark_mode') ? 'dark' : 'light');
    setDeleteCredOnClose(getLocalStorage('delete_on_close'));
  }, []);

  return (
    <Drawer direction='right' open={open} onOpenChange={setOpen}>
      <DrawerContent className='bg-transparent border-none p-3'>
        <div className='flex flex-col gap-4 h-full bg-[var(--background)] p-5 rounded-2xl'>
          <DrawerHeader className='p-0'>
            <DrawerTitle>Configuration</DrawerTitle>
            <DrawerDescription>
              Global app configuration.
            </DrawerDescription>
          </DrawerHeader>
          <div className='flex flex-col p-2 gap-5'>
            <form
              className='flex flex-col gap-5'
              onSubmit={form.onSubmit((data) => {
                saveCredentials(data);
              })}
            >
              <div>
                <h2>User credentials</h2>

                <p className='text-muted-foreground text-xs'>
                  {credentials
                    ? ' Your credentials are already saved. And will be used to get the trace data from the proxy, when you end your session we recommend you delete them.'
                    : '  Enter your username and password and save it to use it later without having to type it again.'}
                </p>
              </div>

              <div className='flex flex-col gap-2'>
                <FormLabel htmlFor={usrId}>Username</FormLabel>
                <Input
                  id={usrId}
                  {...form.getInputProps('username')}
                  placeholder='J.Doe'
                />
                <FormLabel htmlFor={pswId}>Password</FormLabel>
                <Input
                  id={pswId}
                  {...form.getInputProps('password')}
                  type='password'
                  placeholder='Fd********'
                />
              </div>
              <div className='flex self-end gap-2'>
                {credentials && (
                  <Button
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
                  {credentials ? 'Update' : 'Save'}
                </Button>
              </div>
            </form>

            <div className='flex items-center space-x-2'>
              <Switch
                id='d_mode'
                defaultChecked={theme === 'dark'}
                onCheckedChange={(checked) => {
                  console.log(theme, getLocalStorage('dark_mode'));
                  setTheme(checked ? 'dark' : 'light');
                  postLocalStorage('dark_mode', checked);
                }}
              />
              <Label htmlFor='d_mode'>Dark mode</Label>
            </div>

            <div className='flex items-center space-x-2'>
              <Switch
                id='delete_close'
                defaultChecked={deleteCredOnClose}
                onCheckedChange={(checked) => {
                  postLocalStorage('delete_on_close', checked);
                }}
              />
              <Label htmlFor='delete_close'>
                Delete credential on close
              </Label>
            </div>
          </div>

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
