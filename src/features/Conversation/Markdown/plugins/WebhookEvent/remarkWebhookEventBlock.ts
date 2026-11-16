import { WEBHOOK_EVENT_TAG } from '@/const/plugin';

import { createRemarkXmlBlockPlugin } from '../remarkPlugins/createRemarkXmlBlockPlugin';

/** Captures `<webhookEvent …>…</webhookEvent>` blocks; see {@link createRemarkXmlBlockPlugin}. */
export const remarkWebhookEventBlock = createRemarkXmlBlockPlugin(WEBHOOK_EVENT_TAG);
