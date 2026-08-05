import type { BuiltinInspector } from '@lobechat/types';

import { UserInteractionApiName } from '../../types';
import { AskUserQuestionInspector } from './AskUserQuestion';

export const UserInteractionInspectors: Record<string, BuiltinInspector> = {
  [UserInteractionApiName.askUserQuestion]: AskUserQuestionInspector as BuiltinInspector,
};

export { AskUserQuestionInspector } from './AskUserQuestion';
