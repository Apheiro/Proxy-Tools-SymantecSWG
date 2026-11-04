import { diffArrays } from 'diff';
import type { PacSource } from './pac';

// Keep terminators in the tokens: CRLF, LF, CR and missing final newline differ.
export function rawLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

export function downloadedText(
  source: PacSource,
): string | undefined {
  const content =
    source.localContent ??
    source.downloadedContent ??
    source.pendingContent ??
    source.remoteContent;
  if (content !== undefined && typeof content !== 'string')
    throw new Error(
      `Could not read downloaded text for ${source.name}. Synchronize the source again.`,
    );
  return content;
}

export type TextBlock = {
  changed: boolean;
  left: string[];
  right: string[];
  leftStart: number;
  rightStart: number;
};

export function comparePacText(
  left: string,
  right: string,
): TextBlock[] {
  const changes = diffArrays(rawLines(left), rawLines(right), {
    timeout: 1000,
  });
  if (!changes)
    throw new Error(
      'Comparison took too long. Copy the original files to compare them externally.',
    );
  const blocks: TextBlock[] = [];
  let leftStart = 1;
  let rightStart = 1;
  for (const change of changes) {
    const changed = change.added || change.removed;
    let block = blocks[blocks.length - 1];
    if (!changed || !block?.changed) {
      block = {
        changed: Boolean(changed),
        left: [],
        right: [],
        leftStart,
        rightStart,
      };
      blocks.push(block);
    }
    if (!change.added) {
      block.left = block.left.concat(change.value);
      leftStart += change.value.length;
    }
    if (!change.removed) {
      block.right = block.right.concat(change.value);
      rightStart += change.value.length;
    }
  }
  return blocks;
}
