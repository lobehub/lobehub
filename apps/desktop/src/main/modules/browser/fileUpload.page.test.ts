/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { FILE_INPUT_OF, uploadTargetExpression } from './fileUpload';

/** Runs the in-page scripts the way the DevTools protocol does. */
const targetOf = (ref?: string, selector?: string) =>
  (0, eval)(uploadTargetExpression(ref, selector)) as Element | string;
const fileInputOf = (el: Element) =>
  (0, eval)(`(${FILE_INPUT_OF})`).call(el) as HTMLInputElement | null;

describe('upload target in the page', () => {
  beforeEach(() => {
    (window as any).__lobeBrowserRefs = undefined;
  });

  it('resolves a snapshot ref, and asks for a new snapshot when it is stale', () => {
    document.body.innerHTML = '<button id="b">Upload</button>';
    (window as any).__lobeBrowserRefs = { e1: document.querySelector('#b') };

    expect(targetOf('e1')).toBe(document.querySelector('#b'));
    expect(targetOf('e2')).toBe('ref not found — take a new snapshot first');
  });

  it('resolves a selector and reports one that matches nothing or is invalid', () => {
    document.body.innerHTML = '<input type="file" id="f" />';

    expect(targetOf(undefined, '#f')).toBe(document.querySelector('#f'));
    expect(targetOf(undefined, '#nope')).toBe('no element matches the selector #nope');
    expect(targetOf(undefined, '[[')).toBe('invalid CSS selector: [[');
  });

  it("takes the page's only file input when nothing is named", () => {
    document.body.innerHTML = '<input type="file" id="f" />';
    expect(targetOf()).toBe(document.querySelector('#f'));

    document.body.innerHTML = '<input type="file" /><input type="file" />';
    expect(targetOf()).toContain('2 file inputs');

    document.body.innerHTML = '<button>Upload</button>';
    expect(targetOf()).toContain('no file input');
  });
});

describe('file input behind the target', () => {
  it('is the target itself, or the input its label points at', () => {
    document.body.innerHTML =
      '<input type="file" id="f" style="display:none" /><label for="f" id="l">Choose</label>';

    expect(fileInputOf(document.querySelector('#f')!)).toBe(document.querySelector('#f'));
    expect(fileInputOf(document.querySelector('#l')!)).toBe(document.querySelector('#f'));
  });

  // An upload widget hides its input next to the button the user clicks.
  it('is the lone hidden input in a near ancestor of the button', () => {
    document.body.innerHTML = `
      <div class="upload"><input type="file" id="f" hidden />
        <div class="trigger"><div><button id="b">Add images</button></div></div>
      </div>`;

    expect(fileInputOf(document.querySelector('#b')!)).toBe(document.querySelector('#f'));
  });

  it('is nothing when the nearest ancestor holds two inputs or none', () => {
    document.body.innerHTML = `
      <div><input type="file" /><input type="file" /><button id="b">Upload</button></div>
      <button id="lone">Import</button>`;

    expect(fileInputOf(document.querySelector('#b')!)).toBeNull();
    expect(fileInputOf(document.querySelector('#lone')!)).toBeNull();
  });
});
