'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export default function ProxyIsgDialog({
  open,
  onOpenChange,
  appliance,
  proxyName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appliance?: IsgAppliance;
  proxyName: string;
  onSave: (appliance?: IsgAppliance) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(appliance?.name ?? '');
    setAddress(appliance?.address ?? '');
    setUrl(appliance?.url ?? '');
    setError('');
  }, [open, appliance?.name, appliance?.address, appliance?.url]);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const host = address.trim().replace(/^\[|\]$/g, '');
      if (!host || /[\s/@\\?#]/.test(host))
        throw new Error(
          'Enter the ISG hostname or IP address without a URL or port.',
        );
      const parsed = new URL(
        `ssh://${host.includes(':') ? `[${host}]` : host}`,
      );
      if (
        !parsed.hostname ||
        parsed.port ||
        parsed.username ||
        parsed.password
      )
        throw new Error('Enter a valid ISG hostname or IP address.');
      let managementUrl: string | undefined;
      if (url.trim()) {
        const location = new URL(url.trim());
        if (
          !['http:', 'https:'].includes(location.protocol) ||
          !location.hostname ||
          location.username ||
          location.password
        )
          throw new Error(
            'Enter an HTTP or HTTPS management URL without embedded credentials.',
          );
        managementUrl = location.href;
      }
      onSave({
        name: name.trim() || host,
        address: host,
        url: managementUrl,
      });
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof TypeError
          ? 'Check the ISG address and use a full http:// or https:// URL if a management link is provided.'
          : String(reason instanceof Error ? reason.message : reason),
      );
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {appliance
              ? 'Edit ISG appliance'
              : 'Assign ISG appliance'}
          </DialogTitle>
          <DialogDescription>
            Associate the Symantec ISG host with {proxyName}. Multiple
            proxies can share the same appliance.
          </DialogDescription>
        </DialogHeader>
        <form className='space-y-4' onSubmit={save}>
          <div className='space-y-2'>
            <label
              htmlFor={`${id}-name`}
              className='text-sm font-medium'
            >
              Appliance name{' '}
              <span className='font-normal text-muted-foreground'>
                (optional)
              </span>
            </label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='ISG host name'
            />
          </div>
          <div className='space-y-2'>
            <label
              htmlFor={`${id}-address`}
              className='text-sm font-medium'
            >
              ISG hostname / IP address
            </label>
            <Input
              id={`${id}-address`}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder='isg-host or 192.0.2.10'
              required
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            <p className='text-xs text-muted-foreground'>
              SSH connects to the ISG host on port 22 and asks for its
              own credentials.
            </p>
          </div>
          <div className='space-y-2'>
            <label
              htmlFor={`${id}-url`}
              className='text-sm font-medium'
            >
              ISGAC / management URL (optional)
            </label>
            <Input
              id={`${id}-url`}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder='https://isg-host:port/'
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
            />
            <p
              id={`${id}-hint`}
              className='text-xs text-muted-foreground'
            >
              Optional link to its management interface, such as an
              ISGAC page hosted by Management Center.
            </p>
          </div>
          {error && (
            <p
              id={`${id}-error`}
              role='alert'
              className='text-sm text-destructive'
            >
              {error}
            </p>
          )}
          <DialogFooter className='flex-wrap gap-2'>
            {appliance && (
              <Button
                type='button'
                variant='destructive'
                onClick={() => {
                  onSave(undefined);
                  onOpenChange(false);
                }}
              >
                Remove association
              </Button>
            )}
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='submit'>Save appliance</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
