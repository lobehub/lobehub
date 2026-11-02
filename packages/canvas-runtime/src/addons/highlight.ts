import { LobeHighlightsTheme } from '@lobehub/ui';
import { codeToHtml, isSupportedLanguage } from '@pierre/highlights';

import { registerCanvasAddon } from './registry';

const decoder = new TextDecoder();

export const highlightCode = async (code: string, language?: string) => {
  const requested = language?.trim().toLowerCase() ?? '';
  const lang = isSupportedLanguage(requested) ? requested : 'text';
  return decoder.decode(codeToHtml(code, { lang, theme: LobeHighlightsTheme }));
};

if (typeof window !== 'undefined') registerCanvasAddon('highlight', { highlight: highlightCode });
