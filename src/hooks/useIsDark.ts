import { useTheme as useNextThemesTheme } from 'next-themes';

/**
 * Hook to check if the current theme is dark
 * @returns boolean - true if current theme is dark, false otherwise
 */
export const useIsDark = (): boolean => {
  const { resolvedTheme } = useNextThemesTheme();

  return resolvedTheme === 'dark';
};
