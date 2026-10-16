'use client';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { DataSourceMode } from '@/lib/dataSourceMode';
import {
  defaultPolicySettings,
  getPolicySettings,
  MOCK_POLICY_PASSWORD,
  POLICY_SETTINGS_EVENT,
} from '@/lib/policyManager';
export default function PolicySettings({
  mode,
}: {
  mode: DataSourceMode;
}) {
  const [settings, setSettings] = useState(defaultPolicySettings);
  const [password, setPassword] = useState('');
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const id = useId();
  const mocked = mode === 'mock';
  useEffect(() => {
    let active = true;
    getPolicySettings(mocked)
      .then((s) => {
        if (active && s?.central) {
          setSettings(s);
          setLoaded(true);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mocked]);
  const central = settings.central;
  function change(key: keyof typeof central, value: string | number) {
    setSettings((s) => ({
      ...s,
      central: { ...s.central, [key]: value },
    }));
  }
  return (
    <section className='space-y-4 rounded-xl border p-4'>
      <div>
        <h2 className='text-sm font-semibold'>
          Local Policy Manager
        </h2>
        <p className='mt-1 text-xs text-muted-foreground'>
          Independent CPL sources. Central distribution remains
          external to this app.
        </p>
      </div>
      <label
        htmlFor={`${id}-direct`}
        className='flex items-center justify-between gap-3 text-sm'
      >
        Direct proxy editing & distribution
        <Switch
          id={`${id}-direct`}
          aria-label='Direct proxy editing and distribution'
          checked={settings.directEnabled}
          onCheckedChange={(directEnabled) =>
            setSettings((s) => ({ ...s, directEnabled }))
          }
        />
      </label>
      <label
        htmlFor={`${id}-central`}
        className='flex items-center justify-between gap-3 text-sm'
      >
        Central SSH file editing
        <Switch
          id={`${id}-central`}
          aria-label='Central SSH file editing'
          checked={settings.centralEnabled}
          onCheckedChange={(centralEnabled) =>
            setSettings((s) => ({ ...s, centralEnabled }))
          }
        />
      </label>
      <p className='text-xs text-muted-foreground'>
        Central editing is off by default. When enabled, it becomes
        the preferred workspace method; direct editing remains
        available if enabled.
      </p>
      <form
        className='space-y-3'
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await invoke('save_policy_settings', {
              mocked,
              settings,
              password:
                mocked || !password || central.transport === 'https'
                  ? null
                  : password,
              deletePassword: remove,
            });
            if (mocked) {
              if (remove)
                localStorage.removeItem(MOCK_POLICY_PASSWORD);
              else if (password)
                localStorage.setItem(MOCK_POLICY_PASSWORD, password);
            }
            setPassword('');
            setRemove(false);
            setSettings(await getPolicySettings(mocked));
            window.dispatchEvent(new Event(POLICY_SETTINGS_EVENT));
            toast.success('Policy settings saved.');
          } catch (error) {
            toast.error(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <label
            htmlFor={`${id}-transport`}
            className='space-y-1 text-xs'
          >
            Shared source access
            <SelectField
              id={`${id}-transport`}
              value={central.transport || 'ssh'}
              onValueChange={(v) => change('transport', v)}
            >
              <SelectOption value='ssh'>
                SSH · read and save
              </SelectOption>
              <SelectOption value='https'>
                HTTPS · read-only direct download
              </SelectOption>
            </SelectField>
          </label>
          <label
            htmlFor={`${id}-format`}
            className='space-y-1 text-xs'
          >
            File format
            <SelectField
              id={`${id}-format`}
              value={central.format || 'cpl'}
              onValueChange={(v) => change('format', v)}
            >
              <SelectOption value='cpl'>
                Plain CPL · existing workflow
              </SelectOption>
              <SelectOption value='project'>
                Shared JSON · Proxy Tools version 1
              </SelectOption>
            </SelectField>
          </label>
        </div>
        {central.transport === 'https' ? (
          <div className='space-y-2'>
            <Input
              id={`${id}-url`}
              label='Direct HTTPS file URL'
              value={central.url || ''}
              onChange={(e) => change('url', e.target.value)}
              placeholder='https://files.example.com/local-policy.json'
            />
            <p className='text-xs text-muted-foreground'>
              Direct file downloads only, with no login page. Export
              and upload the JSON through your hosting service to
              publish changes. Private SharePoint / Microsoft 365
              libraries require authenticated Microsoft Graph
              integration; pasting a page URL does not grant access.
              Remote HTTPS requests are disabled in Mocked Data.
            </p>
          </div>
        ) : (
          <>
            <div className='grid gap-3 sm:grid-cols-[1fr_6rem]'>
              <div>
                <label htmlFor={`${id}-host`} className='text-xs'>
                  SSH server
                </label>
                <Input
                  id={`${id}-host`}
                  value={central.host}
                  onChange={(e) => change('host', e.target.value)}
                  placeholder='policy.example.com'
                />
              </div>
              <div>
                <label htmlFor={`${id}-port`} className='text-xs'>
                  Port
                </label>
                <Input
                  id={`${id}-port`}
                  type='number'
                  min={1}
                  max={65535}
                  value={central.port}
                  onChange={(e) =>
                    change('port', Number(e.target.value))
                  }
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-path`} className='text-xs'>
                Absolute policy file path
              </label>
              <Input
                id={`${id}-path`}
                value={central.path}
                onChange={(e) => change('path', e.target.value)}
                placeholder='/srv/policies/local.cpl'
              />
            </div>
            <div>
              <label htmlFor={`${id}-shell`} className='text-xs'>
                Remote shell
              </label>
              <SelectField
                id={`${id}-shell`}
                value={central.shell}
                onValueChange={(v) => change('shell', v)}
              >
                <SelectOption value='posix'>POSIX (sh)</SelectOption>
                <SelectOption value='powershell'>
                  Windows PowerShell
                </SelectOption>
              </SelectField>
            </div>
            <div>
              <label htmlFor={`${id}-user`} className='text-xs'>
                Central SSH username
              </label>
              <Input
                id={`${id}-user`}
                autoComplete='off'
                value={central.username}
                onChange={(e) => change('username', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${id}-password`} className='text-xs'>
                Central SSH password
              </label>
              <Input
                id={`${id}-password`}
                type='password'
                autoComplete='new-password'
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setRemove(false);
                }}
                placeholder={
                  settings.hasPassword ||
                  (mocked &&
                    typeof window !== 'undefined' &&
                    localStorage.getItem(MOCK_POLICY_PASSWORD))
                    ? 'Saved — leave blank to keep'
                    : 'Not saved'
                }
              />
            </div>
            <p className='text-xs text-muted-foreground'>
              {mocked
                ? 'Mock password: separate localStorage entry. All SSH goes to 127.0.0.1:2222; remote file scripts use the actual SSH shell, not the appliance dummy.'
                : 'Central password: Windows Credential Manager, separate from appliance credentials.'}
            </p>
          </>
        )}
        <div className='flex items-center justify-between gap-2'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => {
              setRemove(true);
              setPassword('');
            }}
          >
            {remove
              ? 'Password will be removed'
              : 'Remove saved password'}
          </Button>
          <Button size='sm' disabled={busy || !loaded} type='submit'>
            {busy ? 'Saving…' : 'Save policy settings'}
          </Button>
        </div>
      </form>
    </section>
  );
}
