import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { documentationTopics } from '@/lib/documentation';

export default function DocumentationPage() {
  return (
    <div className='space-y-6'>
      <header>
        <p className='text-xs uppercase tracking-wider text-primary'>
          Start here
        </p>
        <h1 className='mt-2 text-3xl font-bold tracking-tight'>
          Proxy Tools at a glance
        </h1>
        <p className='mt-3 text-sm leading-6 text-muted-foreground'>
          Manage ProxySG/Edge SWG appliances, inspect policy and
          traces, analyze access logs, and edit supported PAC routing
          visually. React presents the data; Rust handles operating
          system commands, management HTTP, ELFF parsing and capture
          storage.
        </p>
      </header>
      <section className='rounded-lg border bg-muted/20 p-4 text-sm leading-6'>
        <h2 className='font-semibold'>Choose a workflow</h2>
        <ul className='mt-2 list-disc space-y-1 pl-5 text-muted-foreground'>
          <li>
            Home → Proxy → Diagnostics → Trace: inspect individual
            policy evaluations.
          </li>
          <li>
            Home → Proxy → Diagnostics → Traffic Analysis: analyze
            entire static logs or HTTP streams.
          </li>
          <li>
            Home → PAC File Manager → Source editor: edit, test and
            export ordered routing rules.
          </li>
        </ul>
      </section>
      <div className='grid gap-3 sm:grid-cols-2'>
        {Object.entries(documentationTopics).map(([slug, topic]) => (
          <Link
            key={slug}
            href={`/documentation/${slug}`}
            className='rounded-lg border p-4 transition-colors hover:bg-muted/30'
          >
            <h2 className='flex items-center justify-between gap-2 font-semibold'>
              {topic.title}
              <ArrowRight className='size-4 text-primary' />
            </h2>
            <p className='mt-2 text-sm leading-6 text-muted-foreground'>
              {topic.description}
            </p>
          </Link>
        ))}
      </div>
      <section className='border-t pt-4 text-sm leading-6 text-muted-foreground'>
        <h2 className='font-semibold text-foreground'>
          Desktop routing and data
        </h2>
        <p className='mt-2'>
          Every page has a static route; selected proxies and PAC
          sources travel in query parameters. Inventory, sources and
          preferences persist in WebView storage. Rust captures use
          the application cache. Mock/Live selects management HTTP
          sources, while uploaded logs stay local. See the dedicated
          pages for definitions, actual runtime paths, authentication
          and current limitations.
        </p>
      </section>
    </div>
  );
}
