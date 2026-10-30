import type { Page } from '@playwright/test';

export interface SnapshotNode {
  box: number[];
  key: string;
  scroll: number[];
  style: number;
  tag: string;
  text: string;
}

export interface StyleSnapshot {
  animations: Array<{ key: string; keyframes: unknown; timing: unknown }>;
  captureMetadata?: {
    attributes: Array<{ attributes: Array<[string, string]>; key: string; text: string }>;
    custom: string[];
    rootProperties: string[];
    standard: string[];
  };
  durationMs: number;
  nodes: SnapshotNode[];
  propertyReads: number;
  styles: Array<Record<string, string>>;
}

/** Self-contained: Playwright serializes this function into the test document. */
export const captureInPage = (
  options: {
    animationTime?: number;
    collectMetadata?: boolean;
    geometry?: boolean;
    properties?: string[];
    selector?: string;
    styleKeys?: string[];
  } = {},
): StyleSnapshot => {
  const started = performance.now();
  const root = document.querySelector(options.selector ?? '[data-case-root]');
  if (!root) throw new Error('The component root is missing');
  const elements = [root, ...root.querySelectorAll('*')].filter(
    (element) => !['LINK', 'META', 'SCRIPT', 'STYLE'].includes(element.tagName),
  );
  if (elements.length < 2) throw new Error('The component has not mounted');
  const keys = new Map<Element, string>();
  const walk = (element: Element, key: string) => {
    keys.set(element, key);
    [...element.children]
      .filter((child) => elements.includes(child))
      .forEach((child, index) => walk(child, `${key}.${index}`));
  };
  walk(root, 'root');
  if (options.collectMetadata)
    elements.forEach((element, index) =>
      element.setAttribute('data-experiment-node', String(index)),
    );
  root.getBoundingClientRect();
  const canonical = (value: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  const animationNames = new Map<string, string>();
  const animations: StyleSnapshot['animations'] = [];
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (
      !(effect instanceof KeyframeEffect) ||
      !(effect.target instanceof Element) ||
      !root.contains(effect.target)
    )
      continue;
    if (animation instanceof CSSTransition) {
      animation.finish();
      continue;
    }
    animation.pause();
    animation.currentTime = options.animationTime ?? 0;
    const key = `${keys.get(effect.target)}${effect.pseudoElement ?? ''}`;
    const keyframes = effect
      .getKeyframes()
      .map((frame) => canonical(frame as unknown as Record<string, unknown>));
    const timing = canonical(effect.getTiming() as unknown as Record<string, unknown>);
    animations.push({ key, keyframes, timing });
    if (animation instanceof CSSAnimation)
      animationNames.set(animation.animationName, JSON.stringify({ keyframes, timing }));
  }
  animations.sort((a, b) => a.key.localeCompare(b.key));
  const declarations = new Map<Element, Map<string | undefined, CSSStyleDeclaration>>();
  const custom = new Set<string>();
  const standard = new Set<string>();
  const rootProperties: string[] = [];
  if (options.collectMetadata) {
    // Keep ALL five declaration inventories, including currently ungenerated
    // pseudos. Do not cache names across documents, widths or states.
    for (const element of elements) {
      const byPseudo = new Map<string | undefined, CSSStyleDeclaration>();
      declarations.set(element, byPseudo);
      for (const pseudo of [undefined, '::before', '::after', '::marker', '::placeholder']) {
        const computed = getComputedStyle(element, pseudo);
        byPseudo.set(pseudo, computed);
        const length = computed.length;
        for (let index = 0; index < length; index++) {
          const property = computed.item(index);
          (property.startsWith('--') ? custom : standard).add(property);
          if (element === root && !pseudo && !property.startsWith('--'))
            rootProperties.push(property);
        }
      }
    }
  }
  const origin = root.getBoundingClientRect();
  const rounded = (value: number) => Math.round(value * 1000) / 1000;
  const styles: StyleSnapshot['styles'] = [];
  const interned = new Map<string, number>();
  const nodes: SnapshotNode[] = [];
  let propertyReads = 0;
  const customProperties = [...custom].sort();
  const read = (element: Element, pseudo?: string) => {
    const computed = declarations.get(element)?.get(pseudo) ?? getComputedStyle(element, pseudo);
    const values: Record<string, string> = {};
    const key = `${keys.get(element)}${pseudo ?? ''}`;
    for (const property of options.styleKeys && !options.styleKeys.includes(key)
      ? []
      : options.collectMetadata
        ? ['animation-name', ...customProperties]
        : (options.properties ?? [...computed].sort())) {
      if (property.startsWith('--_stylex_experiment_witness_')) continue;
      let value = computed.getPropertyValue(property);
      if (property === 'animation-name' && value !== 'none')
        value = value
          .split(',')
          .map((name) => animationNames.get(name.trim()) ?? `unresolved:${name.trim()}`)
          .join(',');
      values[property] = value;
      propertyReads++;
    }
    const signature = JSON.stringify(values);
    let style = interned.get(signature);
    if (style === undefined) {
      style = styles.length;
      interned.set(signature, style);
      styles.push(values);
    }
    const box = element.getBoundingClientRect();
    nodes.push({
      box:
        options.geometry === false || pseudo
          ? []
          : [box.x - origin.x, box.y - origin.y, box.width, box.height].map(rounded),
      key: `${keys.get(element)}${pseudo ?? ''}`,
      scroll:
        options.geometry === false || pseudo
          ? []
          : [element.clientWidth, element.clientHeight, element.scrollWidth, element.scrollHeight],
      style,
      tag: element.tagName,
      text: pseudo
        ? computed.content
        : [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join('')
            .trim(),
    });
  };
  for (const element of elements) {
    read(element);
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(element, pseudo).content;
      if (content && !['none', 'normal'].includes(content)) read(element, pseudo);
    }
    if (getComputedStyle(element).display === 'list-item') read(element, '::marker');
    if (element.matches('input[placeholder], textarea[placeholder]'))
      read(element, '::placeholder');
  }
  return {
    animations,
    durationMs: performance.now() - started,
    nodes,
    propertyReads,
    styles,
    ...(options.collectMetadata
      ? {
          captureMetadata: {
            attributes: elements.map((element) => ({
              attributes: [...element.attributes]
                .filter(
                  (attribute) =>
                    !['class', 'style', 'data-experiment-node'].includes(attribute.name),
                )
                .map((attribute): [string, string] => [attribute.name, attribute.value])
                .sort(([a], [b]) => (a < b ? -1 : 1)),
              key: keys.get(element)!,
              text: [...element.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join(''),
            })),
            custom: customProperties,
            rootProperties,
            standard: [...standard].sort(),
          },
        }
      : {}),
  };
};

export interface RuleInventory {
  conditions: Array<{ condition: string; kind: string; selectors: string[] }>;
  cssText: string;
  nodeCount: number;
  pseudoElements: string[];
  relevantRules: number;
  selectors: Array<{
    conditions: Array<{ condition: string; kind: string }>;
    selector: string;
    targets: number[];
  }>;
  unsupported: string[];
}

/** Discovery retains inactive rules; matched styles alone do not do that. */
export const inventoryInPage = (selector = '[data-case-root]'): RuleInventory => {
  const root = document.querySelector(selector);
  if (!root) throw new Error('The component root is missing');
  const elements = [root, ...root.querySelectorAll('*')].filter(
    (element) => !['LINK', 'META', 'SCRIPT', 'STYLE'].includes(element.tagName),
  );
  elements.forEach((element, index) => element.setAttribute('data-experiment-node', String(index)));
  const conditions = new Map<string, { condition: string; kind: string; selectors: string[] }>();
  const selectors: RuleInventory['selectors'] = [];
  const unsupported = new Set<string>();
  if (root.shadowRoot || [...root.querySelectorAll('*')].some((element) => element.shadowRoot))
    unsupported.add('shadow-dom');
  if (document.adoptedStyleSheets.length) unsupported.add('adopted-stylesheets');
  const pseudoElements = new Set<string>();
  const texts: string[] = [];
  let relevantRules = 0;
  const visit = (
    rules: CSSRuleList,
    parents: Array<{ condition: string; kind: string }>,
    parentSelector?: string,
  ) => {
    for (const rule of rules) {
      const kind = rule.constructor.name;
      const grouping = rule as CSSGroupingRule;
      const styleRule = rule as CSSStyleRule;
      const condition =
        (rule as CSSConditionRule).conditionText ??
        (['CSSScopeRule', 'CSSStartingStyleRule', 'CSSPositionTryRule'].includes(kind)
          ? rule.cssText.split('{')[0].trim()
          : undefined);
      if (kind === 'CSSLayerBlockRule' && (rule as CSSLayerBlockRule).name.startsWith('lobe-'))
        continue;
      const path = condition ? [...parents, { condition, kind }] : parents;
      const ownSelector = styleRule.selectorText;
      const currentSelector = ownSelector
        ? parentSelector
          ? ownSelector.includes('&')
            ? ownSelector.replaceAll('&', `:is(${parentSelector})`)
            : `:is(${parentSelector}) ${ownSelector}`
          : ownSelector
        : parentSelector;
      if (currentSelector && styleRule.style?.length) {
        const pseudos = [...currentSelector.matchAll(/::([\w-]+)(?:\([^)]*\))?/g)].map(
          (match) => match[1],
        );
        const targetSelector = currentSelector
          .replaceAll(/::[\w-]+(?:\([^)]*\))?/g, '')
          .replaceAll(/:dir\([^)]*\)|\[(?:data-theme|dir)\s*=[^\]]*\]/g, ':is(*)')
          .replaceAll(/:not\(\s*:(?:hover|active|focus-visible|focus-within|focus)\s*\)/g, ':is(*)')
          .replaceAll(
            /:(?:hover|active|focus-visible|focus-within|focus|checked|disabled|enabled|indeterminate|valid|invalid|user-valid|user-invalid|placeholder-shown|autofill|target|target-within|visited|open|popover-open|fullscreen|modal|picture-in-picture)(?![\w-])/g,
            ':is(*)',
          );
        const targets: number[] = [];
        try {
          elements.forEach((element, index) => {
            if (element.matches(targetSelector)) targets.push(index);
          });
        } catch {
          unsupported.add(`selector:${currentSelector}`);
        }
        if (targets.length > 0) {
          relevantRules++;
          selectors.push({ conditions: path, selector: currentSelector, targets });
          pseudos.forEach((pseudo) => pseudoElements.add(pseudo));
          for (const pseudo of pseudos)
            if (!['before', 'after', 'marker', 'placeholder'].includes(pseudo))
              unsupported.add(`pseudo-element:${pseudo}`);
          if (currentSelector.includes(':visited')) unsupported.add('pseudo-class:visited');
          if (
            /:(?:checked|disabled|enabled|indeterminate|valid|invalid|user-valid|user-invalid|placeholder-shown|autofill|target|target-within|open|popover-open|fullscreen|modal|picture-in-picture)\b/.test(
              currentSelector,
            )
          )
            unsupported.add(`state-needs-fixture:${currentSelector}`);
          for (const entry of path) {
            const key = `${entry.kind}:${entry.condition}`;
            const item = conditions.get(key) ?? { ...entry, selectors: [] };
            item.selectors.push(currentSelector);
            conditions.set(key, item);
          }
        }
      }
      if (grouping.cssRules) visit(grouping.cssRules, path, currentSelector);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      texts.push([...sheet.cssRules].map((rule) => rule.cssText).join('\n'));
      visit(sheet.cssRules, []);
    } catch (error) {
      unsupported.add(`stylesheet:${String(error)}`);
    }
  }
  return {
    conditions: [...conditions.values()],
    cssText: texts.join('\n'),
    nodeCount: elements.length,
    pseudoElements: [...pseudoElements],
    relevantRules,
    selectors,
    unsupported: [...unsupported],
  };
};

export interface StyleDifference {
  after?: string;
  before?: string;
  diagnosticReason?: string;
  key: string;
  property: string;
}

export const compareSnapshots = (
  before: StyleSnapshot,
  after: StyleSnapshot,
): StyleDifference[] => {
  const differences: StyleDifference[] = [];
  const beforeNodes = new Map(before.nodes.map((node) => [node.key, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.key, node]));
  for (const key of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const oldNode = beforeNodes.get(key);
    const newNode = afterNodes.get(key);
    if (!oldNode || !newNode) {
      differences.push({ after: newNode?.tag, before: oldNode?.tag, key, property: 'node' });
      continue;
    }
    for (const property of ['tag', 'text'] as const)
      if (oldNode[property] !== newNode[property])
        differences.push({ after: newNode[property], before: oldNode[property], key, property });
    for (const property of ['box', 'scroll'] as const) {
      if (
        oldNode[property].some(
          (value, index) => Math.abs(value - (newNode[property][index] ?? Infinity)) > 0.05,
        ) ||
        oldNode[property].length !== newNode[property].length
      )
        differences.push({
          after: JSON.stringify(newNode[property]),
          before: JSON.stringify(oldNode[property]),
          key,
          property,
        });
    }
    const oldStyle = before.styles[oldNode.style];
    const newStyle = after.styles[newNode.style];
    for (const property of new Set([...Object.keys(oldStyle), ...Object.keys(newStyle)])) {
      if (oldStyle[property] !== newStyle[property])
        differences.push({ after: newStyle[property], before: oldStyle[property], key, property });
    }
  }
  if (JSON.stringify(before.animations) !== JSON.stringify(after.animations))
    differences.push({
      after: JSON.stringify(after.animations),
      before: JSON.stringify(before.animations),
      key: 'root',
      property: 'animation-effects',
    });
  return differences.map((difference) => {
    const oldNode = beforeNodes.get(difference.key);
    const newNode = afterNodes.get(difference.key);
    const oldStyle = oldNode ? before.styles[oldNode.style] : undefined;
    const newStyle = newNode ? after.styles[newNode.style] : undefined;
    if (difference.property.startsWith('--'))
      return {
        ...difference,
        diagnosticReason: 'custom-property: compare resolved consumers separately',
      };
    if (
      difference.property.startsWith('-webkit-box-') &&
      oldStyle &&
      newStyle &&
      ![oldStyle.display, newStyle.display].some((display) =>
        ['-webkit-box', '-webkit-inline-box'].includes(display),
      )
    )
      return {
        ...difference,
        diagnosticReason: 'inactive legacy flex property in this display context',
      };
    if (
      /^border-(?:block-(?:start|end)|inline-(?:start|end)|top|right|bottom|left)-color$/.test(
        difference.property,
      ) &&
      oldStyle &&
      newStyle
    ) {
      const width = difference.property.replace(/color$/, 'width');
      const style = difference.property.replace(/color$/, 'style');
      if (
        [oldStyle, newStyle].every(
          (values) => values[width] === '0px' && ['none', 'hidden'].includes(values[style]),
        )
      )
        return {
          ...difference,
          diagnosticReason: 'nonpainting border color at zero width and none/hidden style',
        };
    }
    return difference;
  });
};

export const mountFixture = async (
  page: Page,
  id: string,
  options: { direction?: string; theme?: string; width?: number } = {},
) => {
  await page.evaluate(
    async ({ id, options }) => {
      const api = (
        window as unknown as {
          __stylexExperiment: {
            mount: (
              id: string,
              theme?: string,
              width?: number,
              direction?: string,
            ) => Promise<number>;
          };
        }
      ).__stylexExperiment;
      await api.mount(id, options.theme, options.width, options.direction);
    },
    { id, options },
  );
};
