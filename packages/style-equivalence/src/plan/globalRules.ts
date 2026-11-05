import type { FileExtraction, StyleRule } from '../extract';
import { classNamesIn } from '../extract/selectors';
import { elementsOf } from './descendants';
import { resolve, signature } from './kept';
import { normalizeSelector } from './moved';

export const GLOBAL_RULES_CHANGED = 'GLOBAL_RULES_CHANGED';

const unattached = (extraction: FileExtraction) => {
  const slots = new Set(elementsOf(extraction).flatMap((element) => element.slots));
  return extraction.rules.filter(
    (rule) =>
      rule.stylesheet &&
      !Object.keys(rule.owned).length &&
      !classNamesIn(rule.selector).some((name) => slots.has(`global.${name}`)),
  );
};

const signatureOf = (rule: StyleRule) => {
  const selector = normalizeSelector(resolve(rule.selector, rule));
  return selector === undefined ? `UNPARSED:${rule.selector}` : signature(rule, selector);
};

export const globalRuleSignatures = (extraction: FileExtraction) =>
  [...unattached(extraction), ...(extraction.globalRules ?? [])]
    .filter((rule) => rule.declarations?.length || rule.stylesheet?.startsWith('unparsed:'))
    .map(signatureOf);

export const globalRulesChanged = (base: FileExtraction, head: FileExtraction) => {
  const before = globalRuleSignatures(base);
  const after = globalRuleSignatures(head);
  return JSON.stringify(before) === JSON.stringify(after)
    ? undefined
    : `${GLOBAL_RULES_CHANGED}:${before.filter((item) => !after.includes(item)).length}/${after.filter((item) => !before.includes(item)).length}`;
};
