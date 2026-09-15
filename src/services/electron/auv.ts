import { type AuvRunCommandParams } from '@lobechat/builtin-tool-auv';

import { ensureElectronIpc } from '@/utils/electron/ipc';

export const electronAuvService = {
  runCommand: (params: AuvRunCommandParams) => ensureElectronIpc().auv.runCommand(params),
};
