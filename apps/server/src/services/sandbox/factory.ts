import { getSandboxProviderKind } from './deployment';
import { MarketSandboxProvider } from './providers/market';
import { OnlyboxesSandboxProvider } from './providers/onlyboxes';
import { SandboxMiddlewareService } from './service';
import type { SandboxProvider, SandboxService, SandboxServiceOptions } from './types';

const createSandboxProvider = (options: SandboxServiceOptions): SandboxProvider => {
  switch (getSandboxProviderKind()) {
    case 'onlyboxes': {
      return new OnlyboxesSandboxProvider(options);
    }

    case 'market': {
      return new MarketSandboxProvider(options);
    }
  }
};

export const createSandboxService = (options: SandboxServiceOptions): SandboxService => {
  return new SandboxMiddlewareService(createSandboxProvider(options), options);
};
