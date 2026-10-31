/** CSSOM inventory retains inactive rules, layers and native nested declarations. */
export const collectRulesInPage = () => {
  const rules: Array<{
    conditions: Array<{ kind: string; text: string }>;
    condition?: string;
    declarations?: Array<{ important: boolean; property: string; value: string }>;
    kind: string;
    name?: string;
    path: string;
    selector?: string;
    selectorAncestors: string[];
    text: string;
  }> = [];
  const gaps: string[] = [];
  const visit = (
    list: CSSRuleList,
    prefix: string,
    conditions: Array<{ kind: string; text: string }> = [],
    selectors: string[] = [],
  ) => {
    [...list].forEach((rule, index) => {
      const key = `${prefix}.${index}`;
      const grouping = rule as CSSGroupingRule;
      const style = rule as CSSStyleRule;
      const kind = rule.constructor.name;
      const condition = (rule as CSSConditionRule).conditionText;
      rules.push({
        conditions,
        condition,
        declarations: style.style
          ? [...style.style].map((property) => ({
              property,
              value: style.style.getPropertyValue(property),
              important: style.style.getPropertyPriority(property) === 'important',
            }))
          : undefined,
        kind,
        name: (rule as CSSRule & { name?: string }).name,
        path: key,
        selector: style.selectorText,
        selectorAncestors: selectors,
        text: grouping.cssRules?.length ? (style.style?.cssText ?? '') : rule.cssText,
      });
      if (kind === 'CSSImportRule') gaps.push(`IMPORTED_STYLESHEET_ADAPTER_UNAVAILABLE:${key}`);
      if (grouping.cssRules)
        visit(
          grouping.cssRules,
          key,
          condition
            ? [...conditions, { kind, text: condition }]
            : ['CSSScopeRule', 'CSSStartingStyleRule'].includes(kind)
              ? [...conditions, { kind, text: rule.cssText }]
              : conditions,
          style.selectorText ? [...selectors, style.selectorText] : selectors,
        );
    });
  };
  for (const [index, sheet] of [...document.styleSheets].entries()) {
    try {
      visit(sheet.cssRules, String(index));
    } catch (error) {
      console.error('STYLESHEET_UNREADABLE', error);
      gaps.push(`STYLESHEET_UNREADABLE:${index}`);
    }
  }
  if (
    document.adoptedStyleSheets.length ||
    document.querySelector('iframe') ||
    [...document.querySelectorAll('*')].some((element) => element.shadowRoot)
  )
    gaps.push('SURFACE_ADAPTER_UNAVAILABLE');
  return { gaps, rules };
};
