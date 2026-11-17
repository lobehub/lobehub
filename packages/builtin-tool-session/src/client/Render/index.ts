import type { BuiltinRender } from '@lobechat/types';

import { SessionApiName } from '../../types';
import StartSessionRender from './StartSession';

export const SessionRenders: Record<string, BuiltinRender> = {
  [SessionApiName.startSession]: StartSessionRender as BuiltinRender,
};
