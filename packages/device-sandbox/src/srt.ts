import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

import { normalizeSandboxPolicy } from './policy';
import type { SandboxPolicy } from './types';

export const createSrtConfig = (input: SandboxPolicy): SandboxRuntimeConfig => {
  const policy = normalizeSandboxPolicy(input);

  return {
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
