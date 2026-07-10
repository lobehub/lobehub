import debug from 'debug';

import { appEnv } from '@/envs/app';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { isDev } from '@/utils/env';

const log = debug('lobe-server:lh-command');

export interface PreprocessResult {
  command: string;
  error?: string;
  isLhCommand: boolean;
  skipSkillLookup: boolean;
}

/**
 * Detect and preprocess `lh` CLI commands.
 * - Replaces `lh` with `npx -y @lobehub/cli`
 * - Injects LOBEHUB_JWT, LOBEHUB_SERVER, and optional workspace scope env vars
 * - Signals caller to skip skill DB lookup
 */
export const preprocessLhCommand = async (
  command: string,
  userId: string,
  workspaceId?: string,
): Promise<PreprocessResult> => {
  // Match `lh` at the start of the command or after shell operators (&&, ||, ;)
  const lhPattern = /(?:^|&&|\|\||;)\s*lh(?:\s|$)/;
  const isLhCommand = lhPattern.test(command);

  if (!isLhCommand) {
    return { command, isLhCommand: false, skipSkillLookup: false };
  }

  try {
    const jwt = await signUserJWT(userId);

    const serverUrl = isDev ? 'https://app.lobehub.com' : appEnv.APP_URL;

    const envParts = [`LOBEHUB_JWT=${jwt}`, `LOBEHUB_SERVER=${serverUrl}`];
    if (workspaceId) envParts.push(`LOBEHUB_WORKSPACE_ID=${workspaceId}`);
    const envPrefix = envParts.join(' ');

    // Replace `lh` in all sub-commands separated by &&, ||, or ;
    const rewritten = command.replaceAll(
      /(^|&&|\|\||;)(\s*)lh(\s|$)/g,
      `$1$2${envPrefix} npx -y @lobehub/cli$3`,
    );
    const finalCommand = rewritten;

    log(
      'Intercepted lh command for user %s, rewritten to: %s',
      userId,
      finalCommand.replace(jwt, '<redacted>'),
    );

    return { command: finalCommand, isLhCommand: true, skipSkillLookup: true };
  } catch (error) {
    log('Failed to sign user JWT for lh command: %O', error);
    return {
      command,
      error: 'Failed to authenticate for CLI execution',
      isLhCommand: true,
      skipSkillLookup: true,
    };
  }
};
