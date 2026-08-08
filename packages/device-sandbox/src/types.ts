export type SandboxBackend = 'none' | 'srt';

export type SandboxUnavailableBehavior = 'deny' | 'warn-allow';

export type SandboxEnvironment = Record<string, string | undefined>;

export interface SandboxPolicy {
  allowedNetworkDomains?: readonly string[];
  allowNetwork: boolean;
  deniedReadRoots?: readonly string[];
  deniedWriteRoots?: readonly string[];
  envAllowlist?: readonly string[];
  onUnavailable: SandboxUnavailableBehavior;
  readableRoots?: readonly string[];
  writableRoots: readonly string[];
}

export interface SandboxCapability {
  available: boolean;
  backend: SandboxBackend;
  networkIsolation: boolean;
  reason?: string;
  warnings?: string[];
}

export interface SandboxCommand {
  args: string[];
  cmd: string;
}

export interface SandboxLaunchPlan extends SandboxCommand {
  capability: SandboxCapability;
  env: SandboxEnvironment;
  release?: () => void;
  sandboxed: boolean;
  warning?: string;
}

export interface CreateSandboxLaunchPlanOptions {
  capability?: SandboxCapability;
  command: SandboxCommand;
  cwd?: string;
  env?: SandboxEnvironment;
  platform?: NodeJS.Platform;
  policy: SandboxPolicy;
}

export type SandboxErrorCode =
  'SANDBOX_BUSY' | 'SANDBOX_POLICY_CONFLICT' | 'SANDBOX_POLICY_INVALID' | 'SANDBOX_UNAVAILABLE';

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;

  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SandboxError';
  }
}
