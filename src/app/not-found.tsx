import Link from 'next/link';
export default function NotFound() {
  return (
    <main className='flex-center flex-col gap-20px min-h-100dvh w-100dvw relative bg-white p-2'>
      <p className='font-bold'>Could not find requested resource</p>
      <Link href='/'>Return home</Link>
    </main>
  );
}
