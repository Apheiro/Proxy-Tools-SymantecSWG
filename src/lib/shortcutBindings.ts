export const SHORTCUT_ACTIONS = [
  {
    id: 'previous',
    label: 'Previous window',
    description: 'Switch to the previous window group.',
  },
  {
    id: 'next',
    label: 'Next window',
    description: 'Switch to the next window group.',
  },
  {
    id: 'up',
    label: 'Previous related window',
    description: 'Move backward within the current stack.',
  },
  {
    id: 'down',
    label: 'Next related window',
    description: 'Move forward within the current stack.',
  },
  {
    id: 'minimize',
    label: 'Minimize window',
    description: 'Keep the current page in the dock.',
  },
  {
    id: 'close',
    label: 'Close window',
    description: 'Close only the current window.',
  },
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]['id'];
export type KeyBinding = {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};
export type ShortcutMap = Record<ShortcutAction, KeyBinding | null>;
const ctrl = (key: string): KeyBinding => ({
  key,
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
});
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  previous: ctrl('ArrowLeft'),
  next: ctrl('ArrowRight'),
  up: ctrl('ArrowUp'),
  down: ctrl('ArrowDown'),
  minimize: {
    key: 'Escape',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  },
  close: null,
};
export function supportedKey(key: string) {
  return (
    /^[a-z0-9]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    [
      'Escape',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Insert',
      'Delete',
      'Backspace',
      'Enter',
      'Tab',
      'Space',
    ].includes(key)
  );
}
export function eventBinding(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
  >,
): KeyBinding {
  const key =
    event.key === ' '
      ? 'Space'
      : event.key.length === 1
        ? event.key.toLowerCase()
        : event.key;
  return {
    key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}
export function bindingId(binding: KeyBinding) {
  return `${+binding.ctrl}${+binding.alt}${+binding.shift}${+binding.meta}:${binding.key}`;
}
export function matchShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'metaKey'
  > & { shiftKey?: boolean },
  bindings: ShortcutMap,
): ShortcutAction | null {
  const id = bindingId(
    eventBinding({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: !!event.shiftKey,
    }),
  );
  return (
    SHORTCUT_ACTIONS.find(
      (action) =>
        bindings[action.id] && bindingId(bindings[action.id]!) === id,
    )?.id ?? null
  );
}
export function formatBinding(binding: KeyBinding | null) {
  if (!binding) return 'Disabled';
  const key =
    (
      {
        ArrowLeft: '←',
        ArrowRight: '→',
        ArrowUp: '↑',
        ArrowDown: '↓',
        Escape: 'Esc',
        Space: 'Space',
      } as Record<string, string>
    )[binding.key] ??
    (binding.key.length === 1
      ? binding.key.toUpperCase()
      : binding.key);
  return [
    binding.ctrl ? 'Ctrl' : null,
    binding.alt ? 'Alt' : null,
    binding.shift ? 'Shift' : null,
    binding.meta ? 'Meta' : null,
    key,
  ]
    .filter(Boolean)
    .join(' + ');
}
export function sanitizeShortcuts(value: unknown): ShortcutMap {
  const result = { ...DEFAULT_SHORTCUTS };
  if (!value || typeof value !== 'object') return result;
  for (const action of SHORTCUT_ACTIONS) {
    const binding = (value as Record<string, unknown>)[action.id];
    if (binding === null) {
      result[action.id] = null;
      continue;
    }
    if (!binding || typeof binding !== 'object') continue;
    const b = binding as KeyBinding;
    if (
      typeof b.key === 'string' &&
      supportedKey(b.key) &&
      ['ctrl', 'alt', 'shift', 'meta'].every(
        (key) => typeof b[key as keyof KeyBinding] === 'boolean',
      )
    )
      result[action.id] = {
        key: b.key,
        ctrl: b.ctrl,
        alt: b.alt,
        shift: b.shift,
        meta: b.meta,
      };
  }
  const used = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = result[action.id];
    if (!binding) continue;
    const id = bindingId(binding);
    if (used.has(id)) result[action.id] = null;
    else used.add(id);
  }
  return result;
}
