import type { CoreManifest } from '@/core/infrastructure/coreOta/manifest';

export interface ShellGlobal {
  readonly abi: string;
  readonly builtinDir: string;
  readonly coreDir: string;
  readonly log: string[];
  readonly manifest: CoreManifest | null;
  readonly markHealthy: () => void;
  readonly publicKey: string;
  readonly shellVersion: string;
  readonly source: 'builtin' | 'external';
}

declare global {
  var __SHELL__: ShellGlobal | undefined;
}

export const shellInfo: ShellGlobal | undefined = globalThis.__SHELL__;
