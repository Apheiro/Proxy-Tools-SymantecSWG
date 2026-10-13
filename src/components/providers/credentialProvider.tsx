'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  initializeCredentials,
  MOCK_CREDENTIALS_KEY,
} from '@/lib/credentialStore';
import {
  DATA_SOURCE_EVENT,
  DATA_SOURCE_KEY,
} from '@/lib/dataSourceMode';

export default function CredentialProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const readyRef = useRef(false);
  const initialize = (event?: Event) => {
    if (
      event instanceof StorageEvent &&
      event.key !== null &&
      event.key !== DATA_SOURCE_KEY &&
      event.key !== MOCK_CREDENTIALS_KEY
    )
      return;
    setError('');
    void initializeCredentials()
      .then(() => {
        readyRef.current = true;
        setReady(true);
      })
      .catch(() => {
        const message =
          'Could not load credentials for the active data mode. Retry or review storage in Settings.';
        setError(message);
        if (readyRef.current) toast.error(message);
      });
  };
  useEffect(() => {
    initialize();
    window.addEventListener(DATA_SOURCE_EVENT, initialize);
    window.addEventListener('storage', initialize);
    return () => {
      window.removeEventListener(DATA_SOURCE_EVENT, initialize);
      window.removeEventListener('storage', initialize);
    };
  }, []);
  if (!ready)
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center gap-3 text-sm text-muted-foreground'>
        {error || 'Loading saved credentials…'}
        {error && (
          <>
            <Button onClick={() => initialize()}>Retry</Button>
            <Button
              variant='outline'
              onClick={() => {
                readyRef.current = true;
                setReady(true);
              }}
            >
              Continue without saved credentials
            </Button>
          </>
        )}
      </div>
    );
  return children;
}
