/**
 * Compile-time check that the connector shapes declared in `@lobechat/types`
 * (`packages/types/src/connector.ts`) match `user_connectors`. Code outside the
 * schema imports those declared types; a mismatch fails `type-check`.
 */
import type { ConnectorOidcConfig, ResolvedConnectorRef } from '@lobechat/types';

import type { userConnectors } from './connector';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type UserConnectorRow = typeof userConnectors.$inferSelect;

export type ConnectorRowTypesMatchSchema = [
  Assert<Equal<ResolvedConnectorRef, Pick<UserConnectorRow, 'id' | 'userId' | 'workspaceId'>>>,
  Assert<Equal<ConnectorOidcConfig | null, UserConnectorRow['oidcConfig']>>,
];
