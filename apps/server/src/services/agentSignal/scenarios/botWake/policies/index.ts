import { parseBotWakeSettings } from '../config';
import type { WakePolicy } from '../types';
import type { WakeClassify } from './classifier';
import { createClassifierPolicy } from './classifier';
import { createInternalRulesPolicy } from './internalRules';
import { createOwnerRulesPolicy } from './ownerRules';

export * from './classifier';
export * from './internalRules';
export * from './ownerRules';

export interface CreateWakePolicySetOptions {
  /** Model call for the classifier. Without one the classifier policy is left out. */
  classify?: WakeClassify;
  settings: Record<string, unknown> | null | undefined;
}

/**
 * The bot-wake policy set for one bot, in evaluation order: cheap rules first, the classifier
 * last (it is `costly` and is skipped when a rule already denied).
 *
 * Returns:
 * - Policies built from the owner's settings. Rule policies use `botWake.mode` (default
 *   `shadow`), the classifier uses `botWake.classifier.mode` (default `shadow`). A policy whose
 *   mode is `off` is not included.
 */
export const createWakePolicySet = ({
  classify,
  settings,
}: CreateWakePolicySetOptions): WakePolicy[] => {
  const { rules, ruleMode } = parseBotWakeSettings(settings);
  const policies: WakePolicy[] = [];

  if (ruleMode !== 'off') {
    policies.push(createInternalRulesPolicy(ruleMode), createOwnerRulesPolicy(ruleMode, rules));
  }

  if (classify && rules.classifier.mode !== 'off') {
    policies.push(createClassifierPolicy(rules.classifier.mode, rules, classify));
  }

  return policies;
};
