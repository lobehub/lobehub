import debug from 'debug';

import type { PlatformClient } from '@/server/services/bot/platforms';

import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../types';

const log = debug('lobe-server:messenger:slack');

/**
 * Application prefix on Slack `action_id`s so we can distinguish OUR buttons
 * from anything else the workspace might inject. Format:
 * `messenger:<verb>:<arg>` — mirrors the Telegram binder's `callback_data`
 * convention so the router can reuse the same matcher.
 */
const ACTION_PREFIX = 'messenger:';

/**
 * **PR1 intermediate state (LOBE-8442 / LOBE-8445)**: this binder is wired
 * through but disabled — `createClient()` returns null so the router never
 * registers a Slack chat-bot. The reason: `LOBE_SLACK_BOT_TOKEN` env was
 * removed in favour of OAuth-acquired per-workspace tokens stored in
 * `messenger_installations`. PR2 (LOBE-8443 / LOBE-8453) rebuilds this binder
 * to receive `InstallationCredentials` from the `MessengerInstallationStore`
 * and restores live inbound routing. The picker / callback-extraction logic
 * below is preserved so PR2 can wire it back up against per-install creds.
 */
export class MessengerSlackBinder implements MessengerPlatformBinder {
  createClient(): PlatformClient | null {
    log('createClient: Slack binder is OAuth-only; PR2 will wire per-install credentials');
    return null;
  }

  /**
   * Slack delivers events to a webhook URL configured in the Slack App
   * settings UI ("Event Subscriptions" → "Request URL"); there is no API to
   * register it programmatically. We log so operators can confirm the URL
   * the bot expects matches what's configured upstream.
   */
  async registerWebhook(params: { webhookUrl: string }): Promise<void> {
    log(
      'registerWebhook: slack webhook URL must be set in the Slack App console -> %s',
      params.webhookUrl,
    );
  }

  async handleUnlinkedMessage(_ctx: UnlinkedMessageContext): Promise<void> {
    log('handleUnlinkedMessage: disabled in PR1 — see LOBE-8453 for the rebuild');
  }

  async notifyLinkSuccess(_params: {
    activeAgentName?: string;
    platformUserId: string;
  }): Promise<void> {
    log('notifyLinkSuccess: disabled in PR1 — see LOBE-8453 for the rebuild');
  }

  async sendDmText(_chatId: string, _text: string): Promise<void> {
    log('sendDmText: disabled in PR1 — see LOBE-8453 for the rebuild');
  }

  async sendAgentPicker(
    _chatId: string,
    _params: { entries: AgentPickerEntry[]; text: string },
  ): Promise<void> {
    log('sendAgentPicker: disabled in PR1 — see LOBE-8453 for the rebuild');
  }

  /**
   * Pull our `messenger:switch:<agentId>` action out of a Slack interactive
   * webhook payload. Slack delivers `block_actions` as
   * `application/x-www-form-urlencoded` with a single `payload` field whose
   * value is JSON, so we have to parse the body here rather than relying on
   * the router's JSON-only path. Returns null for any other update so the
   * caller can hand off to chat-sdk.
   *
   * Stays live in PR1: this function reads the request body only and doesn't
   * need bot credentials — PR2 just plugs the resulting action into the
   * per-install router.
   */
  async extractCallbackAction(req: Request): Promise<InboundCallbackAction | null> {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/x-www-form-urlencoded')) return null;

    let payload: any;
    try {
      const raw = await req.text();
      const params = new URLSearchParams(raw);
      const payloadStr = params.get('payload');
      if (!payloadStr) return null;
      payload = JSON.parse(payloadStr);
    } catch {
      return null;
    }

    if (!payload || payload.type !== 'block_actions') return null;
    const action = payload.actions?.[0];
    const actionId = action?.action_id ? String(action.action_id) : '';
    if (!actionId.startsWith(ACTION_PREFIX)) return null;

    const fromUserId = payload.user?.id ? String(payload.user.id) : '';
    // For DMs the channel id is in `payload.channel.id`; for app-home or some
    // surfaces it can be missing — we only support DM-channel pickers today.
    const chatId = payload.channel?.id ? String(payload.channel.id) : '';
    const messageTs = payload.message?.ts ? String(payload.message.ts) : undefined;
    if (!fromUserId || !chatId) return null;

    return {
      // `response_url` is what we use to ack — Slack accepts up to 5 calls
      // within 30 minutes per response_url and applies the update to the
      // exact message that triggered the action.
      callbackId: payload.response_url ? String(payload.response_url) : '',
      chatId,
      data: actionId,
      fromUserId,
      messageId: messageTs,
    };
  }

  async acknowledgeCallback(
    _action: InboundCallbackAction,
    _ack: CallbackAcknowledgement,
  ): Promise<void> {
    log('acknowledgeCallback: disabled in PR1 — see LOBE-8453 for the rebuild');
  }
}
