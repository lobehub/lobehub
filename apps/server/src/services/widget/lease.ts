import type { WidgetManifest } from '@lobechat/types';

import { clampSandboxTimeout, WIDGET_SANDBOX_REQUEST_OVERHEAD_MS } from './sandbox/types';

/** Slack on top of the sandbox bounds before a reserved run counts as abandoned. */
export const WIDGET_RUN_LEASE_MARGIN_MS = 60_000;
/**
 * How long a worker may hold a reserved run before another worker
 * may take it over: the version's (clamped) script timeout, plus what the
 * sandbox request may add on top, plus a margin for credential resolution
 * and closing the run.
 */
export const widgetRunLeaseMs = (manifest?: Pick<WidgetManifest, 'timeoutMs'> | null) =>
  clampSandboxTimeout(manifest?.timeoutMs) +
  WIDGET_SANDBOX_REQUEST_OVERHEAD_MS +
  WIDGET_RUN_LEASE_MARGIN_MS;
