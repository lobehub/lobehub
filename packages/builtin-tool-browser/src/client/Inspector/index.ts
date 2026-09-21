import type { BuiltinInspector } from '@lobechat/types';

import { BrowserApiName } from '../../types';
import { BrowserInspector } from './Browser';

export const BrowserInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(BrowserApiName).map((apiName) => [apiName, BrowserInspector as BuiltinInspector]),
);

export { BrowserInspector } from './Browser';
