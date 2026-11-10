import type { Browser } from '@playwright/test';

import { captureComponent } from '../browser/capture';
import { compareComponents } from '../browser/compareSnapshots';
import { collectRulesInPage } from '../browser/ruleInventory';

interface Case {
  after: string;
  before: string;
  expected: 'difference' | 'equal' | 'review';
  id: string;
}

/** Infrastructure corpus, not substitutes for actual React component fixtures. */
const cases: Case[] = [
  {
    after: '<div style="color:blue">Text</div>',
    before: '<div style="color:red">Text</div>',
    expected: 'difference',
    id: 'resolved-color',
  },
  {
    after: '<div hidden style="color:blue">Text</div>',
    before: '<div hidden style="color:red">Text</div>',
    expected: 'difference',
    id: 'no-layout-hidden',
  },
  {
    after: '<div style="display:contents;color:blue">Text</div>',
    before: '<div style="display:contents;color:red">Text</div>',
    expected: 'difference',
    id: 'display-contents',
  },
  {
    after: '<svg><path d="M0 0L20 20" /></svg>',
    before: '<svg><path d="M0 0L10 10" /></svg>',
    expected: 'difference',
    id: 'svg-path-attributes',
  },
  {
    after: '<div style="white-space:pre">Text</div>',
    before: '<div style="white-space:pre"> Text </div>',
    expected: 'difference',
    id: 'raw-text-whitespace',
  },
  {
    after: '<div style="--unknown:blue">Text</div>',
    before: '<div style="--unknown:red">Text</div>',
    expected: 'review',
    id: 'unproven-custom-property',
  },
  {
    after: '<div style="--x:blue;color:var(--x)">Text</div>',
    before: '<div style="--x:red;color:var(--x)">Text</div>',
    expected: 'difference',
    id: 'custom-consumer',
  },
  {
    after: '<style>.x::before{content:"x";--pseudo:blue}</style><div class="x">Text</div>',
    before: '<style>.x::before{content:"x";--pseudo:red}</style><div class="x">Text</div>',
    expected: 'review',
    id: 'pseudo-only-custom-property',
  },
  {
    after: '<div class="new" style="color:blue">Text</div>',
    before: '<div class="old" style="color:blue">Text</div>',
    expected: 'equal',
    id: 'generated-class-rename',
  },
  {
    after: '<div style="border:0 none blue">Text</div>',
    before: '<div style="border:0 none red">Text</div>',
    expected: 'equal',
    id: 'nonpainting-border',
  },
  {
    after: '<style>.unused{color:blue}</style><div>Text</div>',
    before: '<style>.unused{color:red}</style><div>Text</div>',
    expected: 'equal',
    id: 'unmatched-rule-inventory-only',
  },
];

export const runCollectorSelfTest = async (browser: Browser) => {
  const pages = await Promise.all([browser.newPage(), browser.newPage(), browser.newPage()]);
  const sessions = await Promise.all(
    pages.map(async (page) => {
      await page.route('**/*', (route) => route.abort());
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      return cdp;
    }),
  );
  const results = [];
  try {
    for (const entry of cases) {
      await Promise.all(
        pages.map((page, index) =>
          page.setContent(
            `<!doctype html><html><head><style>body{margin:0;font:14px Arial}</style></head><body><main data-case-root>${index === 2 ? entry.after : entry.before}</main></body></html>`,
          ),
        ),
      );
      const [before, aa, after] = await Promise.all(
        pages.map((page, index) => captureComponent(page, sessions[index])),
      );
      const control = compareComponents(before, aa);
      const comparison = compareComponents(before, after);
      const inventory = await pages[0].evaluate(collectRulesInPage);
      const actual = comparison.differences.length
        ? 'difference'
        : comparison.review.length
          ? 'review'
          : 'equal';
      const retainedUnmatchedRule =
        entry.id !== 'unmatched-rule-inventory-only' ||
        inventory.rules.some((rule) => rule.selector === '.unused');
      results.push({
        actual,
        aaDifferences: control.raw.length,
        backend: before.backend,
        comparison,
        expected: entry.expected,
        id: entry.id,
        nodes: before.tree.nodes.length,
        passed: actual === entry.expected && !control.raw.length && retainedUnmatchedRule,
      });
    }
    return {
      results,
      summary: {
        cases: results.length,
        failed: results.filter((entry) => !entry.passed).length,
        independentControls: results.length,
      },
    };
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
};
