import { Bing, Exa, Google, Jina, Search1API, Tavily } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Static display names for known web-browsing channel ids. Unknown ids fall
 * back to their raw id, so the picker keeps working when the server enables a
 * channel the client doesn't know about yet.
 */
const CHANNEL_DISPLAY_NAME: Record<string, string> = {
  anspire: 'Anspire',
  bing: 'Bing',
  bocha: 'Bocha',
  brave: 'Brave',
  browserless: 'Browserless',
  exa: 'Exa',
  firecrawl: 'Firecrawl',
  google: 'Google',
  jina: 'Jina',
  kagi: 'Kagi',
  naive: 'Naive',
  search1api: 'Search1API',
  searxng: 'SearXNG',
  tavily: 'Tavily',
};

export const getChannelDisplayName = (id: string): string => CHANNEL_DISPLAY_NAME[id] ?? id;

/**
 * Brand avatars for channels that ship an official icon in `@lobehub/icons`.
 * Channels without a brand icon render a generic globe glyph.
 */
export const getChannelIcon = (id: string, size = 24): ReactNode => {
  switch (id) {
    case 'bing': {
      return <Bing.Avatar size={size} />;
    }
    case 'exa': {
      return <Exa.Avatar size={size} />;
    }
    case 'google': {
      return <Google.Avatar size={size} />;
    }
    case 'jina': {
      return <Jina.Avatar size={size} />;
    }
    case 'search1api': {
      return <Search1API.Avatar size={size} />;
    }
    case 'tavily': {
      return <Tavily.Avatar size={size} />;
    }
    default: {
      return <Icon icon={Globe} size={size - 8} style={{ opacity: 0.6 }} />;
    }
  }
};
