/**
 * @vitest-environment happy-dom
 */
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { Activity, createElement, type PointerEvent, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { useAutoClosePopup } from './useAutoClosePopup';

const setup = ({ open = true }: { open?: boolean } = {}) => {
  const setOpen = vi.fn();
  let router: ReturnType<typeof createMemoryRouter> | undefined;

  const wrapper = ({ children }: { children: ReactNode }) => {
    router ??= createMemoryRouter(
      [
        { element: children, path: '/' },
        { element: children, path: '/agent/:id' },
      ],
      { initialEntries: ['/'] },
    );
    return createElement(RouterProvider, { router });
  };

  const hook = renderHook(() => useAutoClosePopup({ open, setOpen }), { wrapper });

  return {
    ...hook,
    navigate: (to: string) => router!.navigate(to),
    setOpen,
  };
};

// renderHook publishes `result` from an effect, which a hidden <Activity> never
// runs, so the Activity case renders the flag and reads it from the DOM.
const setupProbe = () => {
  const setOpen = vi.fn();
  const Probe = () => {
    const { detached } = useAutoClosePopup({ open: true, setOpen });
    return createElement('span', { 'data-detached': String(detached) });
  };
  const router = createMemoryRouter([{ element: createElement(Probe), path: '/' }]);
  const tree = (hidden: boolean) =>
    createElement(
      Activity,
      { mode: hidden ? 'hidden' : 'visible' },
      createElement(RouterProvider, { router }),
    );
  const utils = render(tree(false));
  return {
    ...utils,
    hide: () => utils.rerender(tree(true)),
    setOpen,
    show: () => utils.rerender(tree(false)),
  };
};

const attachTrigger = (
  triggerProps: ReturnType<typeof useAutoClosePopup>['triggerProps'],
  parent: Element,
) => {
  const trigger = document.createElement('span');
  parent.append(trigger);
  triggerProps.onPointerEnter({ currentTarget: trigger } as unknown as PointerEvent<Element>);
  return trigger;
};

describe('useAutoClosePopup', () => {
  it('closes and detaches the card while an <Activity> hides the trigger', async () => {
    // Entering an Agent keeps the Home sidebar mounted in a hidden <Activity>.
    const { container, hide, setOpen, show } = setupProbe();
    const detached = () =>
      container.querySelector('[data-detached]')?.getAttribute('data-detached');
    expect(detached()).toBe('false');

    hide();

    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));
    await waitFor(() => expect(detached()).toBe('true'));

    // Back on Home the card can open again.
    show();
    await waitFor(() => expect(detached()).toBe('false'));
  });

  it('closes the card when the route changes', async () => {
    const { navigate, setOpen } = setup();
    expect(setOpen).not.toHaveBeenCalled();

    await act(() => navigate('/agent/agt_coder'));

    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('closes the card when only the query or hash changes', async () => {
    const { navigate, setOpen } = setup();

    await act(() => navigate('/?tab=agt_writer'));
    expect(setOpen).toHaveBeenCalledTimes(1);

    await act(() => navigate('/?tab=agt_writer#skills'));
    expect(setOpen).toHaveBeenCalledTimes(2);
  });

  it('closes the card when a container of the trigger scrolls, not when anything else does', () => {
    const { result, setOpen } = setup();
    const list = document.createElement('div');
    const card = document.createElement('div');
    document.body.append(list, card);
    attachTrigger(result.current.triggerProps, list);

    card.dispatchEvent(new Event('scroll'));
    expect(setOpen).not.toHaveBeenCalled();

    list.dispatchEvent(new Event('scroll'));
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('closes the card on Escape even when a focused editor stops the key', () => {
    const { setOpen } = setup();
    const editor = document.createElement('div');
    editor.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.append(editor);

    editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('listens for nothing while the card is closed', () => {
    const { result, setOpen } = setup({ open: false });
    const list = document.createElement('div');
    document.body.append(list);
    attachTrigger(result.current.triggerProps, list);

    list.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(setOpen).not.toHaveBeenCalled();
  });
});
