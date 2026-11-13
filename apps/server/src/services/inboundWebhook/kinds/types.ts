import type { InboundWebhookModel, InboundWebhookView } from '@/database/models/inboundWebhook';
import type { SignalItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export interface InboundWebhookContext {
  db: LobeChatDatabase;
  model: InboundWebhookModel;
  row: InboundWebhookView;
}
export interface NormalizedWebhookEvent {
  control?: 'gap' | 'terminated';
  cursor?: string | null;
  data: Record<string, unknown>;
  eventId: string;
  name: string;
  timestamp: string;
}
export interface DeliveryResult {
  event?: NormalizedWebhookEvent;
  response?: Record<string, unknown>;
  status?: 200 | 400 | 410;
}
export interface InboundWebhookKindHandler {
  buildPrompt: (params: {
    connector: { identifier: string; name: string };
    row: InboundWebhookView;
    signals: SignalItem[];
  }) => string;
  handleDelivery: (
    ctx: InboundWebhookContext,
    body: unknown,
    deliveryId: string,
  ) => Promise<DeliveryResult>;
  maintain?: (ctx: InboundWebhookContext) => Promise<void>;
  teardown?: (ctx: InboundWebhookContext) => Promise<void>;
}
