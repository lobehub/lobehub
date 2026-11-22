import type { ShellWorkScanner } from './types';

export const artboardShellWorkScanner: ShellWorkScanner = {
  matches: (command) => /artboard (?:create|update)\b/.test(command),
  name: 'artboard',
  register: ({ workModel, ...input }) => workModel.registerShellArtboardResult(input),
};
