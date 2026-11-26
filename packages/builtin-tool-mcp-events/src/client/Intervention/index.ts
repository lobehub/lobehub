import type { BuiltinIntervention } from '@lobechat/types';

import { McpEventsApiName } from '../../types';
import SubscribeEventIntervention from './SubscribeEvent';
import UnsubscribeEventIntervention from './UnsubscribeEvent';

export const McpEventsInterventions: Record<string, BuiltinIntervention> = {
  [McpEventsApiName.subscribeEvent]: SubscribeEventIntervention as BuiltinIntervention,
  [McpEventsApiName.unsubscribeEvent]: UnsubscribeEventIntervention as BuiltinIntervention,
};
