import { SandboxManager } from '@anthropic-ai/sandbox-runtime';

import type { SandboxCapability } from './types';

export const probeSandboxCapability = async (): Promise<SandboxCapability> => {
  if (!SandboxManager.isSupportedPlatform()) {
    return {
      available: false,
      backend: 'none',
      networkIsolation: false,
      reason: `Sandbox Runtime does not support ${process.platform}`,
    };
  }

  const dependencies = SandboxManager.checkDependencies();
  if (dependencies.errors.length > 0) {
    return {
      available: false,
      backend: 'none',
      networkIsolation: false,
      reason: `Sandbox Runtime dependencies are unavailable: ${dependencies.errors.join(', ')}`,
      warnings: dependencies.warnings,
    };
  }

  return {
    available: true,
    backend: 'srt',
    networkIsolation: true,
    warnings: dependencies.warnings,
  };
};
