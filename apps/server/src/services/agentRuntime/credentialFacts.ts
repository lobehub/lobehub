import { CredsApiName, CredsIdentifier } from '@lobechat/builtin-tool-creds';

/**
 * Creds APIs that change what the credential list contains.
 * `injectCredsToSandbox` only reads, so a coding run that injects on every step
 * keeps the snapshot frozen when its operation was created.
 */
const MUTATING_API_NAMES = new Set<string>([
  CredsApiName.connectComposioService,
  CredsApiName.initiateOAuthConnect,
  CredsApiName.saveCreds,
]);

interface ToolCallRef {
  apiName?: string;
  identifier?: string;
}

/**
 * Whether the step that produced this context changed the run's own
 * credentials. The list the next step renders would then differ from the
 * snapshot frozen at creation, so the run goes back to reading it live.
 *
 * Reads the tool calls off the step's next context — the same source
 * `buildStepPresentation` uses, but available before the step's state is
 * persisted, which is where the snapshot has to be dropped for the next step to
 * see it gone.
 */
export const stepChangedCredentials = (nextContext?: {
  payload?: unknown;
  phase?: string;
}): boolean => {
  const payload = nextContext?.payload as
    | { toolCall?: ToolCallRef; toolResults?: ({ toolCall?: ToolCallRef } | undefined)[] }
    | undefined;
  if (!payload) return false;

  // A batch step carries one entry per call; a single tool step carries the call itself.
  const calls = payload.toolResults
    ? payload.toolResults.map((result) => result?.toolCall)
    : [payload.toolCall];

  return calls.some(
    (call) => call?.identifier === CredsIdentifier && MUTATING_API_NAMES.has(call?.apiName ?? ''),
  );
};
