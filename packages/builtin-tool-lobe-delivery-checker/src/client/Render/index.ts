import { LobeDeliveryCheckerApiName } from '../../types';
import GenerateVerifyPlanRender from './GenerateVerifyPlan';

/**
 * Delivery Checker Tool Render Components Registry
 *
 * The verify plan renders the generated delivery checks.
 */
export const LobeDeliveryCheckerRenders = {
  [LobeDeliveryCheckerApiName.generateVerifyPlan]: GenerateVerifyPlanRender,
};

export { default as GenerateVerifyPlanRender } from './GenerateVerifyPlan';
