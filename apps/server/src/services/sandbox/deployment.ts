import { sandboxEnv } from '@/envs/sandbox';

import type { SandboxProviderKind } from './types';

export const getSandboxProviderKind = (): SandboxProviderKind =>
  sandboxEnv.SANDBOX_PROVIDER || 'market';

export type SandboxDeployment = 'boxd' | 'market' | 'onlyboxes' | 'unconfigured';

/** The sandbox this deployment runs commands in; `unconfigured` when its provider lacks settings. */
export const getSandboxDeployment = (): SandboxDeployment => {
  switch (getSandboxProviderKind()) {
    case 'boxd': {
      return sandboxEnv.BOXD_API_KEY ? 'boxd' : 'unconfigured';
    }

    case 'onlyboxes': {
      return sandboxEnv.ONLYBOXES_BASE_URL && sandboxEnv.ONLYBOXES_JIT_SIGNING_KEY
        ? 'onlyboxes'
        : 'unconfigured';
    }

    case 'market': {
      return 'market';
    }
  }
};
