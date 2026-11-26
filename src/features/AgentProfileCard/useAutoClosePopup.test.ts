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
    // A second card in the same app shares the router.
    wrapperForTest: ({ children }: { children: ReactNode }) =>
      createElement(RouterProvider, {
        router: createMemoryRouter([{ element: children, path: '*' }]),
      }),
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

  it('closes the open card instantly when another card opens', () => {
    const first = setup();
    const secondSetOpen = vi.fn();
    const second = renderHook(({ open }) => useAutoClosePopup({ open, setOpen: secondSetOpen }), {
      initialProps: { open: false },
      wrapper: first.wrapperForTest,
    });

    second.rerender({ open: true });

    expect(first.setOpen).toHaveBeenCalledWith(false);
    expect(first.result.current.instant).toBe(true);
    expect(secondSetOpen).not.toHaveBeenCalled();
  });

  it('closes on trigger press and keeps hover from reopening until the pointer leaves', () => {
    const { result, setOpen } = setup();

    act(() => result.current.triggerProps.onPointerDown());
    expect(setOpen).toHaveBeenLastCalledWith(false);
    expect(result.current.instant).toBe(true);

    setOpen.mockClear();
    act(() => result.current.onOpenChange(true));
    expect(setOpen).not.toHaveBeenCalled();

    act(() => result.current.triggerProps.onPointerLeave());
    act(() => result.current.onOpenChange(true));
    expect(setOpen).toHaveBeenCalledWith(true);
    // A normal open restores the regular exit transition.
    expect(result.current.instant).toBe(false);
  });

  it('leaves a click card alone on press, since that press opens it', () => {
    const setOpen = vi.fn();
    const { result } = renderHook(
      () => useAutoClosePopup({ open: false, setOpen, trigger: 'click' }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(RouterProvider, {
            router: createMemoryRouter([{ element: children, path: '*' }]),
          }),
      },
    );

    act(() => result.current.triggerProps.onPointerDown());
    act(() => result.current.onOpenChange(true));

    expect(setOpen).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it('closes instantly on navigation', async () => {
    const { navigate, result } = setup();

    await act(() => navigate('/agent/agt_coder'));

    expect(result.current.instant).toBe(true);
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
