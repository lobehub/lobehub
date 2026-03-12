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
 * - Injects LOBEHUB_JWT and LOBEHUB_SERVER env vars
 * - Signals caller to skip skill DB lookup
 */
export const preprocessLhCommand = async (
  command: string,
  userId: string,
): Promise<PreprocessResult> => {
  const isLhCommand = /^lh\s/.test(command) || command === 'lh';

  if (!isLhCommand) {
    return { command, isLhCommand: false, skipSkillLookup: false };
  }

  try {
    const jwt = await signUserJWT(userId);

    const serverUrl = isDev ? 'https://app.lobehub.com' : appEnv.APP_URL;

    const rewritten = command.replace(/^lh/, 'npx -y @lobehub/cli');
    const finalCommand = `LOBEHUB_JWT=${jwt} LOBEHUB_SERVER=${serverUrl} ${rewritten}`;

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
