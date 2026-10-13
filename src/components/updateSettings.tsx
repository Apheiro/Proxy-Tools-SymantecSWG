'use client';

import { Download } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DataSourceMode } from '@/lib/dataSourceMode';
import {
  deleteUpdateToken,
  hasUpdateToken,
  MOCK_UPDATE_TOKEN_KEY,
  saveUpdateToken,
  UPDATE_CHECK_EVENT,
  UPDATE_TOKEN_EVENT,
} from '@/lib/appUpdates';

export default function UpdateSettings({
  mode,
}: {
  mode: DataSourceMode;
}) {
  const id = useId();
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setToken('');
    setSaved(false);
    setLoading(true);
    const read = () => {
      void hasUpdateToken(mode)
        .then((value) => {
          if (!cancelled) setSaved(value);
        })
        .catch(() => {
          if (!cancelled)
            toast.error('Could not read GitHub token storage.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    const storage = (event: StorageEvent) => {
      if (event.key === MOCK_UPDATE_TOKEN_KEY || event.key === null)
        read();
    };
    read();
    window.addEventListener(UPDATE_TOKEN_EVENT, read);
    window.addEventListener('storage', storage);
    return () => {
      cancelled = true;
      window.removeEventListener(UPDATE_TOKEN_EVENT, read);
      window.removeEventListener('storage', storage);
    };
  }, [mode]);
  async function mutate(remove: boolean) {
    setBusy(true);
    try {
      if (remove) await deleteUpdateToken(mode);
      else await saveUpdateToken(mode, token);
      setToken('');
      toast.success(
        remove
          ? 'GitHub token removed. Future checks use public access.'
          : 'GitHub token saved.',
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className='rounded-xl border p-4'
      aria-label='Application updates'
    >
      <div className='mb-4 flex items-start gap-3'>
        <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
          <Download className='size-4' />
        </span>
        <div>
          <h2 className='text-sm font-semibold'>
            Application updates
          </h2>
          <p className='mt-1 text-xs text-muted-foreground'>
            Download new versions from GitHub and replace the
            executable manually.
          </p>
        </div>
      </div>
      <p className='mb-3 text-xs text-muted-foreground'>
        {mode === 'mock'
          ? 'Mock GitHub tokens are saved in localStorage for development on this device.'
          : 'GitHub tokens are protected by Windows Credential Manager, separately from proxy credentials.'}{' '}
        Without a token, checks use public access. Private releases
        require Contents: Read.
      </p>
      <form
        className='flex flex-col gap-3'
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(false);
        }}
      >
        <Label htmlFor={id}>GitHub token (optional)</Label>
        <Input
          id={id}
          type='password'
          autoComplete='off'
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={busy || loading}
          placeholder={
            saved
              ? 'Token saved — enter a replacement'
              : 'Fine-grained personal access token'
          }
        />
        <p className='text-xs text-muted-foreground' role='status'>
          {loading
            ? 'Reading token storage…'
            : saved
              ? 'A token is saved for this profile.'
              : 'No token saved for this profile.'}
        </p>
        <div className='flex flex-wrap justify-end gap-2'>
          {saved && (
            <Button
              size='sm'
              variant='destructive'
              type='button'
              disabled={busy || loading}
              onClick={() => void mutate(true)}
            >
              Remove token
            </Button>
          )}
          <Button
            size='sm'
            type='submit'
            disabled={busy || loading || !token.trim()}
          >
            {saved ? 'Update token' : 'Save token'}
          </Button>
        </div>
      </form>
      <Button
        className='mt-4 w-full'
        size='sm'
        variant='outline'
        disabled={busy || loading}
        onClick={() =>
          window.dispatchEvent(new Event(UPDATE_CHECK_EVENT))
        }
      >
        Check for updates
      </Button>
    </section>
  );
}
