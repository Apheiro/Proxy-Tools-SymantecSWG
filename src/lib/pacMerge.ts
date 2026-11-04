import { invoke, isTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { TextBlock } from './pacTextDiff';

export type RawEdit = {
  id: string;
  start: number;
  end: number;
  text: string;
  origin: string;
};
export type MergeChoice = 'accepted' | 'discarded' | 'merged';
export type MergeSnapshot = {
  edits: RawEdit[];
  decisions: Record<string, MergeChoice>;
};
export type MergeDraft = {
  base: string;
  edits: RawEdit[];
  decisions: Record<string, MergeChoice>;
  filename: string;
  history: MergeSnapshot[];
};

export function locatedBlocks(blocks: TextBlock[]) {
  let offset = 0;
  return blocks.map((block) => {
    const start = offset;
    offset += block.left.join('').length;
    return { ...block, start, end: offset };
  });
}

export function editsOverlap(a: RawEdit, b: RawEdit) {
  if (a.start === a.end || b.start === b.end)
    return a.start <= b.end && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

export function mergeResult(base: string, edits: RawEdit[]) {
  let cursor = 0;
  let result = '';
  for (const edit of [...edits].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (
      edit.start < cursor ||
      edit.end < edit.start ||
      edit.end > base.length
    )
      throw new Error(
        'Result contains overlapping or invalid changes.',
      );
    result += base.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + base.slice(cursor);
}

const pendingDownloads = new Map<string, Promise<void>>();

function browserFilename(input: string) {
  const cleaned = input
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  const match = /^(.*)\.(pac|dat)$/i.exec(cleaned);
  let stem =
    (match ? match[1] : cleaned)
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 100) || 'wpad';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem))
    stem = `wpad-${stem}`;
  return `${stem}.${match ? match[2].toLowerCase() : 'pac'}`;
}

/** Shared by original-file and merged-result exports; never claim an unconfirmed disk write. */
export function downloadRawPac(
  filename: string,
  content: string,
): Promise<void> {
  const key = JSON.stringify([filename, content]);
  const existing = pendingDownloads.get(key);
  if (existing) return existing;
  const request = (async () => {
    let notice: string | number | undefined;
    try {
      const native = isTauri();
      notice = toast.loading(
        native
          ? 'Saving PAC/WPAD to Downloads…'
          : 'Preparing browser download…',
      );
      if (typeof content !== 'string')
        throw new Error(
          'Original text is unavailable. Synchronize this source first.',
        );
      if (native) {
        const saved = await invoke<{
          filename: string;
          path: string;
        }>('save_pac_text', { filename, content });
        if (
          !saved ||
          typeof saved.path !== 'string' ||
          !saved.path ||
          typeof saved.filename !== 'string' ||
          !saved.filename
        )
          throw new Error(
            'The native save command did not confirm a saved file.',
          );
        toast.success('PAC/WPAD saved.', {
          id: notice,
          description: saved.path,
          duration: 15000,
          action: {
            label: 'Open folder',
            onClick: () => {
              void invoke('reveal_pac_export', {
                filename: saved.filename,
              }).catch((error) =>
                toast.error(
                  `The file was saved, but its folder could not be opened: ${String(error)}`,
                  { description: saved.path },
                ),
              );
            },
          },
        });
      } else {
        const blob = new Blob([content], {
          type: 'application/x-ns-proxy-autoconfig',
          endings: 'transparent',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        try {
          anchor.href = url;
          anchor.download = browserFilename(filename);
          anchor.hidden = true;
          document.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        toast.message('Browser download requested.', {
          id: notice,
          description:
            'Your browser manages the destination and any save or cancel prompt. ProxyTools cannot confirm the saved path or completion.',
          duration: 15000,
        });
      }
    } catch (error) {
      toast.error(`Could not download PAC/WPAD: ${String(error)}`, {
        id: notice,
        duration: 15000,
      });
    }
  })();
  pendingDownloads.set(key, request);
  // Share an in-flight write across duplicate cards, then suppress immediate double-clicks.
  const release = () => {
    setTimeout(() => {
      if (pendingDownloads.get(key) === request)
        pendingDownloads.delete(key);
    }, 1000);
  };
  void request.then(release, release);
  return request;
}
