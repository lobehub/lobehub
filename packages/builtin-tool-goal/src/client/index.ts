import {
  CreateGoalInspector,
  CreateGoalRender,
  TaskInterventions,
} from '@lobechat/builtin-tool-task/client';
import type { BuiltinInspector, BuiltinIntervention, BuiltinRender } from '@lobechat/types';

import { GoalIdentifier, GoalManifest } from '../manifest';
import { GoalApiName } from '../types';

export const GoalInspectors: Record<string, BuiltinInspector> = {
  [GoalApiName.createGoal]: CreateGoalInspector as BuiltinInspector,
};

export const GoalInterventions: Record<string, BuiltinIntervention> = {
  [GoalApiName.createGoal]: TaskInterventions.createGoal as BuiltinIntervention,
};

export const GoalRenders: Record<string, BuiltinRender> = {
  [GoalApiName.createGoal]: CreateGoalRender as BuiltinRender,
};

export { GoalIdentifier, GoalManifest };
export * from '../types';
