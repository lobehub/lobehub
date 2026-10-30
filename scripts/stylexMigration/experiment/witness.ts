import type { Page } from '@playwright/test';

import type { RuleInventory } from './capture';

/** Independent marker rules prove that a discovered branch was actually activated.
 * These internal-only custom properties are excluded from the product snapshot.
 * This witnesses activation, not exhaustive truth-table coverage of all conditions.
 */
export const createWitness = async (page: Page, inventory: RuleInventory) => {
  const branches = inventory.selectors.filter(
    (entry) =>
      entry.conditions.length ||
      /:(?:hover|active|focus-visible|focus-within|focus)\b/.test(entry.selector),
  );
  const selectors = branches.map((entry, index) => {
    const selector = entry.selector.replaceAll(/::[\w-]+(?:\([^)]*\))?/g, '');
    let css = `${selector}{--_stylex_experiment_witness_${index}:active!important}`;
    for (const condition of [...entry.conditions].reverse()) {
      const keyword = {
        CSSContainerRule: 'container',
        CSSMediaRule: 'media',
        CSSSupportsRule: 'supports',
      }[condition.kind];
      if (keyword) css = `@${keyword} ${condition.condition}{${css}}`;
    }
    return css;
  });
  await page.evaluate((css) => {
    const style = document.createElement('style');
    style.id = 'stylex-experiment-witness';
    style.textContent = css;
    document.head.append(style);
  }, selectors.join('\n'));
  const witnessed = new Set<number>();
  return {
    async collect() {
      const indices = await page.evaluate((branches) => {
        const elements = [...document.querySelectorAll('[data-experiment-node]')];
        const computed = elements.map((element) => getComputedStyle(element));
        return branches.flatMap((entry, index) =>
          computed.some(
            (style) =>
              style.getPropertyValue(`--_stylex_experiment_witness_${index}`).trim() === 'active',
          )
            ? [index]
            : [],
        );
      }, branches);
      indices.forEach((index) => witnessed.add(index));
    },
    async dispose() {
      await page.evaluate(() => document.getElementById('stylex-experiment-witness')?.remove());
    },
    report: () => ({
      branches: branches.length,
      unwitnessed: branches.filter((_, index) => !witnessed.has(index)),
      witnessed: witnessed.size,
    }),
  };
};
