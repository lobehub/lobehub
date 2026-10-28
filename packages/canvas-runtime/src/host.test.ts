import { act, createElement, useEffect } from 'react';
import { expect, it } from 'vitest';

import { createHostRoot } from './host';

it('unmounts rendered views and removes its root when the Canvas is destroyed', async () => {
  let effects = 0;
  const View = () => {
    useEffect(() => {
      effects++;
      return () => {
        effects--;
      };
    }, []);
    return createElement('button', { type: 'button' }, 'Canvas content');
  };
  const host = document.createElement('section');
  document.body.append(host);
  const root = createHostRoot({
    onError: (error) => {
      throw error;
    },
    wrap: (children) => children,
  });
  await act(async () => root.register(host, () => createElement(View)));
  expect(host.querySelector('button')?.textContent).toBe('Canvas content');
  expect(effects).toBe(1);
  await act(async () => root.destroy());
  expect(effects).toBe(0);
  expect(host.children).toHaveLength(0);
  expect(document.querySelector('[data-lobe-canvas-root]')).toBeNull();
  await act(async () => {
    root.update(host);
    root.register(host, () => createElement(View));
  });
  expect(host.children).toHaveLength(0);
  host.remove();
});
