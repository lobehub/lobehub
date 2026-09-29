// @vitest-environment node
/**
 * Optional live check against the real dashboard sandbox Worker. Skipped unless
 * both variables are set; inject the token from a local file, never inline it:
 *
 *   DASHBOARD_SANDBOX_URL=https://<worker>.workers.dev \
 *   DASHBOARD_SANDBOX_TOKEN="$(cat /path/to/token)" \
 *   bunx vitest run apps/server/src/services/dashboard/__tests__/sandboxRunner.live.test.ts
 *
 * Node's fetch ignores HTTPS_PROXY; behind a proxy also set NODE_USE_ENV_PROXY=1.
 */
import { describe, expect, it } from 'vitest';

import { parseWidgetOutput } from '../outputContract';
import { redactSecrets } from '../redact';
import { DashboardSandboxRunner } from '../sandboxRunner';

const url = process.env.DASHBOARD_SANDBOX_URL;
const token = process.env.DASHBOARD_SANDBOX_TOKEN;

describe.skipIf(!url || !token)('DashboardSandboxRunner (live Worker)', () => {
  const runner = new DashboardSandboxRunner({ token, url });

  it('echoes a stat through the real sandbox with an injected env', async () => {
    const env = { ECHO_SECRET: 'live-echo-secret-value' };
    const result = await runner.run({
      env,
      runtime: 'bash',
      script: [
        'echo "debug: $ECHO_SECRET" >&2',
        `echo '{"type":"stat","label":"echo","value":42}'`,
      ].join('\n'),
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(parseWidgetOutput(result.stdout, 'stat')).toMatchObject({
      ok: true,
      output: { label: 'echo', type: 'stat', value: 42 },
    });
    expect(redactSecrets(result.stderr, env).trim()).toBe('debug: [REDACTED:ECHO_SECRET]');
  }, 120_000);

  it('reports a non-zero exit from the real sandbox', async () => {
    const result = await runner.run({ runtime: 'bash', script: 'echo oops >&2; exit 3' });

    expect(result).toMatchObject({ exitCode: 3, timedOut: false });
    expect(result.stderr.trim()).toBe('oops');
  }, 120_000);
});
