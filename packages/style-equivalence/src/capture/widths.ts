import type { Page } from '@playwright/test';

import { parseWidthCondition, type WidthCondition } from './conditionPartitions';

export const WIDTH_DOMAIN = [320, 1920] as const;

export const readMediaConditions = (page: Page) =>
  page.evaluate(() => {
    const elements = [...document.querySelectorAll('[data-case], [data-case] *')];
    const broaden = (selector: string) =>
      selector.replaceAll(/::?[a-z-]+(\([^)]*\))?/gi, '').trim() || '*';
    const touchesCase = (rules: CSSRuleList): boolean =>
      [...rules].some((rule) => {
        if (rule instanceof CSSStyleRule)
          return rule.selectorText.split(',').some((selector) => {
            try {
              return elements.some((element) => element.matches(broaden(selector)));
            } catch {
              return true;
            }
          });
        return 'cssRules' in rule && touchesCase((rule as CSSGroupingRule).cssRules);
      });
    const media: string[] = [];
    let containers = 0;
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        const grouping = 'cssRules' in rule ? (rule as CSSGroupingRule).cssRules : undefined;
        if (rule instanceof CSSMediaRule && touchesCase(rule.cssRules))
          media.push(rule.conditionText);
        if (
          typeof CSSContainerRule !== 'undefined' &&
          rule instanceof CSSContainerRule &&
          touchesCase(rule.cssRules)
        )
          containers++;
        if (grouping) visit(grouping);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules);
      } catch {
        continue;
      }
    }
    return { containers, media };
  });

const probesAround = ({ operator, value }: WidthCondition['bounds'][number]) => {
  if (operator === '<' || operator === '>=') return [Math.ceil(value) - 1, Math.ceil(value)];
  if (operator === '<=' || operator === '>') return [Math.floor(value), Math.floor(value) + 1];
  return Number.isInteger(value)
    ? [value - 1, value, value + 1]
    : [Math.floor(value), Math.ceil(value)];
};

export const planWidths = (media: string[], preferred: number[]) => {
  const conditions = media.map(parseWidthCondition).filter(Boolean) as WidthCondition[];
  const [minimum, maximum] = WIDTH_DOMAIN;
  const probes = [
    ...new Set(
      conditions
        .flatMap((condition) => condition.bounds)
        .filter(({ value }) => value > minimum && value < maximum)
        .flatMap(probesAround),
    ),
  ].sort((a, b) => a - b);
  const edges = [minimum, ...probes, maximum];
  const widths = new Set([...preferred, ...probes]);
  for (let index = 1; index < edges.length; index++) {
    const [low, high] = [edges[index - 1], edges[index]];
    if (![...widths].some((width) => width > low && width < high))
      widths.add(Math.round((low + high) / 2));
  }
  return {
    unparsed: media.length - conditions.length,
    widths: [...widths].sort((a, b) => a - b),
  };
};
