/** Keep the shared connector contracts aligned with the persisted row shapes. */
import type { NewUserConnector, UserConnectorItem } from '@lobechat/types';

import type { userConnectors } from './connector';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type ConnectorRowTypesMatchSchema = [
  Assert<Equal<UserConnectorItem, typeof userConnectors.$inferSelect>>,
  Assert<Equal<NewUserConnector, typeof userConnectors.$inferInsert>>,
];
