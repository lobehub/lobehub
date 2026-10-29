import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureStyles, diffStyleSnapshots, packSnapshot, unpackSnapshot } from './snapshot';

const mount = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('captureStyles', () => {
  it('keys elements by their path under the root and labels them by tag and text', () => {
    const root = mount('<section><span>Hello world</span></section><p>Bye</p>');
    const keys = captureStyles(root).map(({ key, label }) => [key, label]);

    expect(keys).toEqual([
      ['0', 'SECTION:Hello world'],
      ['0.0', 'SPAN:Hello world'],
      ['1', 'P:Bye'],
    ]);
  });

  it('skips subtrees that are not rendered', () => {
    const root = mount('<div style="display: none"><span>hidden</span></div><p>shown</p>');

    expect(captureStyles(root).map(({ label }) => label)).toEqual(['P:shown']);
  });
  it('does not record boxes inside a running animation', () => {
    const root = mount('<div><span>spin</span></div><p>still</p>');
    const spinner = root.firstElementChild as HTMLElement;
    spinner.getAnimations = () => [{ playState: 'running' } as Animation];

    const entries = captureStyles(root);
    expect(entries.map(({ box, label }) => [label, box])).toEqual([
      ['DIV:spin', 'animated'],
      ['SPAN:spin', 'animated'],
      ['P:still', '0,0,0,0'],
    ]);
    expect(entries[0].style.opacity).toBe('animated');
  });

  it('records ::before and ::after that render content', () => {
    const root = mount('<p>a</p>');
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element);
      if (pseudo !== '::before') return style;
      return new Proxy(style, {
        get: (target, prop) =>
          prop === 'content' ? '"*"' : prop === 'color' ? 'red' : Reflect.get(target, prop),
      });
    });

    const entries = captureStyles(root);
    expect(entries.map(({ key, label }) => [key, label])).toEqual([
      ['0', 'P:a'],
      ['0::before', 'P::before:"*"'],
    ]);
    expect(entries[1].style.color).toBe('red');
  });

  it('refuses to capture while something under the root is scrolled', () => {
    const root = mount('<div><p>a</p></div>');
    Object.defineProperty(root.firstElementChild, 'scrollTop', { value: 120 });

    expect(() => captureStyles(root)).toThrow('0 DIV:a is scrolled');
  });
});

describe('diffStyleSnapshots', () => {
  it('reports changed properties and boxes per element', () => {
    const root = mount('<div style="color: red; width: 10px">a</div>');
    const before = captureStyles(root);
    (root.firstElementChild as HTMLElement).style.color = 'blue';
    const after = captureStyles(root);

    expect(diffStyleSnapshots(before, after)).toEqual([
      { changed: { color: ['red', 'blue'] }, key: '0', label: 'DIV:a' },
    ]);
  });

  it('reports text that changed, which explains layout shifts', () => {
    const root = mount('<p>7 minutes ago</p>');
    const before = captureStyles(root);
    root.firstElementChild!.textContent = '10 minutes ago';

    expect(diffStyleSnapshots(before, captureStyles(root))).toEqual([
      { key: '0', label: 'P:7 minutes ago', text: ['P:7 minutes ago', 'P:10 minutes ago'] },
    ]);
  });

  it('reports elements that only exist on one side', () => {
    const before = captureStyles(mount('<p>a</p>'));
    document.body.innerHTML = '';
    const after = captureStyles(mount('<p>a</p><b>b</b>'));

    expect(diffStyleSnapshots(before, after)).toEqual([{ added: true, key: '1', label: 'B:b' }]);
    expect(diffStyleSnapshots(after, before)).toEqual([{ key: '1', label: 'B:b', removed: true }]);
  });

  it('tracks transforms, which do not change a square box', () => {
    const root = mount('<div style="width: 10px; height: 10px">a</div>');
    const before = captureStyles(root);
    (root.firstElementChild as HTMLElement).style.transform = 'rotate(90deg)';

    expect(diffStyleSnapshots(before, captureStyles(root))[0].changed).toHaveProperty('transform');
  });

  it('returns nothing for identical snapshots', () => {
    const root = mount('<div style="padding: 4px"><span>x</span></div>');

    expect(diffStyleSnapshots(captureStyles(root), captureStyles(root))).toEqual([]);
  });
});

describe('packSnapshot', () => {
  it('stores each distinct style once and restores the entries', () => {
    const root = mount('<p style="color: red">a</p><p style="color: red">b</p><p>c</p>');
    const entries = captureStyles(root);
    const packed = packSnapshot(entries);

    expect(packed.styles).toHaveLength(2);
    expect(unpackSnapshot(packed)).toEqual(entries);
  });
});
