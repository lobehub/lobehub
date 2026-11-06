import type { ShellWorkScanner } from './types';

export const artboardShellWorkScanner: ShellWorkScanner = {
  matches: (command) => command.includes('artboard create'),
  name: 'artboard',
  register: ({ workModel, ...input }) => workModel.registerShellArtboardResult(input),
};
