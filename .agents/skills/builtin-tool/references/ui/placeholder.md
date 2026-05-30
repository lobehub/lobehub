# Placeholder — Skeleton Between Args and Result (optional)

**Lifecycle:** rendered when the args have finished streaming but the executor hasn't returned yet. Disappears when `pluginState` arrives. Bridges the moment of perceived lag.

**Add for** APIs with noticeable execution time: web search, network crawl, file list, large grep. **Skip for** instant ops (status flips, calculator).

## Props (`BuiltinPlaceholderProps<Args>`)

```ts
interface BuiltinPlaceholderProps<T extends Record<string, any> = any> {
  apiName: string;
  args?: T;
  identifier: string;
}
```

No `pluginState` — Placeholder lives entirely in the "executing" gap.

## Canonical example — Search Placeholder

`packages/builtin-tool-web-browsing/src/client/Placeholder/Search.tsx`:

```tsx
import type { BuiltinPlaceholderProps, SearchQuery } from '@lobechat/types';
import { Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  query: cx(
    css`
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,
    shinyTextStyles.shinyText,
  ),
}));

export const Search = memo<BuiltinPlaceholderProps<SearchQuery>>(({ args }) => {
  const { query } = args || {};
  const isMobile = useIsMobile();

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal={!isMobile} gap={isMobile ? 8 : 40}>
        <Flexbox horizontal align="center" className={styles.query} gap={8}>
          <Icon icon={SearchIcon} />
          {query ? query : <Skeleton.Block active style={{ height: 20, width: 40 }} />}
        </Flexbox>
        <Skeleton.Block active style={{ height: 20, width: 40 }} />
      </Flexbox>
      <Flexbox horizontal gap={12}>
        {[1, 2, 3, 4, 5].map((id) => (
          <Skeleton.Button active key={id} style={{ borderRadius: 8, height: 80, width: 160 }} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});
```

## Placeholder rules

- **Mirror the eventual Render's layout.** When the result arrives the Placeholder unmounts and the Render mounts; if they share dimensions, the chat doesn't jump.
- Use `Skeleton.Block` / `Skeleton.Button` from `@lobehub/ui` for placeholder shapes.
- Embed any args you have (e.g. the query text) — context helps the user know what's loading.
- Pulse with `shinyTextStyles.shinyText` if the Placeholder includes literal text.

## Placeholder registry — `client/Placeholder/index.ts`

```ts
import { WebBrowsingApiName } from '../../types';
import CrawlMultiPages from './CrawlMultiPages';
import CrawlSinglePage from './CrawlSinglePage';
import { Search } from './Search';

export const WebBrowsingPlaceholders = {
  [WebBrowsingApiName.crawlMultiPages]: CrawlMultiPages,
  [WebBrowsingApiName.crawlSinglePage]: CrawlSinglePage,
  [WebBrowsingApiName.search]: Search,
};

export { CrawlMultiPages, CrawlSinglePage, Search };
```
