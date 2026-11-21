import type { SelfWebhookForwardResult } from '../../selfWebhook';

/** The private `@chat-adapter/discord` surface (checked against 4.38.x) this patch replaces. */
interface GatewayForwardingAdapter {
  forwardGatewayEvent: (webhookUrl: string, event: unknown) => Promise<void>;
  resolveBotToken: () => Promise<string>;
}

const isGatewayForwardingAdapter = (adapter: unknown): adapter is GatewayForwardingAdapter =>
  !!adapter &&
  typeof adapter === 'object' &&
  typeof (adapter as GatewayForwardingAdapter).forwardGatewayEvent === 'function' &&
  typeof (adapter as GatewayForwardingAdapter).resolveBotToken === 'function';

/**
 * In webhook-forwarding mode the Gateway listener hands every event to
 * `adapter.forwardGatewayEvent`, which POSTs it to the webhook route and only
 * logs a failure — the caller cannot tell that every message is being
 * dropped. Replace it on this adapter instance with the same request, plus a
 * report of each outcome.
 *
 * Returns false (and leaves the adapter alone) when the adapter no longer has
 * the expected shape, so an upgrade degrades to the library's own logging
 * instead of breaking forwarding.
 */
export const patchDiscordGatewayForwarding = (
  adapter: unknown,
  onForwardResult: (result: SelfWebhookForwardResult) => void,
): boolean => {
  if (!isGatewayForwardingAdapter(adapter)) return false;

  adapter.forwardGatewayEvent = async (webhookUrl, event) => {
    let result: SelfWebhookForwardResult;
    try {
      const botToken = await adapter.resolveBotToken();
      const response = await fetch(webhookUrl, {
        body: JSON.stringify(event),
        headers: {
          'Content-Type': 'application/json',
          'x-discord-gateway-token': botToken,
        },
        method: 'POST',
      });
      result = { ok: response.ok, status: response.status };
    } catch (error) {
      result = { error, ok: false };
    }
    onForwardResult(result);
  };

  return true;
};
