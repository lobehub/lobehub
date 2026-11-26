import type { UserConsentEvent, UserConsentEventInsert } from '@lobechat/types';

import type { userConsentEvents } from './userConsentEvent';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Fails to compile when the declared row contract and the table drift apart. */
export type UserConsentEventRowTypesMatchSchema = [
  Assert<Equal<UserConsentEvent, typeof userConsentEvents.$inferSelect>>,
  Assert<Equal<UserConsentEventInsert, typeof userConsentEvents.$inferInsert>>,
];
