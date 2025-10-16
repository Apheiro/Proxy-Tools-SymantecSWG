/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
import '@/styles/globals.css';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import type { Metadata } from 'next';
import Navbar from '@/components/navbar';
import ThemeProvider from '@/components/providers/themeprovider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';

dayjs.extend(isBetween);

export const metadata: Metadata = {
  title: 'Proxy Tools',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <ScrollArea className='h-[100dvh]'>
            <Navbar />

            <TooltipProvider delayDuration={10}>
              {children}
            </TooltipProvider>
            <Toaster position='top-center' />
          </ScrollArea>
        </ThemeProvider>
      </body>
    </html>
  );
}
