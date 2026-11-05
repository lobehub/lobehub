import type { Page } from '@playwright/test';

export interface RuleInspection {
  containers: number;
  media: string[];
  pseudoRules: Record<string, string[]>;
  rules: string[];
  unmodeled: Record<string, number[]>;
}

export const FORCEABLE = ['active', 'focus', 'focus-visible', 'focus-within', 'hover'];
export const MODELED_PSEUDO_ELEMENTS = ['after', 'before', 'marker', 'placeholder'];

export const inspectRules = (page: Page): Promise<RuleInspection> =>
  page.evaluate(
    ({ forceable, pseudoElements }) => {
      const sections = [...document.querySelectorAll('[data-case]')];
      const root = document.querySelector('[data-synthetic-cases]') ?? document.body;
      const broaden = (selector: string) =>
        selector.replaceAll(/::?[a-z-]+(\([^()]*\))?/gi, '').trim() || '*';
      const styleParent = (rule: CSSRule) => {
        let parent = rule.parentRule;
        while (parent && !(parent instanceof CSSStyleRule)) parent = parent.parentRule;
        return parent as CSSStyleRule | null;
      };
      const resolve = (rule: CSSStyleRule): string => {
        const parent = styleParent(rule);
        if (!parent) return rule.selectorText;
        const outer = resolve(parent);
        return rule.selectorText.includes('&')
          ? rule.selectorText.replaceAll('&', `:is(${outer})`)
          : `:is(${outer}) ${rule.selectorText}`;
      };
      const selectorsUnder = (rule: CSSRule): string[] => {
        if (rule instanceof CSSStyleRule) return [resolve(rule)];
        const inner = 'cssRules' in rule ? [...(rule as CSSGroupingRule).cssRules] : [];
        const nested = inner.flatMap(selectorsUnder);
        if (nested.length) return nested;
        const parent = styleParent(rule);
        return parent ? [resolve(parent)] : [];
      };
      const hits = (selector: string, scope: Element) =>
        selector.split(',').some((part) => {
          try {
            const broad = broaden(part);
            return scope.matches(broad) || scope.querySelector(broad) !== null;
          } catch {
            return true;
          }
        });
      const touching = (rule: CSSRule, scope: Element) =>
        selectorsUnder(rule).some((selector) => hits(selector, scope));
      const widthFeatures = new Set(['max-width', 'min-width', 'width']);
      const ignored = new Set(['all', 'and', 'only', 'screen']);
      const modeledMedia = (condition: string) => {
        const text = condition.toLowerCase().trim();
        if (/^\(?\s*prefers-reduced-motion(\s*:\s*(reduce|no-preference))?\s*\)?$/.test(text))
          return true;
        const words = (text.match(/[a-z][a-z-]*/g) ?? []).filter(
          (word) => !ignored.has(word) && !/^(px|em|rem|vw|vh|ch|ex)$/.test(word),
        );
        return words.length > 0 && words.every((word) => widthFeatures.has(word));
      };
      const media: string[] = [];
      const pseudoRules: Record<string, string[]> = {};
      const rules: string[] = [];
      const candidates: CSSRule[] = [];
      let containers = 0;
      const visit = (list: CSSRuleList) => {
        for (const rule of list) {
          if (rule instanceof CSSMediaRule && touching(rule, root)) {
            media.push(rule.conditionText);
            if (!modeledMedia(rule.conditionText)) {
              candidates.push(rule);
              rules.push(`MEDIA_UNMODELED|${rule.cssText}`);
            }
          }
          if (
            typeof CSSContainerRule !== 'undefined' &&
            rule instanceof CSSContainerRule &&
            touching(rule, root)
          ) {
            containers++;
            candidates.push(rule);
            rules.push(`CONTAINER_UNMODELED|${rule.cssText}`);
          }
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes(':') &&
            touching(rule, root)
          ) {
            const elements = [...rule.selectorText.matchAll(/::([a-z-]+)/gi)].map(
              (match) => match[1],
            );
            if (elements.some((name) => !pseudoElements.includes(name))) {
              candidates.push(rule);
              rules.push(`PSEUDO_UNMODELED|${rule.cssText}`);
            }
            for (const part of rule.selectorText.split(',')) {
              const compounds = part.trim().split(/\s*[\s>+~]\s*/);
              compounds.forEach((compound, index) => {
                const states = [...compound.matchAll(/:([a-z-]+)/gi)]
                  .map((match) => match[1])
                  .filter((name) => forceable.includes(name));
                if (!states.length) return;
                const key = [...new Set(states)].sort().join('+');
                const scoped = index < compounds.length - 1 ? `chain:${key}` : key;
                (pseudoRules[scoped] ??= []).push(rule.cssText);
              });
            }
          }
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
      const unmodeled: Record<string, number[]> = {};
      for (const section of sections) {
        const found = candidates.flatMap((rule, index) => (touching(rule, section) ? [index] : []));
        if (found.length) unmodeled[section.getAttribute('data-case')!] = found;
      }
      return { containers, media: [...new Set(media)], pseudoRules, rules, unmodeled };
    },
    { forceable: FORCEABLE, pseudoElements: MODELED_PSEUDO_ELEMENTS },
  );
