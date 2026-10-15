'use client';

import { openUrl } from '@tauri-apps/plugin-opener';
import Markdown from 'markdown-to-jsx';
import type { ComponentProps } from 'react';
import { toast } from 'sonner';

function ReleaseLink({ href, children }: ComponentProps<'a'>) {
  let url: URL;
  try {
    url = new URL(href ?? '');
    if (url.protocol !== 'https:' || url.username || url.password)
      return <span>{children}</span>;
  } catch {
    return <span>{children}</span>;
  }
  return (
    <a
      href={url.href}
      className='text-primary underline underline-offset-4 hover:opacity-80'
      onClick={(event) => {
        event.preventDefault();
        void openUrl(url.href).catch(() =>
          toast.error('Could not open the release link.'),
        );
      }}
    >
      {children}
    </a>
  );
}

export default function ReleaseNotes({
  children,
}: {
  children: string;
}) {
  return (
    <Markdown
      className='min-w-0 space-y-3 break-words text-sm leading-relaxed [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_li>ul]:mt-1 [&_li>ol]:mt-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:border-border [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:p-2 [&_td]:border [&_td]:border-border [&_td]:p-2 [&>:first-child]:mt-0'
      options={{
        disableParsingRawHTML: true,
        forceBlock: true,
        forceWrapper: true,
        overrides: {
          a: ReleaseLink,
          // Release notes need no remote image downloads or embedded widgets.
          img: ({ alt }: ComponentProps<'img'>) => <span>{alt}</span>,
        },
      }}
    >
      {children}
    </Markdown>
  );
}
