import type { InboundWebhookDeliveryPage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { visibleDeliveries } from './deliveryPages';

const page = (from: number, to: number, more = true): InboundWebhookDeliveryPage => ({
  items: Array.from({ length: from - to + 1 }, (_, i) => ({ id: `call-${from - i}` }) as never),
  ...(more && { nextCursor: { createdAt: `t${to}`, id: `call-${to}` } }),
});
const ids = (view: ReturnType<typeof visibleDeliveries>) => view.items.map((item) => item.id);

describe('visibleDeliveries', () => {
  it('appends older pages loaded after the current first page', () => {
    const first = page(100, 81);
    const view = visibleDeliveries(first, { after: first.nextCursor, page: page(80, 61) });
    expect(ids(view)).toHaveLength(40);
    expect(view.nextCursor).toEqual({ createdAt: 't61', id: 'call-61' });
  });

  it('drops older pages once a revalidated first page moved, so no calls go missing between them', () => {
    const before = page(100, 81);
    const older = { after: before.nextCursor, page: page(80, 61) };
    // Five new calls arrived: the first page is now 105–86, and 85–81 would fall between pages.
    const view = visibleDeliveries(page(105, 86), older);
    expect(ids(view)).toEqual(ids(visibleDeliveries(page(105, 86), undefined)));
    expect(view.nextCursor).toEqual({ createdAt: 't86', id: 'call-86' });
  });
});
