// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildSandboxDocument } from './document';
import { sanitizeSandboxHtml } from './sanitize';

const nonce = 'test-frame-nonce-123456789';
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('sandbox document construction (DOM/unit tests, not browser CSP evidence)', () => {
  it('keeps free-form safe markup and local interactive controls', () => {
    const clean = parse(
      sanitizeSandboxHtml(
        '<section class="chart"><h2>Plan</h2><input id="cost" type="range" min="0" max="10"><button data-action="choose">Choose</button></section>',
      ),
    );
    expect(clean.querySelector('h2')?.textContent).toBe('Plan');
    expect(clean.querySelector('input')?.getAttribute('type')).toBe('range');
    expect(clean.querySelector('button')?.getAttribute('data-action')).toBe('choose');
    expect(clean.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('removes scripts, navigation, resources, namespaces and event handlers', () => {
    const clean = parse(
      sanitizeSandboxHtml(`
      <base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com">
      <script>top.location='https://example.com'</script><link rel="stylesheet" href="https://example.com/style.css">
      <a href="https://example.com" ping="https://example.com/ping" target="_top">Go</a>
      <form action="https://example.com"><button>Submit</button></form>
      <iframe src="https://example.com"></iframe><object data="https://example.com"></object><embed src="https://example.com">
      <img src="https://example.com" onerror="alert(1)"><svg><a href="https://example.com">Go</a></svg>
      <math><mtext><img src=x onerror=alert(1)></mtext></math>
      <div onclick="alert(1)" oncustom="alert(2)">Safe</div>
      <input type="file"><input type="password"><input formaction="https://example.com" type="text">
    `),
    );
    expect(
      clean.querySelector('script,base,meta,link,a,form,iframe,object,embed,img,svg,math'),
    ).toBeNull();
    expect(
      clean.querySelector('[onclick],[oncustom],[onerror],[formaction],[src],[href]'),
    ).toBeNull();
    expect(clean.querySelectorAll('input')).toHaveLength(1);
    expect(clean.querySelector('div')?.textContent).toBe('Safe');
  });

  it('renders streaming previews without any script or worker bootstrap', () => {
    const output = buildSandboxDocument(
      { html: '<p>Loading</p><script>alert(1)</script>', js: 'secretExecutableMarker()' },
      nonce,
      'preview',
    );
    const doc = parse(output);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(output).not.toContain('secretExecutableMarker');
    const csp = doc.querySelector('meta[http-equiv]')?.getAttribute('content');
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("worker-src 'none'");
  });

  it('contains closing-tag payloads in CSS and generated worker source', () => {
    const output = buildSandboxDocument(
      {
        css: 'p::after{content:"</style><script>parent.evil()</script>"}',
        html: '<p>Safe</p>',
        js: 'const x = "</script><img src=x onerror=parent.evil()>"; const y = "__LOBE_FRAME_TOKEN__"; lobeUI.setText("p", x + y);',
      },
      nonce,
      'complete',
    );
    const doc = parse(output);
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelector('script')?.getAttribute('nonce')).toBe(nonce);
    // Compile trusted Window source without running it. Generated code remains
    // a string here; this also catches accidental template placeholder rescans.
    expect(() => new Function(doc.querySelector('script')!.textContent!)).not.toThrow();
  });

  it('declares default-deny network and only the trusted nonce script', () => {
    const doc = parse(
      buildSandboxDocument(
        { html: '<div>Safe</div>', js: 'lobeUI.setText("div", "Ready")' },
        nonce,
        'complete',
      ),
    );
    const csp = doc.querySelector('meta[http-equiv]')!.getAttribute('content')!;
    for (const directive of [
      'default-src',
      'connect-src',
      'img-src',
      'frame-src',
      'form-action',
      'base-uri',
      'object-src',
    ]) {
      expect(csp).toContain(`${directive} 'none'`);
    }
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).toContain('worker-src blob:');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('rejects nonce injection and oversized source instead of weakening policy', () => {
    expect(() => buildSandboxDocument({ html: '' }, '" onload="evil()', 'complete')).toThrow();
    expect(() => buildSandboxDocument({ html: 'a'.repeat(100001) }, nonce, 'complete')).toThrow();
    expect(() =>
      buildSandboxDocument({ html: '', css: 'a'.repeat(50001) }, nonce, 'complete'),
    ).toThrow();
    expect(() =>
      buildSandboxDocument({ html: '', js: 'a'.repeat(100001) }, nonce, 'complete'),
    ).toThrow();
  });

  it('prevents generated names from impersonating trusted frame elements', () => {
    const doc = parse(
      buildSandboxDocument(
        {
          html: '<div id="__lobe_ui_root">Fake root</div><p id="__lobe_ui_status" name="__lobe_ui_status">Fake status</p>',
        },
        nonce,
        'complete',
      ),
    );
    expect(doc.querySelectorAll('#__lobe_ui_root')).toHaveLength(1);
    expect(doc.querySelectorAll('#__lobe_ui_status')).toHaveLength(1);
    expect(doc.querySelector('[name="__lobe_ui_status"]')).toBeNull();
  });
});
