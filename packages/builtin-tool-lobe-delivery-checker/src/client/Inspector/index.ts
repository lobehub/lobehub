import type { BuiltinInspector } from '@lobechat/types';

import { LobeDeliveryCheckerApiName } from '../../types';
import { GenerateVerifyPlanInspector } from './GenerateVerifyPlan';

/**
 * Delivery Checker Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const LobeDeliveryCheckerInspectors: Record<string, BuiltinInspector> = {
  [LobeDeliveryCheckerApiName.generateVerifyPlan]: GenerateVerifyPlanInspector as BuiltinInspector,
};
