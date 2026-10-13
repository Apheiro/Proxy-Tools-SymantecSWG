/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
import '@/styles/globals.css';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import type { Metadata } from 'next';
import Navbar from '@/components/navbar';
import CredentialProvider from '@/components/providers/credentialProvider';
import ThemeProvider from '@/components/providers/themeprovider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import WindowTitlebar from '@/components/window-titlebar';
import DayjsProvider from '@/providers/dayjsExtension';
import AppUpdateNotifier from '@/components/appUpdateNotifier';
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
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <div className='flex h-full min-w-0 flex-col'>
            <WindowTitlebar />
            <CredentialProvider>
              <DayjsProvider>
                <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
                  <Navbar />
                  <ScrollArea className='min-h-0 w-full flex-1'>
                    <TooltipProvider delayDuration={10}>
                      {children}
                    </TooltipProvider>
                  </ScrollArea>
                </div>
              </DayjsProvider>
            </CredentialProvider>
          </div>
          <Toaster position='top-center' />
          <AppUpdateNotifier />
        </ThemeProvider>
      </body>
    </html>
  );
}
