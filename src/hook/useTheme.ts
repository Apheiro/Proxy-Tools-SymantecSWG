import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export default function useThemeCustom() {
  const { theme, resolvedTheme, ...props } = useTheme();
  const [themeCustom, setTheme] = useState({
    theme: 'undefined',
    resolvedTheme: 'undefined',
  });

  useEffect(() => {
    setTheme({
      theme,
      resolvedTheme,
    });
  }, [theme]);

  return { ...themeCustom, ...props };
}
