import type { BuiltinManifestResolver } from '@lobechat/types';

import { LocalSystemManifest, READ_FILE_DESCRIPTION } from './manifest';
import { systemPrompt as desktopSystemPrompt } from './systemRole.desktop';
import { LocalSystemApiName } from './types';

/**
 * Image reads are currently implemented only by the Desktop local IPC path.
 * Device runs use local-file-shell, which rejects binary image files, so their
 * manifest must not instruct the model to call an unsupported capability.
 */
export const resolveLocalSystemManifest: BuiltinManifestResolver = (context) => {
  if (context.executionEnv === 'local') {
    return { ...LocalSystemManifest, systemRole: desktopSystemPrompt };
  }

  if (context.executionEnv !== 'device' && context.executionEnv !== 'device-unrouted') {
    return LocalSystemManifest;
  }

  return {
    ...LocalSystemManifest,
    api: LocalSystemManifest.api.map((api) =>
      api.name === LocalSystemApiName.readFile
        ? { ...api, description: READ_FILE_DESCRIPTION }
        : api,
    ),
  };
};
