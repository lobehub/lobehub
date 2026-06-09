# Streaming — Live Output During Execution (optional)

**Lifecycle:** rendered **while the executor is still running** for APIs that emit incremental output. The component is responsible for fetching the in-flight stream from the chat store and rendering it.

**Add for** long-running ops with continuous output: shell command execution (stdout/stderr), file write progress, code interpreter cells.

## Props (`BuiltinStreamingProps<Args>`)

```ts
interface BuiltinStreamingProps<Arguments = any> {
  apiName: string;
  args: Arguments;
  identifier: string;
  messageId: string; // use to fetch the streaming buffer from store
  toolCallId: string;
}
```

Note there's **no `state` or `result` prop** — the Streaming component is for the in-flight phase. It pulls the live buffer from the store itself (typically via `chatToolSelectors.streamingContent(messageId)` or similar).

## Canonical example — RunCommandStreaming

`packages/builtin-tool-local-system/src/client/Streaming/RunCommand/index.tsx`:

```tsx
'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';

interface RunCommandParams {
  command?: string;
  description?: string;
  timeout?: number;
}

export const RunCommandStreaming = memo<BuiltinStreamingProps<RunCommandParams>>(({ args }) => {
  const { command } = args || {};
  if (!command) return null;

  return (
    <Highlighter
      animated
      wrap
      language="sh"
      showLanguage={false}
      style={{ padding: '4px 8px' }}
      variant="outlined"
    >
      {command}
    </Highlighter>
  );
});
RunCommandStreaming.displayName = 'RunCommandStreaming';
```

For real-time output beyond just the command (stderr/stdout streaming), pull from the chat store:

```tsx
const buffer = useChatStore((state) =>
  chatToolSelectors.streamingBuffer(messageId, toolCallId)(state),
);
```

## Streaming rules

- Render `null` until you have something to display (avoids flash).
- For terminal-style output, use `Highlighter` with `animated` to show typing-like effect.
- The Streaming component must **unmount cleanly** when execution ends — typically the framework swaps it out for the Render automatically.

## Streaming registry — `client/Streaming/index.ts`

```ts
import { LocalSystemApiName } from '../..';
import { RunCommandStreaming } from './RunCommand';
import { WriteFileStreaming } from './WriteFile';

export const LocalSystemStreamings = {
  [LocalSystemApiName.runCommand]: RunCommandStreaming,
  [LocalSystemApiName.writeLocalFile]: WriteFileStreaming,
};
```
