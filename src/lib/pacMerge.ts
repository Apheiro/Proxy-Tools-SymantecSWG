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

export function downloadRawPac(filename: string, content: string) {
  // Blob's default endings:'transparent' retains CRLF/LF/CR and the BOM.
  const blob = new Blob([content], {
    type: 'application/x-ns-proxy-autoconfig',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = /\.(pac|dat)$/i.test(filename)
    ? filename
    : `${filename}.pac`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
