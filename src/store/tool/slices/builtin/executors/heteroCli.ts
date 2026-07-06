import type { ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { applyWorktreeAddFromToolCall } from './worktreeDetection';

/**
 * Hook-only executor for a heterogeneous CLI agent's tool identifier
 * (`claude-code` / `codex` — set by the adapters in
 * `packages/heterogeneous-agents/src/adapters/*`). These agents run their OWN
 * tools, so this executor is NEVER invoked: `apiEnum` is empty → `hasApi()` is
 * always false → the client-tool dispatch (`hasExecutor`) never routes to
 * `invoke`, and no phantom tool is exposed to the model.
 *
 * It exists solely so the `tool_end` dispatcher
 * (`gatewayEventHandler.dispatchOnAfterCall`, which resolves the executor by the
 * tool's `identifier`) can reach `onAfterCall` and observe the CLI's shell tool
 * results renderer-side — the same seam idiomatic builtin tools use to react to
 * their own mutations.
 */
const EMPTY_API_ENUM = {} as Record<string, string>;

class HeteroCliExecutor extends BaseExecutor<typeof EMPTY_API_ENUM> {
  protected readonly apiEnum = EMPTY_API_ENUM;

  constructor(readonly identifier: string) {
    super();
  }

  onAfterCall = async ({ params, result }: ToolAfterCallContext): Promise<void> => {
    if (!result.success) return;
    // Only a successful `git worktree add` matches; every other tool call (and
    // non-shell tool) falls through cheaply inside the detector.
    await applyWorktreeAddFromToolCall(params);
  };
}

export const claudeCodeExecutor = new HeteroCliExecutor('claude-code');
export const codexExecutor = new HeteroCliExecutor('codex');
