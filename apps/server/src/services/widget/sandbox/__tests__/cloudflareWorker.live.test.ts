// @vitest-environment node
/**
 * Optional live check against the real widget sandbox Worker. Skipped unless
 * both variables are set; inject the token from a local file, never inline it:
 *
 *   WIDGET_SANDBOX_URL=https://<worker>.workers.dev \
 *   WIDGET_SANDBOX_TOKEN="$(cat /path/to/token)" \
 *   bunx vitest run apps/server/src/services/widget/sandbox/__tests__/cloudflareWorker.live.test.ts
 *
 * Node's fetch ignores HTTPS_PROXY; behind a proxy also set NODE_USE_ENV_PROXY=1.
 */
import { describe, expect, it } from 'vitest';

import { parseWidgetOutput } from '../../outputContract';
import { redactSecrets } from '../../redact';
import { CloudflareWorkerSandboxRunner } from '../cloudflareWorker';

const url = process.env.WIDGET_SANDBOX_URL;
const token = process.env.WIDGET_SANDBOX_TOKEN;

describe.skipIf(!url || !token)('CloudflareWorkerSandboxRunner (live Worker)', () => {
  const runner = new CloudflareWorkerSandboxRunner({
    networkFormat:
      process.env.WIDGET_SANDBOX_NETWORK_FORMAT === 'boolean' ? 'boolean' : 'allowlist',
    token,
    url,
  });

  it('echoes a stat through the real sandbox with an injected env', async () => {
    const env = { ECHO_SECRET: 'live-echo-secret-value' };
    const result = await runner.run({
      env,
      network: { allow: [] },
      runtime: 'bash',
      script: [
        'echo "debug: $ECHO_SECRET" >&2',
        `echo '{"type":"stat","label":"echo","value":42}'`,
      ].join('\n'),
      subject: { id: 'live-check', kind: 'widget' },
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
    const result = await runner.run({
      env: {},
      network: { allow: [] },
      runtime: 'bash',
      script: 'echo oops >&2; exit 3',
      subject: { id: 'live-check', kind: 'widget' },
    });

    expect(result).toMatchObject({ exitCode: 3, timedOut: false });
    expect(result.stderr.trim()).toBe('oops');
  }, 120_000);
});
