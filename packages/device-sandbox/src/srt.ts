import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { getSrtWinPath } from '@anthropic-ai/sandbox-runtime';

import { normalizeSandboxPolicy } from './policy';
import { resolveEffectiveSrtWin } from './srtWinStaging';
import type { SandboxPolicy } from './types';

/**
 * Point the backend at the same helper the capability probe validated. See
 * {@link resolveEffectiveSrtWin} — leaving the backend to resolve its own
 * package-relative path lands inside `app.asar` once bundled, and a per-user
 * install puts the shipped copy somewhere the sandbox account cannot read.
 *
 * Silent no-op off Windows, and when no helper can be found at all — the
 * backend then fails loudly at launch rather than being told a path that does
 * not exist.
 */
const resolveWindowsConfig = (): SandboxRuntimeConfig['windows'] => {
  if (process.platform !== 'win32') return undefined;
  try {
    const path = resolveEffectiveSrtWin(getSrtWinPath);
    return path ? { srtWin: { path } } : undefined;
  } catch {
    return undefined;
  }
};

export const createSrtConfig = (input: SandboxPolicy): SandboxRuntimeConfig => {
  const policy = normalizeSandboxPolicy(input);
  const windows = resolveWindowsConfig();

  return {
    ...(windows ? { windows } : {}),
    filesystem: {
      allowRead: [...(policy.readableRoots ?? [])],
      allowWrite: [...policy.writableRoots],
      allowGitConfig: false,
      denyRead: [...(policy.deniedReadRoots ?? [])],
      denyWrite: [...(policy.deniedWriteRoots ?? [])],
    },
    network: {
      allowedDomains: policy.allowNetwork ? [...(policy.allowedNetworkDomains ?? [])] : [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
      allowUnixSockets: [],
      deniedDomains: [],
      strictAllowlist: true,
    },
    allowAppleEvents: false,
    allowPty: false,
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
  };
};
