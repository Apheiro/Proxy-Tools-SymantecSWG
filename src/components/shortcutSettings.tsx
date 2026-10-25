'use client';
import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useAppPreferences,
  setAppPreferences,
} from '@/lib/appPreferences';
import {
  bindingId,
  DEFAULT_SHORTCUTS,
  eventBinding,
  formatBinding,
  SHORTCUT_ACTIONS,
  supportedKey,
  type ShortcutAction,
} from '@/lib/shortcutBindings';

export default function ShortcutSettings({
  active = true,
}: {
  active?: boolean;
}) {
  const preferences = useAppPreferences();
  const [recording, setRecording] = useState<ShortcutAction | null>(
    null,
  );
  const [error, setError] = useState('');
  const restoreDefault = (id: ShortcutAction) => {
    const binding = DEFAULT_SHORTCUTS[id];
    const conflict =
      binding &&
      SHORTCUT_ACTIONS.find(
        (action) =>
          action.id !== id &&
          preferences.shortcuts[action.id] &&
          bindingId(preferences.shortcuts[action.id]!) ===
            bindingId(binding),
      );
    setRecording(null);
    if (conflict) {
      setError(
        `Default combination is already assigned to ${conflict.label}.`,
      );
      return;
    }
    setError('');
    setAppPreferences({
      shortcuts: { ...preferences.shortcuts, [id]: binding },
    });
  };
  useEffect(() => {
    if (!active) {
      setRecording(null);
      setError('');
      return;
    }
    if (!recording) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        setError('');
        return;
      }
      if (
        ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key) ||
        event.repeat
      )
        return;
      const binding = eventBinding(event);
      if (!supportedKey(binding.key)) {
        setError(
          'Choose a letter, number, function key or navigation key.',
        );
        return;
      }
      if (
        !(binding.ctrl || binding.alt || binding.meta) &&
        !/^F\d+$/.test(binding.key)
      ) {
        setError(
          'Use Ctrl, Alt or Meta with this key. Escape remains available through Restore default.',
        );
        return;
      }
      const conflict = SHORTCUT_ACTIONS.find(
        (action) =>
          action.id !== recording &&
          preferences.shortcuts[action.id] &&
          bindingId(preferences.shortcuts[action.id]!) ===
            bindingId(binding),
      );
      if (conflict) {
        setError(`Already assigned to ${conflict.label}.`);
        return;
      }
      try {
        setAppPreferences({
          shortcuts: {
            ...preferences.shortcuts,
            [recording]: binding,
          },
        });
        setRecording(null);
        setError('');
      } catch {
        setError('Could not save this shortcut on this device.');
      }
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [recording, preferences.shortcuts, active]);
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='flex items-center gap-2 text-sm font-semibold'>
            <Keyboard className='size-4' />
            Window shortcuts
          </h2>
          <p className='mt-1 text-xs text-muted-foreground'>
            Click a combination and press its replacement. Escape
            cancels capture.
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          onClick={() => {
            setRecording(null);
            setError('');
            setAppPreferences({ shortcuts: DEFAULT_SHORTCUTS });
          }}
        >
          <RotateCcw className='size-3.5' />
          Restore defaults
        </Button>
      </div>
      <div className='divide-y rounded-xl border'>
        {SHORTCUT_ACTIONS.map((action) => (
          <div
            key={action.id}
            className='flex flex-wrap items-center justify-between gap-3 px-4 py-3'
          >
            <div className='min-w-0'>
              <p className='text-sm font-medium'>{action.label}</p>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                {action.description}
              </p>
            </div>
            <div className='flex items-center gap-1'>
              <Button
                size='sm'
                variant={
                  recording === action.id ? 'default' : 'outline'
                }
                className='min-w-36 font-mono text-xs'
                aria-label={`Change shortcut for ${action.label}`}
                aria-pressed={recording === action.id}
                onClick={() => {
                  setRecording(
                    recording === action.id ? null : action.id,
                  );
                  setError('');
                }}
              >
                {recording === action.id
                  ? 'Press keys…'
                  : formatBinding(preferences.shortcuts[action.id])}
              </Button>
              <Button
                size='icon'
                variant='ghost'
                className='size-8'
                title='Restore default'
                aria-label={`Restore default for ${action.label}`}
                onClick={() => restoreDefault(action.id)}
              >
                <RotateCcw className='size-3.5' />
              </Button>
              <Button
                size='icon'
                variant='ghost'
                className='size-8'
                title='Disable shortcut'
                aria-label={`Disable shortcut for ${action.label}`}
                onClick={() => {
                  setRecording(null);
                  setAppPreferences({
                    shortcuts: {
                      ...preferences.shortcuts,
                      [action.id]: null,
                    },
                  });
                }}
              >
                <X className='size-3.5' />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
      <p className='text-xs text-muted-foreground'>
        Saved on this device and applied inside the app and embedded
        pages. System-reserved combinations may be intercepted by your
        operating system.
      </p>
    </section>
  );
}
