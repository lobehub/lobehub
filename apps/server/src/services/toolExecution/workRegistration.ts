import { builtinTools } from '@lobechat/builtin-tools';
import { resolveWorkRegistration } from '@lobechat/builtin-tools/workRegistration';
import { type WorkRegistrationIntent } from '@lobechat/types';

import { type ToolExecutionResult } from './types';

/**
 * Manifest-driven Work registration intent for the server tool-execution path.
 *
 * The executor no longer writes the Work itself: it only RESOLVES what should
 * be registered (from the API's declarative `work` config + the tool
 * result/args) and hands the intent back on the result. The agent runtime
 * (`callTool` / `callToolsBatch`) persists it ONCE the tool call's cumulative
 * cost is known, so the Work version lands with its `cumulativeCost` instead of
 * being created cost-less and back-filled.
 *
 * Returns `undefined` for APIs that declare no `work` config or resolve to no
 * targets. Pure + side-effect-free — provenance and cost are supplied by the
 * runtime at persist time.
 */
export const resolveBuiltinToolWorkIntent = (
  identifier: string,
  apiName: string,
  payload: { args: Record<string, any>; result: ToolExecutionResult },
): WorkRegistrationIntent | undefined => {
  return resolveWorkRegistration(builtinTools, identifier, apiName, payload);
};
