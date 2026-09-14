import { formatUploadedFilesPrompt } from '@lobechat/builtin-tool-cloud-sandbox';

import { FileModel } from '@/database/models/file';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

export interface SandboxVariables {
  creds_sandbox_reachable: string;
  sandbox_enabled: string;
  sandbox_uploaded_files: string;
}

/**
 * Cloud-sandbox placeholders.
 *
 * `sandbox_enabled` tracks whether the dedicated Cloud Sandbox tool is
 * offered — true for target 'sandbox', and (so the model can choose sandbox
 * vs. an auto-routed device per call) for 'auto' too, regardless of whether a
 * device ended up routed. It's still not the full answer for
 * `injectCredsToSandbox` reachability: `lobe-skills`' `runCommand` /
 * `execScript` ALSO silently fall back to that same cloud sandbox session
 * whenever no device is actively routed, for targets where the dedicated tool
 * isn't offered at all (e.g. the common no-device 'none' web/agent session).
 * So a credential is reachable whenever EITHER condition holds: the dedicated
 * tool is exposed for 'auto' (independent of device routing), or no device is
 * routed (independent of target).
 */
export const resolveSandboxVariables = async ({
  activeDeviceId,
  ctx,
  enabledToolIds,
  executionTarget,
  topicId,
}: ServerContextFactInput): Promise<SandboxVariables> => {
  const sandboxEnabled = enabledToolIds.includes('lobe-cloud-sandbox');
  let uploadedFiles = '';
  if (sandboxEnabled && ctx.serverDB && ctx.userId && topicId) {
    try {
      const files = await new FileModel(ctx.serverDB, ctx.userId).findFilesToInitInSandbox(topicId);
      uploadedFiles = formatUploadedFilesPrompt(files);
    } catch (error) {
      log('Failed to resolve files for {{sandbox_uploaded_files}} substitution: %O', error);
    }
  }

  return {
    creds_sandbox_reachable: String(!activeDeviceId || executionTarget === 'auto'),
    sandbox_enabled: String(sandboxEnabled),
    sandbox_uploaded_files: uploadedFiles,
  };
};
