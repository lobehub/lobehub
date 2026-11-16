import type { InboundWebhookDeliveryPage } from '@lobechat/types';

/** Older pages loaded by "Load more", and the first-page boundary they continue from. */
export interface OlderDeliveryPages {
  /** The first page's `nextCursor` these pages were loaded after. */
  after: InboundWebhookDeliveryPage['nextCursor'];
  page: InboundWebhookDeliveryPage;
}

const sameCursor = (
  a: InboundWebhookDeliveryPage['nextCursor'],
  b: InboundWebhookDeliveryPage['nextCursor'],
) => a?.createdAt === b?.createdAt && a?.id === b?.id;

/**
 * The calls to show, newest first. The first page revalidates on its own (focus, reconnect); once
 * new calls move its boundary, older pages loaded after the old boundary would leave a gap between
 * the two, so they are dropped and "Load more" continues from the fresh first page.
 */
export const visibleDeliveries = (
  first: InboundWebhookDeliveryPage | undefined,
  older: OlderDeliveryPages | undefined,
) => {
  const current = older && sameCursor(older.after, first?.nextCursor) ? older.page : undefined;
  return {
    items: [...(first?.items ?? []), ...(current?.items ?? [])],
    nextCursor: current ? current.nextCursor : first?.nextCursor,
    older: current,
  };
};
