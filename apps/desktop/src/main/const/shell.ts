import type { CoreManifest } from '@/core/infrastructure/coreOta/manifest';

export interface StartupUpdateProgress {
  phase: 'checking' | 'downloading' | 'applying';
  received?: number;
  total?: number;
}

export interface SecurityUpdateCheck {
  check: () => Promise<boolean>;
  isInstallerSafe: (version: string) => boolean;
}

export type StartupUpdateOutcome = 'ready' | 'relaunch' | 'full-update';

export interface ShellGlobal {
  readonly abi: string;
  readonly builtinDir: string;
  readonly coreDir: string;
  readonly coreProtocol?: 4;
  readonly log: string[];
  readonly manifest: CoreManifest | null;
  readonly markHealthy: () => void;
  readonly publicKey: string;
  readonly shellVersion: string;
  readonly source: 'builtin' | 'external';
  readonly startupUpdate?: {
    checkSecurity: (security: SecurityUpdateCheck) => Promise<boolean>;
    pending: boolean;
    run: (
      check: (update: (state: StartupUpdateProgress) => void) => Promise<StartupUpdateOutcome>,
    ) => Promise<boolean>;
  };
}

declare global {
  var __SHELL__: ShellGlobal | undefined;
}

export const shellInfo: ShellGlobal | undefined = globalThis.__SHELL__;
