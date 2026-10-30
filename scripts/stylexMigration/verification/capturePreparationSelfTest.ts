import type { Browser } from '@playwright/test';

import { captureInPage, compareSnapshots } from '../experiment/capture';
import { createFastCapture } from '../experiment/fastCapture';
import { captureComponent } from './capture';

/** Independent legacy enumeration. Never share the optimized name list with the
 * reference collector: doing so could hide an omitted property in both trees. */
const referenceNamesInPage = () => {
  const root = document.querySelector('[data-case-root]')!;
  const names = new Set<string>();
  let rootProperties: string[] = [];
  for (const element of [root, ...root.querySelectorAll('*')].filter(
    (element) => !['LINK', 'META', 'SCRIPT', 'STYLE'].includes(element.tagName),
  ))
    for (const pseudo of [undefined, '::before', '::after', '::marker', '::placeholder']) {
      const current = [...getComputedStyle(element, pseudo)];
      current.forEach((name) => names.add(name));
      if (element === root && !pseudo)
        rootProperties = current.filter((name) => !name.startsWith('--'));
    }
  return {
    custom: [...names].filter((name) => name.startsWith('--')).sort(),
    properties: [...names].sort(),
    rootProperties,
    standard: [...names].filter((name) => !name.startsWith('--')).sort(),
  };
};

interface Case {
  css?: string;
  html: string;
  id: string;
  setup?: () => void;
  strict?: boolean;
  update?: () => void;
}
const cases: Case[] = [
  { id: 'raw-attributes-and-whitespace', html: '<div data-label="A" role="status"> Text </div>' },
  {
    id: 'node-local-custom-values',
    html: '<div style="--local:red">One</div><div style="--local:blue">Two</div>',
  },
  {
    id: 'inactive-pseudo-inventory',
    css: '.x::before{content:none;--inactive:retained}',
    html: '<div class="x">Text</div>',
  },
  {
    id: 'generated-pseudo',
    css: '.x::before{content:attr(data-label);--pseudo:red;color:var(--pseudo)}',
    html: '<div class="x" data-label="Label">Text</div>',
  },
  {
    id: 'list-marker',
    css: '.x::marker{content:"* ";--marker:red;color:var(--marker)}',
    html: '<ul><li class="x">Text</li></ul>',
  },
  {
    id: 'placeholder',
    css: '.x::placeholder{--placeholder:blue;color:var(--placeholder)}',
    html: '<input class="x" placeholder="Placeholder"/>',
  },
  { id: 'no-layout-node', html: '<div hidden style="--hidden:red">Hidden</div><div>Visible</div>' },
  {
    id: 'display-contents',
    html: '<div style="display:contents;--contents:red"><span>Text</span></div>',
  },
  {
    id: 'svg',
    html: '<svg viewBox="0 0 100 100"><path d="M0 0L20 20" style="--stroke:red;stroke:var(--stroke)"/></svg>',
  },
  {
    id: 'frozen-animation',
    css: '@keyframes fade{from{opacity:.2}to{opacity:.8}} .x{animation:fade 3s linear infinite}',
    html: '<div class="x">Text</div>',
  },
  {
    id: 'registered-non-inheriting-custom',
    css: '@property --registered{syntax:"<color>";inherits:false;initial-value:red} .x{--registered:blue}',
    html: '<div class="x"><span>Child</span></div>',
  },
  {
    id: 'new-document-and-width-freshness',
    css: '.box{container-type:inline-size;width:320px}@container(width<600px){.x{--narrow:red}}@container(width>=600px){.x{--wide:blue}}',
    html: '<div class="box"><div class="x">Text</div></div>',
    update: () => {
      (document.querySelector('.box') as HTMLElement).style.width = '800px';
    },
  },
  {
    id: 'generated-pseudo-state-freshness',
    css: '.box{container-type:inline-size;width:320px}.x::after{content:none;--after:red}@container(width>=600px){.x::after{content:"After";--after:blue}}',
    html: '<div class="box"><div class="x">Text</div></div>',
    update: () => {
      (document.querySelector('.box') as HTMLElement).style.width = '800px';
    },
  },
  {
    id: 'standard-property-union-fallback',
    html: '<span>Text</span>',
    strict: true,
    setup: () => {
      const original = getComputedStyle;
      Object.defineProperty(globalThis, 'getComputedStyle', {
        value: (element: Element, pseudo?: string) => {
          const computed = original(element, pseudo);
          if (element.tagName !== 'SPAN') return computed;
          return new Proxy(computed, {
            get(target, property) {
              if (property === 'length') return target.length + 1;
              if (property === 'item')
                return (index: number) =>
                  index === target.length ? 'verification-only-property' : target.item(index);
              if (property === 'getPropertyValue')
                return (name: string) =>
                  name === 'verification-only-property'
                    ? 'retained'
                    : target.getPropertyValue(name);
              if (property === Symbol.iterator)
                return function* () {
                  yield* target;
                  yield 'verification-only-property';
                };
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      });
    },
  },
];

/** Real browser parity with a strict, independently enumerated collector. */
export const runCapturePreparationSelfTest = async (browser: Browser) => {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const results = [];
  try {
    for (const entry of cases) {
      await page.goto('about:blank');
      await page.setContent(
        `<!doctype html><html><head><style>body{margin:0;font:14px Arial}${entry.css ?? ''}</style></head><body><main data-case-root>${entry.html}</main></body></html>`,
      );
      if (entry.setup) await page.evaluate(entry.setup);
      for (const phase of entry.update ? ['initial', 'updated'] : ['initial']) {
        if (phase === 'updated') await page.evaluate(entry.update!);
        const component = await captureComponent(page, cdp);
        const names = await page.evaluate(referenceNamesInPage);
        const reference = await page.evaluate(captureInPage, {
          animationTime: 0,
          ...(entry.strict ? {} : { properties: names.properties }),
        });
        const prepared = await page.evaluate(captureInPage, {
          animationTime: 0,
          collectMetadata: true,
        });
        const metadata = prepared.captureMetadata;
        const differences = compareSnapshots(reference, component.tree);
        const namesMatch =
          !!metadata &&
          JSON.stringify(metadata.custom) === JSON.stringify(names.custom) &&
          JSON.stringify(metadata.standard) === JSON.stringify(names.standard) &&
          JSON.stringify(metadata.rootProperties) === JSON.stringify(names.rootProperties);
        const inactiveRetained =
          entry.id !== 'inactive-pseudo-inventory' || metadata!.custom.includes('--inactive');
        const backendMatches = component.backend === (entry.strict ? 'strict' : 'hybrid');
        results.push({
          id: `${entry.id}:${phase}`,
          backend: component.backend,
          nodes: component.tree.nodes.length,
          differences,
          namesMatch,
          inactiveRetained,
          passed:
            !differences.length &&
            namesMatch &&
            inactiveRetained &&
            backendMatches &&
            component.tree.nodes.length > 1 &&
            !component.tree.captureMetadata,
        });
      }
    }
    await page.goto('about:blank');
    await page.setContent('<main data-case-root><div>One-shot</div></main>');
    const { captureMetadata, ...prepared } = await page.evaluate(captureInPage, {
      collectMetadata: true,
      animationTime: 0,
    });
    const once = await createFastCapture(page, cdp, {
      prepared,
      properties: captureMetadata!.rootProperties,
    });
    let wrongTimeRejected = false;
    let reuseRejected = false;
    try {
      await once(1);
    } catch (error) {
      if (!String(error).includes('PREPARED_CAPTURE_REQUIRES_TIME_ZERO')) throw error;
      wrongTimeRejected = true;
    }
    const first = await once(0);
    try {
      await once(0);
    } catch (error) {
      if (!String(error).includes('PREPARED_CAPTURE_ALREADY_USED')) throw error;
      reuseRejected = true;
    }
    results.push({
      id: 'prepared-frame-is-time-zero-and-single-use',
      backend: 'hybrid',
      nodes: first.nodes.length,
      differences: [],
      namesMatch: true,
      inactiveRetained: true,
      passed: wrongTimeRejected && reuseRejected && first.nodes.length > 1,
    });
    return {
      results,
      summary: { cases: results.length, failed: results.filter((entry) => !entry.passed).length },
    };
  } finally {
    await page.close();
  }
};
