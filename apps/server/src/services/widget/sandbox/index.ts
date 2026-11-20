import { MarketWidgetSandboxRunner } from './market';
import type { WidgetSandboxRunner } from './types';

/**
 * The widget sandbox: Market's one-shot run endpoint. Without Market
 * trusted-client credentials it still returns a runner; its runs fail with
 * `SANDBOX_NOT_CONFIGURED`, which closes the run as `failed`.
 */
export const createWidgetSandboxRunner = (): WidgetSandboxRunner => new MarketWidgetSandboxRunner();

export { MarketWidgetSandboxRunner } from './market';
export * from './types';
