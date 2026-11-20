import type { Browser } from '@playwright/test';

import {
  captureInPage,
  compareSnapshots,
} from '../../../../packages/style-equivalence/src/capture/snapshot';
import { readConditionHostInPage } from '../analysis/conditionProbePlanner';
import { collectRuleWitnessesInPage, planRuleWitnesses } from '../analysis/ruleWitnesses';
import { captureComponent } from '../browser/capture';
import { collectRulesInPage } from '../browser/ruleInventory';
import type { CaptureSurface } from '../browser/surfaces';
import { resolveCaptureSurfacesInPage } from '../browser/surfaces';

/** Executed by the local browser self-test, never by the application test suite. */
export const runSurfaceSelfTest = async (browser: Browser) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', (route) => route.abort());
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const results: Array<{ id: string; passed: boolean; detail?: unknown }> = [];
  const surfaces: CaptureSurface[] = [{ id: 'popup', kind: 'portal', selector: '.popup' }];
  try {
    await page.setContent(`<!doctype html><style>
      body{margin:0}.popup{position:absolute;left:20px;top:50px;color:blue;--local:blue}
      .popup::before{content:'Before';color:purple}.other{color:red}
    </style><main data-case-root><div data-component-mount><button>Trigger</button></div></main>
    <section class="popup"><span>Blue</span><span hidden>Hidden</span><svg><path d="M0 0L5 5"/></svg></section>
    <aside class="popup other">Red leaf</aside><footer>Unrelated fixture content</footer>`);
    const snapshot = await captureComponent(page, cdp, undefined, { surfaces, variant: 'open' });
    results.push({
      id: 'multiple-roots-pseudos-leaf-svg-hidden',
      passed:
        snapshot.scope?.roots.length === 3 &&
        new Set(snapshot.tree.nodes.map((node) => node.key)).size === snapshot.tree.nodes.length &&
        snapshot.tree.nodes.some((node) => node.key === 'surface:popup:0/root::before') &&
        snapshot.tree.nodes.some((node) => node.tag === 'path') &&
        !snapshot.tree.nodes.some((node) => node.tag === 'FOOTER') &&
        snapshot.tree.styles[
          snapshot.tree.nodes.find((node) => node.key === 'surface:popup:0/root')!.style
        ].color === 'rgb(0, 0, 255)' &&
        snapshot.tree.styles[
          snapshot.tree.nodes.find((node) => node.key === 'surface:popup:1/root')!.style
        ].color === 'rgb(255, 0, 0)',
    });
    for (const root of snapshot.scope!.roots) {
      const properties = ['color', 'display', 'height', 'background-color', 'animation-name'];
      const reference = await page.evaluate(captureInPage, {
        ...root,
        originSelector: '[data-case-root]',
        properties,
      });
      const measured = {
        ...snapshot.tree,
        nodes: snapshot.tree.nodes.filter((node) => node.key.startsWith(`${root.keyPrefix}root`)),
        styles: snapshot.tree.styles.map((style) =>
          Object.fromEntries(properties.map((property) => [property, style[property]])),
        ),
      };
      results.push({
        id: `strict-hybrid-parity:${root.keyPrefix || 'main'}`,
        passed: compareSnapshots(reference, measured).length === 0,
      });
    }
    const first = await page.evaluate(resolveCaptureSurfacesInPage, { surfaces });
    const second = await page.evaluate(resolveCaptureSurfacesInPage, { surfaces });
    results.push({
      id: 'repeat-resolution-stable',
      passed: JSON.stringify(first) === JSON.stringify(second),
    });
    for (const [id, definition, error] of [
      ['missing', { id: 'missing', kind: 'portal', selector: '.absent' }, 'SURFACE_NOT_MOUNTED'],
      [
        'invalid-selector',
        { id: 'invalid', kind: 'portal', selector: '[' },
        'SURFACE_SELECTOR_INVALID',
      ],
      ['broad-body', { id: 'body', kind: 'portal', selector: 'body' }, 'SURFACE_CONTAINS_ROOT'],
      [
        'misclassified',
        { id: 'wrong', kind: 'component', selector: '.popup' },
        'SURFACE_OUTSIDE_ROOT',
      ],
    ] as const) {
      let message = '';
      try {
        await page.evaluate(resolveCaptureSurfacesInPage, { surfaces: [definition] });
      } catch (caught) {
        message = String(caught);
      }
      results.push({ id, passed: message.includes(error) });
    }
    const closed = await page.evaluate(resolveCaptureSurfacesInPage, {
      surfaces: [
        { id: 'conditional', kind: 'portal', selector: '.absent', variants: ['open'] },
      ] satisfies CaptureSurface[],
      variant: 'closed',
    });
    results.push({
      id: 'closed-variant-explicitly-excludes-popup',
      passed: closed.roots.length === 1 && closed.surfaces.length === 0,
    });
    await page.setContent(
      '<main data-case-root><div data-component-mount><div class="inside">Inside</div></div></main><section class="outer"><span class="inner">Nested</span></section>',
    );
    const overlap = await page.evaluate(resolveCaptureSurfacesInPage, {
      surfaces: [
        { id: 'inner', kind: 'portal', selector: '.inner' },
        { id: 'outer', kind: 'portal', selector: '.outer' },
        { id: 'duplicate', kind: 'portal', selector: '.outer' },
        { id: 'inside', kind: 'portal', selector: '.inside' },
      ] satisfies CaptureSurface[],
    });
    results.push({
      id: 'nested-overlapping-and-in-root-deduplicated',
      passed: overlap.roots.length === 2 && overlap.surfaces.length === 4,
    });
    await page.setContent(
      '<style>.popup:hover{color:red}</style><main data-case-root><div data-component-mount><button>Trigger</button></div></main><section class="popup"><span>Content</span></section>',
    );
    const scope = await page.evaluate(resolveCaptureSurfacesInPage, { surfaces });
    const plan = planRuleWitnesses(
      await page.evaluate(collectRulesInPage),
      {
        bindings: [
          {
            kind: 'css-module',
            symbol: 'styles',
            slots: [{ name: 'popup', start: 0, end: 1, unitId: 'popup' }],
          },
        ],
        gaps: [],
        source: 'corpus.css',
        sourceHash: 'controlled',
        stylesheets: [],
      },
      { styles: { popup: 'popup' } },
    );
    const document = await cdp.send('DOM.getDocument');
    const target = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '.popup',
    });
    await cdp.send('CSS.forcePseudoState', {
      nodeId: target.nodeId,
      forcedPseudoClasses: ['hover'],
    });
    const observation = await page.evaluate(collectRuleWitnessesInPage, {
      nonce: '0123456789abcdef',
      rules: plan.rules,
      roots: scope.roots,
    });
    const host = await page.evaluate(readConditionHostInPage, {
      hover: '.popup',
      roots: scope.roots,
    });
    results.push({
      id: 'portal-rule-witness-and-trigger-use-capture-keys',
      passed:
        observation.observations[0]?.targets[0]?.active === true &&
        observation.observations[0]?.targets[0]?.key === 'surface:popup:0/root' &&
        observation.observations[0]?.targets[0]?.triggers[0]?.key === host.legacyTriggerKeys.hover,
    });
  } finally {
    await context.close();
  }
  return {
    results,
    summary: { cases: results.length, failed: results.filter((result) => !result.passed).length },
  };
};
