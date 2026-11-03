import type { Page } from '@playwright/test';

import { parseWidthCondition, type WidthCondition } from './conditionPartitions';

export const WIDTH_DOMAIN = [320, 1920] as const;

export const readMediaConditions = (page: Page) =>
  page.evaluate(() => {
    const media: string[] = [];
    let containers = 0;
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) media.push(rule.conditionText);
        if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule)
          containers++;
        if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
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

export const planWidths = (media: string[], preferred: number[]) => {
  const conditions = media.map(parseWidthCondition).filter(Boolean) as WidthCondition[];
  const [minimum, maximum] = WIDTH_DOMAIN;
  const boundaries = [
    ...new Set(
      conditions
        .flatMap((condition) => condition.bounds.map((bound) => bound.value))
        .filter((value) => value > minimum && value < maximum),
    ),
  ].sort((a, b) => a - b);
  const edges = [minimum, ...boundaries, maximum];
  const widths = new Set([...preferred, ...boundaries]);
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
