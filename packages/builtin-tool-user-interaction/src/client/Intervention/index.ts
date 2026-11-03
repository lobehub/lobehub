import type { BuiltinIntervention } from '@lobechat/types';

import { UserInteractionApiName } from '../../types';
import AskUserQuestionIntervention from './AskUserQuestion';

export const UserInteractionInterventions: Record<string, BuiltinIntervention> = {
  [UserInteractionApiName.askUserQuestion]: AskUserQuestionIntervention as BuiltinIntervention,
};
