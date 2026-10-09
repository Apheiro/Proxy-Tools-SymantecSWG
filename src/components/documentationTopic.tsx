import Link from 'next/link';
import ResolvedCacheDirectory from '@/components/resolvedCacheDirectory';
import {
  type DocumentationSlug,
  documentationTopics,
} from '@/lib/documentation';

export default function DocumentationTopic({
  slug,
}: {
  slug: DocumentationSlug;
}) {
  const topic = documentationTopics[slug];
  return (
    <div className='space-y-6'>
      <header>
        <p className='text-xs uppercase tracking-wider text-primary'>
          User guide
        </p>
        <h1 className='mt-2 text-3xl font-bold tracking-tight'>
          {topic.title}
        </h1>
        <p className='mt-3 text-sm text-muted-foreground'>
          {topic.description}
        </p>
      </header>
      <nav
        aria-label='On this page'
        className='flex flex-wrap gap-x-4 gap-y-2 rounded-lg border bg-muted/20 p-3 text-xs'
      >
        {topic.sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className='text-primary hover:underline'
          >
            {section.title}
          </a>
        ))}
      </nav>
      {topic.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className='scroll-mt-6 space-y-3 border-t pt-5'
        >
          <h2 className='text-lg font-semibold'>{section.title}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p
              key={paragraph}
              className='text-sm leading-6 text-muted-foreground'
            >
              {paragraph}
            </p>
          ))}
          {section.rows && (
            <div className='overflow-x-auto rounded-lg border'>
              <table className='w-full text-left text-sm'>
                <tbody>
                  {section.rows.map(([name, definition]) => (
                    <tr key={name} className='border-b last:border-0'>
                      <th
                        scope='row'
                        className='w-1/4 min-w-36 px-3 py-3 align-top font-medium'
                      >
                        {name}
                      </th>
                      <td className='px-3 py-3 leading-6 text-muted-foreground'>
                        {definition}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {slug === 'storage' && section.id === 'paths' && (
            <div className='rounded-lg border bg-muted/20 p-4 font-mono text-xs'>
              <ResolvedCacheDirectory />
            </div>
          )}
        </section>
      ))}
      <footer className='flex flex-wrap gap-4 border-t pt-4 text-sm'>
        <Link href='/documentation' className='text-primary'>
          Documentation overview
        </Link>
        <Link href='/documentation/storage' className='text-primary'>
          Files & local storage
        </Link>
        <Link href='/documentation/settings' className='text-primary'>
          Settings & connections
        </Link>
      </footer>
    </div>
  );
}
