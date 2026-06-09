# Intervention — Approval / Edit-Before-Run (optional)

**Lifecycle:** rendered **before the executor runs** for APIs whose manifest sets `humanIntervention`. The user sees a preview of the args, can edit them, then approves or skips/cancels.

**Add for** destructive or sensitive ops: shell commands, file writes, file moves, payments, message broadcasts.

## Props (`BuiltinInterventionProps<Args>`)

```ts
interface BuiltinInterventionProps<Arguments = any> {
  apiName?: string;
  args: Arguments;
  identifier?: string;
  interactionMode?: 'approval' | 'custom';
  messageId: string;

  /** Called when the user edits the args; the approve action awaits this. */
  onArgsChange?: (args: Arguments) => void | Promise<void>;

  /** Called on approve / skip / cancel. */
  onInteractionAction?: (
    action:
      | { type: 'submit'; payload: Record<string, unknown> }
      | { type: 'skip'; payload?: Record<string, unknown>; reason?: string }
      | { type: 'cancel'; payload?: Record<string, unknown> },
  ) => Promise<void>;

  /** Register a callback to flush pending saves before approval. Returns cleanup. */
  registerBeforeApprove?: (id: string, callback: () => void | Promise<void>) => () => void;
}
```

## Canonical example — RunCommand Intervention

`packages/builtin-tool-local-system/src/client/Intervention/RunCommand/index.tsx`:

```tsx
import type { RunCommandParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

const RunCommand = memo<BuiltinInterventionProps<RunCommandParams>>(({ args }) => {
  const { description, command, timeout } = args;
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal justify="space-between">
        {description && <Text>{description}</Text>}
        {timeout && (
          <Text style={{ fontSize: 12 }} type="secondary">
            timeout: {formatTimeout(timeout)}
          </Text>
        )}
      </Flexbox>
      {command && (
        <Highlighter wrap language="sh" showLanguage={false} variant="outlined">
          {command}
        </Highlighter>
      )}
    </Flexbox>
  );
});
export default RunCommand;
```

## Intervention rules

- **Show a preview, not a form by default.** Editing UI is opt-in via `onArgsChange` and is usually inline (click to edit a code block, etc.).
- For args with debounced edit state (text fields), use `registerBeforeApprove(id, flushFn)` so the approve action waits for the debounce to flush. Always return the cleanup function.
- Call `onInteractionAction({ type: 'submit', payload })` when the user approves; `'skip'` if they skip with a reason; `'cancel'` if they cancel the whole turn.
- Add a corresponding `interventionAudit.ts` in the package root if the tool needs scope/path validation before approval (see `local-system/src/interventionAudit.ts`).

## Intervention registry — `client/Intervention/index.ts`

```ts
import { LocalSystemApiName } from '../..';
import EditLocalFile from './EditLocalFile';
import RunCommand from './RunCommand';
import WriteFile from './WriteFile';
/* … */

export const LocalSystemInterventions = {
  [LocalSystemApiName.editLocalFile]: EditLocalFile,
  [LocalSystemApiName.runCommand]: RunCommand,
  [LocalSystemApiName.writeLocalFile]: WriteFile,
  /* one entry per API that needs approval */
};
```
