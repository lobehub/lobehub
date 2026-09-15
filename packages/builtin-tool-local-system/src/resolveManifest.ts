import type { BuiltinManifestResolver } from '@lobechat/types';

import { IMAGE_CAPABLE_READ_FILE_DESCRIPTION, LocalSystemManifest } from './manifest';
import { systemPrompt as desktopSystemPrompt } from './systemRole.desktop';
import { LocalSystemApiName } from './types';

/**
 * Image reads are currently implemented only by the Desktop local IPC path.
 * Device runs use local-file-shell, which rejects binary image files, so their
 * manifest must not instruct the model to call an unsupported capability.
 */
export const resolveLocalSystemManifest: BuiltinManifestResolver = (context) => {
  if (context.executionEnv !== 'local') {
    return LocalSystemManifest;
  }

  return {
    ...LocalSystemManifest,
    api: LocalSystemManifest.api.map((api) =>
      api.name === LocalSystemApiName.readFile
        ? { ...api, description: IMAGE_CAPABLE_READ_FILE_DESCRIPTION }
        : api,
    ),
    systemRole: desktopSystemPrompt,
  };
};
