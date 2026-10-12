/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
import '@/styles/globals.css';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import type { Metadata } from 'next';
import Navbar from '@/components/navbar';
import CredentialProvider from '@/components/providers/credentialProvider';
import ThemeProvider from '@/components/providers/themeprovider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import DayjsProvider from '@/providers/dayjsExtension';
// import ProxyGliobalDataProvider from '@/providers/proxyGlobalData';

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
      <body className='bg-red h-dvh overflow-hidden'>
        <CredentialProvider>
          <DayjsProvider>
            <ThemeProvider
              attribute='class'
              defaultTheme='system'
              enableSystem
              disableTransitionOnChange
            >
              <Navbar />
              <ScrollArea className='h-[calc(100dvh-53px)] w-dvw'>
                <TooltipProvider delayDuration={10}>
                  {children}
                </TooltipProvider>
                <Toaster position='top-center' />
              </ScrollArea>
            </ThemeProvider>
          </DayjsProvider>
        </CredentialProvider>
      </body>
    </html>
  );
}
