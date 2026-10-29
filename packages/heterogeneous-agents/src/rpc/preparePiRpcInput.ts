import path from 'node:path';

import type { AgentPromptInput } from '../protocol';
import {
  LOBEHUB_CLI_SKILL_NAME,
  omitLobeHubCliGuide,
  resolveLobeHubCliPluginDir,
} from '../spawn/lobeHubCliPlugin';
import { toPiRpcPrompt } from './piRpcAgentHandle';

export interface PreparePiRpcInputOptions {
  args: string[];
  cacheDir?: string;
  lobeHubContext: boolean;
}

/** Prepare both launch arguments and prompt before either host flattens away context tags. */
export const preparePiRpcInput = async (
  input: AgentPromptInput,
  options: PreparePiRpcInputOptions,
) => {
  let args = options.args;
  let prompt = input;

  if (options.lobeHubContext) {
    // Reuse the private, content-addressed portable SKILL.md. Pi loads only
    // that file, not the accompanying Claude Code plugin manifest.
    const pluginDir = await resolveLobeHubCliPluginDir();
    if (!pluginDir) {
      throw new Error(
        'Cannot prepare the LobeHub skill for Pi. Check access to the temporary and user cache directories, then retry.',
      );
    }
    const skillPath = path.join(pluginDir, 'skills', LOBEHUB_CLI_SKILL_NAME, 'SKILL.md');
    // Explicit skills also load with --no-skills, including on resume. The
    // content-addressed path must stay in the desktop pool's spawn fingerprint.
    args = ['--skill', skillPath, ...args];
    prompt = omitLobeHubCliGuide(input);
  }

  return { args, prompt: await toPiRpcPrompt(prompt, options) };
};
