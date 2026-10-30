import type { Browser } from '@playwright/test';

import { captureInPage, compareSnapshots } from '../experiment/capture';
import { sha256 } from './report';
import { collectRulesInPage } from './ruleInventory';
import {
  collectRuleWitnessesInPage,
  planRuleWitnesses,
  readRuntimeBindings,
} from './ruleWitnesses';
import type { StyleBindingPlan } from './styleBindings';

/** Real browser tests of marker isolation and branch activation, not React substitutes. */
export const runRuleWitnessSelfTest = async (browser: Browser) => {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const results: Array<{ id: string; passed: boolean; detail: unknown }> = [];
  let sequence = 0;
  const mount = async (css: string, html: string) => {
    await page.goto('about:blank');
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body><main data-case-root>${html}</main></body></html>`,
    );
  };
  const observe = async () => {
    const inventory = await page.evaluate(collectRulesInPage);
    const source: StyleBindingPlan = {
      bindings: [
        {
          kind: 'css-module',
          symbol: 'styles',
          slots: ['x', 'container'].map((name) => ({
            name,
            unitId: `source:${name}`,
            start: 0,
            end: 1,
          })),
        },
      ],
      gaps: [],
      source: 'corpus.css',
      sourceHash: 'controlled',
      stylesheets: [],
    };
    const plan = planRuleWitnesses(inventory, source, {
      styles: { x: 'x', container: 'container' },
    });
    const properties = await page.evaluate(() =>
      [...getComputedStyle(document.querySelector('[data-case-root]')!)].filter(
        (property) => !property.startsWith('--'),
      ),
    );
    const sheetCount = await page.evaluate(() => document.adoptedStyleSheets.length);
    const before = await page.evaluate(captureInPage, { properties });
    const observation = await page.evaluate(collectRuleWitnessesInPage, {
      nonce: sha256(String(sequence++)).slice(0, 16),
      rules: plan.rules,
    });
    const after = await page.evaluate(captureInPage, { properties });
    const clean = (await page.evaluate(() => document.adoptedStyleSheets.length)) === sheetCount;
    return {
      inventory,
      observation,
      plan,
      pure: clean && compareSnapshots(before, after).length === 0,
    };
  };
  try {
    await mount(
      '.x:focus-visible{color:red}',
      '<div class="x" tabindex="0"><span class="x" tabindex="0">Child</span></div>',
    );
    const document = await cdp.send('DOM.getDocument');
    const target = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: 'div.x',
    });
    await cdp.send('CSS.forcePseudoState', {
      nodeId: target.nodeId,
      forcedPseudoClasses: ['focus-visible'],
    });
    const inheritance = await observe();
    const activation = inheritance.observation.observations[0].targets.map(
      (target) => target.active,
    );
    results.push({
      id: 'non-inheriting-marker-and-second-target',
      passed: inheritance.pure && JSON.stringify(activation) === '[true,false]',
      detail: activation,
    });

    await mount(
      '.container{container:card / inline-size;box-sizing:border-box;width:640px;padding:18px;border:2px solid} @container card (max-width:600px){.x{color:red}}',
      '<div class="container"><div class="x">Target</div></div>',
    );
    const narrow = await observe();
    await page.locator('.container').evaluate((element) => {
      (element as HTMLElement).style.width = '641px';
    });
    const wide = await observe();
    const narrowTarget = narrow.observation.observations.find(
      (entry) => narrow.plan.rules.find((rule) => rule.id === entry.id)?.conditions.length,
    )?.targets[0];
    const wideTarget = wide.observation.observations.find(
      (entry) => wide.plan.rules.find((rule) => rule.id === entry.id)?.conditions.length,
    )?.targets[0];
    results.push({
      id: 'named-container-content-box',
      passed:
        narrow.pure &&
        wide.pure &&
        narrowTarget?.active === true &&
        wideTarget?.active === false &&
        narrowTarget.containers[0].width === 600 &&
        wideTarget.containers[0].width === 601,
      detail: { narrowTarget, wideTarget },
    });
    await mount(
      '.container{container:card / inline-size;width:300px;height:20px;overflow-y:scroll} @container card (max-width:400px){.x{color:red}}',
      '<div class="container"><div class="x" style="height:100px">Target</div></div>',
    );
    const scroll = await observe();
    const scrollTarget = scroll.observation.observations.find(
      (entry) => scroll.plan.rules.find((rule) => rule.id === entry.id)?.conditions.length,
    )?.targets[0];
    results.push({
      id: 'scrollbar-content-metrics-retained-as-gap',
      passed:
        scroll.pure &&
        scrollTarget?.containers[0].metricsTrusted === false &&
        scrollTarget.conditionStates[0] === null,
      detail: scrollTarget,
    });

    await mount(
      '.container{container-type:inline-size;width:300px} @container (width < 400px){.x::before{content:attr(data-label)}}',
      '<div class="container"><div class="x" data-label="Label">Target</div></div>',
    );
    const pseudo = await observe();
    const pseudoTarget = pseudo.observation.observations.find(
      (entry) => pseudo.plan.rules.find((rule) => rule.id === entry.id)?.pseudo === '::before',
    )?.targets[0];
    results.push({
      id: 'pseudo-element-conditional-marker',
      passed: pseudo.pure && pseudoTarget?.active === true && pseudoTarget.content === '"Label"',
      detail: pseudoTarget,
    });

    await page.setViewportSize({ width: 900, height: 800 });
    await mount(
      '.container{container-type:inline-size;width:300px} @media (width < 700px){@container (width < 400px){.x{color:red}}}',
      '<div class="container"><div class="x">Target</div></div>',
    );
    const mediaOff = await observe();
    await page.setViewportSize({ width: 600, height: 800 });
    const mediaOn = await observe();
    const conditional = (result: typeof mediaOff) =>
      result.observation.observations.find(
        (entry) => result.plan.rules.find((rule) => rule.id === entry.id)?.conditions.length,
      )?.targets[0];
    results.push({
      id: 'media-container-intersection',
      passed:
        mediaOff.pure &&
        mediaOn.pure &&
        conditional(mediaOff)?.active === false &&
        conditional(mediaOn)?.active === true,
      detail: { off: conditional(mediaOff), on: conditional(mediaOn) },
    });

    await mount('.x{color:red; &:hover{color:blue}}', '<div class="x">Target</div>');
    const nested = await observe();
    results.push({
      id: 'native-nesting-retained-as-gap',
      passed:
        nested.pure &&
        nested.plan.rules.some(
          (rule) =>
            rule.selector === '&:hover' && rule.gaps.includes('NATIVE_NESTING_BINDING_UNSUPPORTED'),
        ),
      detail: nested.plan,
    });

    await mount(
      '.x:has(.child:hover){color:red}',
      '<div class="x"><span class="child">Target</span></div>',
    );
    const complex = await observe();
    results.push({
      id: 'unsupported-selector-not-fabricated',
      passed:
        complex.pure &&
        complex.plan.rules.length === 1 &&
        complex.plan.rules[0].gaps.length > 0 &&
        complex.observation.observations.length === 0,
      detail: complex.plan,
    });
    await mount(
      '.container{container-type:inline-size;width:600px} html:has(head > style:nth-of-type(2)) .container{width:100px} @container (width < 500px){.x{color:red}}',
      '<div class="container"><div class="x">Target</div></div>',
    );
    const domIsolation = await observe();
    const isolated = domIsolation.observation.observations.find(
      (entry) => domIsolation.plan.rules.find((rule) => rule.id === entry.id)?.conditions.length,
    )?.targets[0];
    results.push({
      id: 'marker-does-not-insert-dom-nodes',
      passed:
        domIsolation.pure && isolated?.active === false && isolated.containers[0].width === 600,
      detail: isolated,
    });
    for (const relation of ['>', '+']) {
      await mount(
        `.x:hover ${relation} .label{color:red}`,
        relation === '>'
          ? '<div class="x"><span class="label">One</span></div><div class="x"><span class="label">Two</span></div>'
          : '<div class="x">One</div><span class="label">Target one</span><div class="x">Two</div><span class="label">Target two</span>',
      );
      const relationResult = await observe();
      const targets = relationResult.observation.observations[0].targets;
      results.push({
        id:
          relation === '>'
            ? 'ancestor-trigger-bound-to-each-target'
            : 'sibling-trigger-bound-to-each-target',
        passed:
          relationResult.pure &&
          targets.length === 2 &&
          targets.every((target) => target.triggers.length === 1) &&
          targets[0].triggers[0].key !== targets[1].triggers[0].key,
        detail: targets,
      });
    }
    await page.goto('about:blank');
    await page.evaluate(() => {
      const styles = {};
      Reflect.set(globalThis, '__getterReads', 0);
      Object.defineProperty(styles, 'root', {
        enumerable: true,
        get() {
          Reflect.set(
            globalThis,
            '__getterReads',
            Number(Reflect.get(globalThis, '__getterReads')) + 1,
          );
          return 'must-not-read';
        },
      });
      Object.defineProperty(globalThis, '__styleVerificationBindings', { value: { styles } });
    });
    let accessorRejected = false;
    try {
      await readRuntimeBindings(page);
    } catch (error) {
      if (!String(error).includes('STYLE_BINDING_ACCESSOR_UNSUPPORTED')) throw error;
      accessorRejected = true;
    }
    const reads = await page.evaluate(() => Reflect.get(globalThis, '__getterReads'));
    results.push({
      id: 'binding-observer-does-not-invoke-getters',
      passed: accessorRejected && reads === 0,
      detail: { accessorRejected, reads },
    });
    return {
      results,
      summary: { cases: results.length, failed: results.filter((result) => !result.passed).length },
    };
  } finally {
    await page.close();
  }
};
