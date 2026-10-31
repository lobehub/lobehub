import { CANVAS_COMPONENT_MAP } from '@lobechat/canvas';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { defineCanvasElement } from './element';
import { type CanvasHostRoot, createHostRoot } from './host';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let hosts: CanvasHostRoot | undefined;
const getHosts = () => {
  hosts ??= createHostRoot({ onError: vi.fn(), wrap: (children) => children });
  return hosts;
};

const define = (tag: string, view: Parameters<typeof defineCanvasElement>[1]) =>
  customElements.define(tag, defineCanvasElement(CANVAS_COMPONENT_MAP.get(tag)!, view, getHosts));

beforeAll(() => {
  define('lobe-card', ({ props, slot }) => (
    <section data-title={props.title as string}>
      <span data-lobe-canvas-slot="" ref={slot} />
    </section>
  ));
  define('lobe-segmented', ({ change, items, value }) => (
    <div data-value={String(value)}>
      {items.map((item) => (
        <button key={item.attrs.value} type="button" onClick={() => change(item.attrs.value)}>
          {item.label}
        </button>
      ))}
    </div>
  ));
  define('lobe-tag', ({ props, slot }) => (
    <em data-color={props.color as string}>
      <span data-lobe-canvas-slot="" ref={slot} />
    </em>
  ));
});

afterEach(() => {
  document.body.querySelectorAll('main').forEach((node) => node.remove());
});

const mount = async (html: string) => {
  const main = document.createElement('main');
  main.innerHTML = html;
  await act(async () => {
    document.body.append(main);
  });
  return main;
};

describe('canvas elements', () => {
  it('keeps business DOM addressable while component rendering is pending', async () => {
    const main = document.createElement('main');
    main.innerHTML = '<lobe-card><button id="project-action">Run</button></lobe-card>';
    const button = main.querySelector('button')!;
    const listener = vi.fn();
    button.addEventListener('click', listener);

    await act(async () => {
      document.body.append(main);
      expect(document.getElementById('project-action')).toBe(button);
    });

    expect(main.querySelectorAll('#project-action')).toHaveLength(1);
    expect(document.getElementById('project-action')).toBe(button);
    button.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('renders every element through one shared React root and keeps light-DOM children', async () => {
    const main = await mount(
      '<lobe-card title="Cost"><p>Body <lobe-tag color="green">ok</lobe-tag></p></lobe-card><lobe-tag>second</lobe-tag>',
    );

    expect(document.querySelectorAll('[data-lobe-canvas-root]')).toHaveLength(1);
    expect(main.querySelector('section')?.dataset.title).toBe('Cost');
    expect(main.querySelector('section p')?.textContent).toBe('Body ok');
    expect(main.querySelector('lobe-card lobe-tag em')?.getAttribute('data-color')).toBe('green');
    expect(main.querySelectorAll('em')).toHaveLength(2);
  });

  it('reads option children as data and fires lobe-change with the new value', async () => {
    const main = await mount(
      '<lobe-segmented value="a"><lobe-option value="a">A</lobe-option><lobe-option value="b">B</lobe-option></lobe-segmented>',
    );
    const listener = vi.fn();
    main.addEventListener('lobe-change', (event) => listener((event as CustomEvent).detail));

    expect(main.querySelector('lobe-option')).toBeNull();
    await act(async () => {
      main.querySelectorAll('button')[1].click();
    });

    expect(listener).toHaveBeenCalledWith({ checked: false, value: 'b' });
    expect(main.querySelector('[data-value]')?.getAttribute('data-value')).toBe('b');
  });

  it('re-renders on attribute changes and stops rendering once removed', async () => {
    const main = await mount('<lobe-card title="Old"></lobe-card>');
    const card = main.querySelector('lobe-card')!;

    await act(async () => {
      card.setAttribute('title', 'New');
    });
    expect(main.querySelector('section')?.dataset.title).toBe('New');

    await act(async () => {
      card.remove();
    });
    expect(card.querySelector('section')).toBeNull();
  });
});
