import type { BuiltinRender } from '@lobechat/types';

import { McpEventsApiName } from '../../types';
import ListEventTypesRender from './ListEventTypes';
import ListSubscriptionsRender from './ListSubscriptions';
import SubscribeEventRender from './SubscribeEvent';
import UnsubscribeEventRender from './UnsubscribeEvent';

export const McpEventsRenders: Record<string, BuiltinRender> = {
  [McpEventsApiName.listEventTypes]: ListEventTypesRender as BuiltinRender,
  [McpEventsApiName.listSubscriptions]: ListSubscriptionsRender as BuiltinRender,
  [McpEventsApiName.subscribeEvent]: SubscribeEventRender as BuiltinRender,
  [McpEventsApiName.unsubscribeEvent]: UnsubscribeEventRender as BuiltinRender,
};
