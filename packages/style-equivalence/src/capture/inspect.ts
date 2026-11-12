import type { Page } from '@playwright/test';

export interface RuleInspection {
  containers: number;
  media: string[];
  pseudoRules: Record<string, string[]>;
  rules: string[];
  sectionRules?: Record<string, string[]>;
  unmodeled: Record<string, number[]>;
  unparsed: string[];
}

export const FORCEABLE = ['active', 'focus', 'focus-visible', 'focus-within', 'hover'];
export const MODELED_PSEUDO_ELEMENTS = ['after', 'before', 'marker', 'placeholder'];
export const STATIC_PSEUDO_CLASSES = [
  'after',
  'any-link',
  'before',
  'defined',
  'dir',
  'empty',
  'first-child',
  'first-letter',
  'first-line',
  'first-of-type',
  'has',
  'host',
  'host-context',
  'is',
  'lang',
  'last-child',
  'last-of-type',
  'link',
  'not',
  'nth-child',
  'nth-last-child',
  'nth-last-of-type',
  'nth-of-type',
  'only-child',
  'only-of-type',
  'root',
  'scope',
  'where',
];

export const inspectRules = (page: Page): Promise<RuleInspection> =>
  page.evaluate(
    ({ forceable, pseudoElements, staticClasses }) => {
      const sections = [...document.querySelectorAll('[data-case]')];
      const root = document.querySelector('[data-synthetic-cases]') ?? document.body;
      const selectorList = (selector: string) => {
        const parts: string[] = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index < selector.length; index++) {
          const char = selector[index];
          if (char === '\\') index++;
          else if (char === '(' || char === '[') depth++;
          else if (char === ')' || char === ']') depth--;
          else if (char === ',' && depth === 0) {
            parts.push(selector.slice(start, index));
            start = index + 1;
          }
        }
        parts.push(selector.slice(start));
        return parts;
      };
      const unparsed = new Set<string>();
      const broaden = (selector: string) => {
        let text = '';
        for (let index = 0; index < selector.length; index++) {
          const char = selector[index];
          if (char === '\\') {
            text += selector.slice(index, index + 2);
            index++;
            continue;
          }
          if (char !== ':') {
            text += char;
            continue;
          }
          while (selector[index + 1] === ':') index++;
          while (/[\w-]/.test(selector[index + 1] ?? '')) index++;
          if (selector[index + 1] !== '(') continue;
          let depth = 0;
          for (index++; index < selector.length; index++) {
            if (selector[index] === '(') depth++;
            if (selector[index] === ')' && --depth === 0) break;
          }
        }
        const filled = text
          .replaceAll(/([>+~])\s*(?=[>+~]|$)/g, '$1 *')
          .replace(/^\s*([>+~])/, '* $1')
          .trim();
        return filled || '*';
      };
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
        selectorList(selector).some((part) => {
          try {
            const broad = broaden(part);
            if (broad === '*') return false;
            return scope.matches(broad) || scope.querySelector(broad) !== null;
          } catch {
            unparsed.add(part.trim());
            return false;
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
            const classes = [
              ...rule.selectorText
                .replaceAll(/\\./g, '')
                .replaceAll(/\[[^\]]*\]/g, '')
                .matchAll(/(?<!:):([a-z-]+)/gi),
            ].map((match) => match[1].toLowerCase());
            if (
              classes.some((name) => !forceable.includes(name) && !staticClasses.includes(name))
            ) {
              candidates.push(rule);
              rules.push(`STATE_UNMODELED|${rule.cssText}`);
            }
            for (const part of selectorList(rule.selectorText)) {
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
      const sectionRules: Record<string, string[]> = {};
      const hostClasses = (section: Element) => {
        const owners = new Map<string, string | null>();
        for (const element of section.querySelectorAll('[data-synthetic-element]')) {
          const id = element.getAttribute('data-synthetic-element')!;
          for (const name of element.classList)
            owners.set(name, owners.has(name) && owners.get(name) !== id ? null : id);
        }
        return [...owners].filter((entry): entry is [string, string] => entry[1] !== null);
      };
      const escape = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
      for (const section of sections) {
        const found = candidates.flatMap((rule, index) => (touching(rule, section) ? [index] : []));
        if (!found.length) continue;
        const key = section.getAttribute('data-case')!;
        unmodeled[key] = found;
        const owned = hostClasses(section);
        sectionRules[key] = found.map((index) =>
          owned.reduce(
            (text, [name, id]) =>
              text.replaceAll(
                new RegExp(`\\.${escape(name)}(?![\\w-])`, 'g'),
                `[data-synthetic-element="${id}"]`,
              ),
            rules[index],
          ),
        );
      }
      return {
        containers,
        media: [...new Set(media)],
        pseudoRules,
        rules,
        sectionRules,
        unmodeled,
        unparsed: [...unparsed],
      };
    },
    {
      forceable: FORCEABLE,
      pseudoElements: MODELED_PSEUDO_ELEMENTS,
      staticClasses: STATIC_PSEUDO_CLASSES,
    },
  );
