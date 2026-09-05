import { useEffect, useMemo, useState } from 'react';

import type { SystemFont } from '@/services/electron/system';
import { electronSystemService } from '@/services/electron/system';

export const APPLICATION_DEFAULT_FONT = '__application_default__';

interface UseSystemFontOptionsParams {
  defaultLabel: string;
  enabled?: boolean;
  monospaceOnly?: boolean;
  unavailableLabel: (font: string) => string;
  value?: string;
}

export const useSystemFontOptions = ({
  defaultLabel,
  enabled = true,
  monospaceOnly,
  unavailableLabel,
  value,
}: UseSystemFontOptionsParams) => {
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [hasLoadError, setHasLoadError] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    const load = monospaceOnly
      ? electronSystemService.getSystemMonospaceFonts()
      : electronSystemService.getSystemFonts();

    load
      .then((fonts) => {
        if (!active) return;

        setSystemFonts(fonts);
        setHasLoadError(false);
      })
      .catch((error) => {
        if (!active) return;

        console.error('Failed to load system fonts:', error);
        setHasLoadError(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled, monospaceOnly]);

  const options = useMemo(() => {
    const fontOptions = [...systemFonts];

    if (value && !systemFonts.some((font) => font.value === value)) {
      fontOptions.unshift({ label: unavailableLabel(value), value });
    }

    return [{ label: defaultLabel, value: APPLICATION_DEFAULT_FONT }, ...fontOptions];
  }, [systemFonts, value, defaultLabel, unavailableLabel]);

  return { hasLoadError, isLoading, options };
};
