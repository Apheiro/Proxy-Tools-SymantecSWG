'use client';
import { createContext, useState } from 'react';

type ProxyGlobalDataContextType = {
  proxy: Proxy | undefined;
  setProxy: (proxy: Proxy) => void;
  resetGlobalProxyData: () => void;
};

const ProxyGlobalDataContext =
  createContext<ProxyGlobalDataContextType>({
    proxy: undefined,
    setProxy: () => {},
    resetGlobalProxyData: () => {},
  });

export { ProxyGlobalDataContext };
export default function ProxyGliobalDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [proxy, setProxy] = useState<Proxy>();
  const resetGlobalProxyData = () => {
    setProxy(undefined);
  };

  return (
    <ProxyGlobalDataContext.Provider
      value={{ proxy, setProxy, resetGlobalProxyData }}
    >
      {children}
    </ProxyGlobalDataContext.Provider>
  );
}
