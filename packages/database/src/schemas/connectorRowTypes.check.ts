/**
 * Compile-time check that the row type declared in `@lobechat/types`
 * (`packages/types/src/connector.ts`) is identical to the table. Code outside
 * the schema package imports the declared type; a mismatch fails `type-check`.
 */
import type { ConnectorLinkRow } from '@lobechat/types';

import type { userConnectorLinks } from './connector';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type ConnectorRowTypesMatchSchema = [
  Assert<Equal<ConnectorLinkRow, typeof userConnectorLinks.$inferSelect>>,
];
