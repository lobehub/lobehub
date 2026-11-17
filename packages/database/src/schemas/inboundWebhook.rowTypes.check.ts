import type { InboundWebhookInsert, InboundWebhookRow } from '@lobechat/types';

import type { inboundWebhooks } from './inboundWebhook';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Fails to compile when the declared row contract and the table drift apart. */
export type InboundWebhookRowTypesMatchSchema = [
  Assert<Equal<InboundWebhookRow, typeof inboundWebhooks.$inferSelect>>,
  Assert<Equal<InboundWebhookInsert, typeof inboundWebhooks.$inferInsert>>,
];
