import type { BuiltinInspector } from '@lobechat/types';

import { MiniGameApiName } from '../../types';
import { MiniGameInspector } from './MiniGameInspector';

export const MiniGameInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(MiniGameApiName).map((apiName) => [apiName, MiniGameInspector as BuiltinInspector]),
);

export { MiniGameInspector } from './MiniGameInspector';
