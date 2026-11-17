import type { InboundWebhookItem } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { inboundWebhookService } from '@/services/inboundWebhook';

/** SWR key of the webhook an approval card is about; the active workspace is added by the hook. */
const WEBHOOK_TARGET_SWR_KEY = 'lobe-webhook-target';

/**
 * The webhook an update or delete names, read from the server rather than from the model's
 * arguments, so the approval card names the webhook it really acts on.
 */
export const useWebhookTarget = (webhookId: string | undefined) =>
  useClientDataSWR<InboundWebhookItem>(
    webhookId ? [WEBHOOK_TARGET_SWR_KEY, webhookId] : null,
    () => inboundWebhookService.get(webhookId!),
    { revalidateOnFocus: false },
  );
