import { realpathSync } from 'node:fs';
import path from 'node:path';

import type { SandboxPolicy } from './types';
import { SandboxError } from './types';

export const normalizeWritableRoots = (roots: readonly string[]): string[] => {
  const normalized = roots.map((root) => {
    if (!path.isAbsolute(root)) {
      throw new SandboxError(
        'SANDBOX_POLICY_INVALID',
        `Sandbox writable root must be absolute: ${root}`,
      );
    }

    try {
      return realpathSync.native(path.resolve(root));
    } catch {
      throw new SandboxError(
        'SANDBOX_POLICY_INVALID',
        `Sandbox writable root must exist and be resolvable: ${root}`,
      );
    }
  });

  return [...new Set(normalized)].sort();
};

export const normalizeSandboxPolicy = (policy: SandboxPolicy): SandboxPolicy => {
  if (policy.allowNetwork && !policy.allowedNetworkDomains?.length) {
    throw new SandboxError(
      'SANDBOX_POLICY_INVALID',
      'Sandbox network access requires an explicit non-empty domain allowlist',
    );
  }

  return {
    ...policy,
    allowedNetworkDomains: policy.allowedNetworkDomains
      ? [...new Set(policy.allowedNetworkDomains)].sort()
      : undefined,
    deniedReadRoots: policy.deniedReadRoots
      ? normalizeWritableRoots(policy.deniedReadRoots)
      : undefined,
    deniedWriteRoots: policy.deniedWriteRoots
      ? normalizeWritableRoots(policy.deniedWriteRoots)
      : undefined,
    envAllowlist: policy.envAllowlist ? [...new Set(policy.envAllowlist)].sort() : undefined,
    readableRoots: policy.readableRoots ? normalizeWritableRoots(policy.readableRoots) : undefined,
    writableRoots: normalizeWritableRoots(policy.writableRoots),
  };
};
