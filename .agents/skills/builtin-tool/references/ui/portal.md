# Portal — Full-Screen Detail View (optional)

**Lifecycle:** rendered when the user opens the tool message in a side panel or full-screen modal. One Portal per **tool**, not per API — the Portal switches on `apiName` internally.

**Add for** tools whose results deserve a deep-dive view: search results with editable filters, page content with reader mode, code interpreter sessions.

## Props (`BuiltinPortalProps<Args, State>`)

```ts
interface BuiltinPortalProps<Arguments = Record<string, any>, State = any> {
  apiName?: string;
  arguments: Arguments;
  identifier: string;
  messageId: string;
  state: State;
}
```

## Canonical example — Web-Browsing Portal

`packages/builtin-tool-web-browsing/src/client/Portal/index.tsx`:

```tsx
import type { BuiltinPortalProps, CrawlPluginState, SearchQuery } from '@lobechat/types';
import { memo } from 'react';

import { WebBrowsingApiName } from '../../types';
import PageContent from './PageContent';
import PageContents from './PageContents';
import Search from './Search';

const Portal = memo<BuiltinPortalProps>(({ arguments: args, messageId, state, apiName }) => {
  switch (apiName) {
    case WebBrowsingApiName.search:
      return <Search messageId={messageId} query={args as SearchQuery} response={state} />;

    case WebBrowsingApiName.crawlSinglePage: {
      const result = (state as CrawlPluginState).results.find((r) => r.originalUrl === args.url);
      return <PageContent messageId={messageId} result={result} />;
    }

    case WebBrowsingApiName.crawlMultiPages:
      return (
        <PageContents
          messageId={messageId}
          results={(state as CrawlPluginState).results}
          urls={args.urls}
        />
      );
  }
  return null;
});
export default Portal;
```

## Portal rules

- One Portal per tool — the file is the routing layer, subcomponents implement each API's view.
- Portals can read the chat store directly to detect "still streaming" and render a Skeleton internally (see `Search/index.tsx:20-46`).
- Layout assumes more space than the Render — use `Flexbox` with `height={'100%'}` and structure for a side panel viewport.

## Portal registry — `packages/builtin-tools/src/portals.ts`

```ts
import { WebBrowsingManifest, WebBrowsingPortal } from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinPortal } from '@lobechat/types';

export const BuiltinToolsPortals: Record<string, BuiltinPortal> = {
  [WebBrowsingManifest.identifier]: WebBrowsingPortal as BuiltinPortal,
};
```
