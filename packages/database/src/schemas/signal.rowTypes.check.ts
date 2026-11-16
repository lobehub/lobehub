import type { SignalItem, SignalItemInsert } from '@lobechat/types';

import type { signals } from './signal';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Fails to compile when the declared row contract and the table drift apart. */
export type SignalRowTypesMatchSchema = [
  Assert<Equal<SignalItem, typeof signals.$inferSelect>>,
  Assert<Equal<SignalItemInsert, typeof signals.$inferInsert>>,
];
