import { sandboxEnv } from '@/envs/sandbox';

import { CloudflareWorkerSandboxRunner } from './cloudflareWorker';
import type { WidgetSandboxRunner } from './types';

/**
 * The widget sandbox selected by env (`WIDGET_SANDBOX_PROVIDER`, default
 * `cloudflare-worker`). An unconfigured provider still returns a runner; its
 * runs fail with `SANDBOX_NOT_CONFIGURED`, which closes the run as `failed`.
 */
export const createWidgetSandboxRunner = (): WidgetSandboxRunner => {
  switch (sandboxEnv.WIDGET_SANDBOX_PROVIDER ?? 'cloudflare-worker') {
    case 'cloudflare-worker': {
      return new CloudflareWorkerSandboxRunner({
        networkFormat: sandboxEnv.WIDGET_SANDBOX_NETWORK_FORMAT,
        token: sandboxEnv.WIDGET_SANDBOX_TOKEN,
        url: sandboxEnv.WIDGET_SANDBOX_URL,
      });
    }
  }
};

export { CloudflareWorkerSandboxRunner } from './cloudflareWorker';
export * from './types';
