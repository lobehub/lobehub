import type { BuiltinIntervention } from '@lobechat/types';

import { McpEventsApiName } from '../../types';
import SubscribeEventIntervention from './SubscribeEvent';

export const McpEventsInterventions: Record<string, BuiltinIntervention> = {
  [McpEventsApiName.subscribeEvent]: SubscribeEventIntervention as BuiltinIntervention,
};
