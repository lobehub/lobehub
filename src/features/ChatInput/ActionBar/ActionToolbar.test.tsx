/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActionBarContext } from './context';
import ActionToolbar from './index';

vi.mock('../ActionBar/config', async () => {
  const { useActionBarContext } = await import('./context');
  const ContextProbe = () => {
    const { actionSize, borderRadius } = useActionBarContext();
    return createElement('div', {
      'data-border-radius': String(borderRadius),
      'data-size': actionSize ? `${actionSize.blockSize}/${actionSize.size}` : 'none',
      'data-testid': 'probe',
    });
  };
  return { actionMap: { search: ContextProbe } };
});

vi.mock('@lobehub/editor/react', () => ({
  ChatInputActions: ({ items }: { items: { children?: ReactNode; key: string }[] }) =>
    createElement(
      'div',
      {},
      items.map((item) => createElement('div', { key: item.key }, item.children)),
    ),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: object) => unknown) =>
    selector({ toggleExpandInputActionbar: vi.fn() }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { expandInputActionbar: () => false },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/slices/preference/selectors', () => ({
  labPreferSelectors: { enableInputMarkdown: () => false },
}));

vi.mock('../hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canConfigureResource: true, canShowControls: true }),
}));

vi.mock('../store', () => ({
  useChatInputStore: (selector: (state: object) => unknown) =>
    selector({ leftActions: ['search'], mobile: false }),
}));

describe('ActionToolbar', () => {
  it('keeps the action size from an outer ActionBarContext', () => {
    render(
      createElement(
        ActionBarContext,
        { value: { actionSize: { blockSize: 28, size: 16 } } },
        createElement(ActionToolbar, { borderRadius: 12 }),
      ),
    );

    const probe = screen.getByTestId('probe');
    expect(probe.dataset.size).toBe('28/16');
    expect(probe.dataset.borderRadius).toBe('12');
  });

  it('leaves the action size unset without an outer context', () => {
    render(createElement(ActionToolbar));

    expect(screen.getByTestId('probe').dataset.size).toBe('none');
  });
});
