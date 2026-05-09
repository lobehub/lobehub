import debug from 'debug';

import { getMessengerSlackConfig } from '@/config/messenger';

import { getInstallationStore } from '../../installations';
import { verifySignature as verifySlackSignature } from '../../oauth/slackOAuth';
import type { MessengerPlatformWebhookGate } from '../types';

const log = debug('lobe-server:messenger:slack:webhook-gate');

/**
 * Slack lifecycle events we treat specially before falling into normal
 * routing. Both indicate the install is gone — flag the row revoked so
 * subsequent webhooks short-circuit, and acknowledge with 200 (no retries).
 */
const SLACK_LIFECYCLE_EVENTS = new Set(['app_uninstalled', 'tokens_revoked']);

const isSlackLifecycleEvent = (rawBody: string): { eventType: string } | null => {
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed?.type !== 'event_callback') return null;
    const eventType = parsed?.event?.type;
    if (typeof eventType === 'string' && SLACK_LIFECYCLE_EVENTS.has(eventType)) {
      return { eventType };
    }
  } catch {
    /* not JSON / not an Events API payload — fall through */
  }
  return null;
};

/** Slack `url_verification` is the once-only setup challenge; reply with the challenge value. */
const handleSlackUrlVerification = (rawBody: string): Response | null => {
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed?.type === 'url_verification' && typeof parsed?.challenge === 'string') {
      return new Response(parsed.challenge, {
        headers: { 'Content-Type': 'text/plain' },
        status: 200,
      });
    }
  } catch {
    /* ignore */
  }
  return null;
};

const handleSlackLifecycleEvent = async (
  rawBody: string,
  eventType: string,
  invalidateBot: (installationKey: string) => void,
): Promise<void> => {
  try {
    const parsed = JSON.parse(rawBody);
    const auth = Array.isArray(parsed.authorizations) ? parsed.authorizations[0] : null;
    const isEnterprise =
      auth?.is_enterprise_install === true || parsed.is_enterprise_install === true;
    const tenantId = isEnterprise
      ? (auth?.enterprise_id ?? parsed.enterprise_id)
      : (auth?.team_id ?? parsed.team_id);
    if (!tenantId) {
      log('lifecycle %s: missing tenant id, skipping', eventType);
      return;
    }
    const installationKey = `slack:${tenantId}`;
    const store = getInstallationStore('slack');
    if (store?.markRevoked) {
      await store.markRevoked(installationKey);
    }
    // Drop the cached bot so a re-install (which clears `revoked_at`) gets
    // a fresh Chat SDK instance with the new token.
    invalidateBot(installationKey);
    log('lifecycle %s: revoked install %s', eventType, installationKey);
  } catch (error) {
    log('lifecycle %s: failed to process: %O', eventType, error);
  }
};

/**
 * Slack-specific webhook preprocessing. Runs before the router's shared
 * install-resolution + chat-sdk dispatch path.
 *
 *   1. Require the configured signing secret (no config → 404)
 *   2. Verify `x-slack-signature` over the raw body
 *   3. Handle the once-only `url_verification` challenge
 *   4. Short-circuit `app_uninstalled` / `tokens_revoked` lifecycle events
 *      by marking the install revoked and dropping the cached bot
 *
 * Returns a `Response` to short-circuit the router, or `null` to continue
 * with normal install resolution + chat-sdk dispatch.
 */
export const slackWebhookGate: MessengerPlatformWebhookGate = {
  preprocess: async (req, rawBody, ctx) => {
    const config = await getMessengerSlackConfig();
    if (!config) {
      return new Response('Slack messenger not configured', { status: 404 });
    }

    const ts = req.headers.get('x-slack-request-timestamp');
    const sig = req.headers.get('x-slack-signature');
    if (!ts || !sig) {
      log('webhook: missing Slack signature headers');
      return new Response('missing signature', { status: 401 });
    }
    const ok = verifySlackSignature({
      rawBody,
      signature: sig,
      signingSecret: config.signingSecret,
      timestamp: ts,
    });
    if (!ok) {
      log('webhook: invalid Slack signature');
      return new Response('invalid signature', { status: 401 });
    }

    const verification = handleSlackUrlVerification(rawBody);
    if (verification) return verification;

    const lifecycle = isSlackLifecycleEvent(rawBody);
    if (lifecycle) {
      await handleSlackLifecycleEvent(rawBody, lifecycle.eventType, ctx.invalidateBot);
      return new Response('OK', { status: 200 });
    }

    return null;
  },
};
