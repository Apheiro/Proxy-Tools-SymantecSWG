'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { initializeCredentials } from '@/lib/credentialStore';

export default function CredentialProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const initialize = () => {
    setError('');
    void initializeCredentials()
      .then(() => setReady(true))
      .catch(() =>
        setError(
          'Could not open secure credential storage. Retry to continue.',
        ),
      );
  };
  useEffect(initialize, []);
  if (!ready)
    return (
      <div className='flex min-h-dvh items-center justify-center gap-3 text-sm text-muted-foreground'>
        {error || 'Opening secure credential storage…'}
        {error && (
          <>
            <Button onClick={initialize}>Retry</Button>
            <Button variant='outline' onClick={() => setReady(true)}>
              Continue without saved credentials
            </Button>
          </>
        )}
      </div>
    );
  return children;
}
