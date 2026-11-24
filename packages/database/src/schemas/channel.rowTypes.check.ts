import type { ChannelMessage } from '@lobechat/types';

import type { channelMessages } from './channel';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/**
 * `ChannelMessage` is the declared contract readers outside this package use; the Drizzle table
 * must stay exactly that shape. A column added, removed or retyped here fails the type check
 * instead of silently widening the contract.
 */
export type ChannelMessageRowTypeMatchesSchema = Assert<
  Equal<ChannelMessage, typeof channelMessages.$inferSelect>
>;
