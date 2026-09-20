// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import { scmWebhookDeliveries, users } from '@/database/schemas';
import * as fx from '@/server/services/scm/github/__tests__/fixtures';
import { signGitHubPayload } from '@/server/services/scm/github/signature';

import { githubWebhook } from '../github';

const serverDB = await getTestDB();
const secret = 'webhook-secret';
const userId = 'scm-webhook-user';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => serverDB),
}));

vi.mock('@/envs/scm', () => ({
  scmEnv: { ENABLED_GITHUB_APP: true, GITHUB_APP_WEBHOOK_SECRET: 'webhook-secret' },
}));

const app = new Hono().post('/github', githubWebhook);

const deliver = (
  event: string,
  payload: Record<string, unknown>,
  options: { deliveryId?: string; signature?: string } = {},
) => {
  const body = JSON.stringify(payload);
  return app.request('/github', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': options.deliveryId ?? `delivery-${Math.random()}`,
      'x-github-event': event,
      'x-hub-signature-256': options.signature ?? signGitHubPayload(body, secret),
    },
    method: 'POST',
  });
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await ScmInstallationModel.bind(serverDB, {
    accountExternalId: '1',
    accountLogin: 'lobehub',
    accountType: 'organization',
    installationId: String(fx.installation.id),
    provider: 'github',
    repositorySelection: 'all',
    userId,
  });
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(users);
});

describe('githubWebhook', () => {
  it('rejects a bad signature before touching the database', async () => {
    const res = await deliver('pull_request', fx.pullRequestEvent('opened'), {
      signature: 'sha256=deadbeef',
    });
    expect(res.status).toBe(401);
    expect(await serverDB.select().from(scmWebhookDeliveries)).toHaveLength(0);
  });

  it('rejects a delivery without event headers', async () => {
    const body = JSON.stringify(fx.pullRequestEvent('opened'));
    const res = await app.request('/github', {
      body,
      headers: { 'x-hub-signature-256': signGitHubPayload(body, secret) },
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  it('processes a signed delivery once and answers duplicates without re-applying', async () => {
    const first = await deliver('pull_request', fx.pullRequestEvent('opened'), {
      deliveryId: 'd-1',
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, status: 'processed' });

    const row = await ScmChangeRequestModel.findByIdentity(
      serverDB,
      'github',
      'lobehub/lobehub',
      19_719,
    );
    expect(row?.state).toBe('open');

    const again = await deliver(
      'pull_request',
      fx.pullRequestEvent('closed', { state: 'closed' }),
      {
        deliveryId: 'd-1',
      },
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(
      (await ScmChangeRequestModel.findByIdentity(serverDB, 'github', 'lobehub/lobehub', 19_719))
        ?.state,
    ).toBe('open');

    const ledger = await serverDB.select().from(scmWebhookDeliveries);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      action: 'opened',
      event: 'pull_request',
      status: 'processed',
    });
  });

  it('records ignored events as skipped with the reason', async () => {
    const res = await deliver('ping', { zen: 'Keep it logically awesome.' }, { deliveryId: 'd-2' });
    expect(res.status).toBe(200);
    const [ledger] = await serverDB.select().from(scmWebhookDeliveries);
    expect(ledger).toMatchObject({ status: 'skipped' });
    expect(ledger.error).toContain('not tracked');
  });
});
