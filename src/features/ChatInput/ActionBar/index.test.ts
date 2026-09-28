/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { filterChatOnlyActions } from './filterChatOnlyActions';
import Token from './Token/TokenTag';

const tokenMocks = vi.hoisted(() => ({
  useTokenBreakdown: vi.fn(),
}));

vi.mock('@lobehub/ui/chat', () => ({
  TokenTag: ({ value }: { value: number }) =>
    createElement('div', { 'data-testid': 'token-tag' }, value),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { config: () => ({ isDevMode: true }) },
}));

vi.mock('./components/ActionPopover', () => ({
  default: ({ children, content }: { children?: ReactNode; content?: ReactNode }) =>
    createElement('div', {}, children, content),
}));

vi.mock('./Token/TokenProgress', () => ({
  default: ({ data }: { data: { id: string; value: number }[] }) =>
    createElement(
      'div',
      { 'data-testid': `token-progress-${data[0].id}` },
      data.map(({ id, value }) => `${id}:${value}`).join(','),
    ),
}));

vi.mock('./Token/useTokenBreakdown', () => ({
  useTokenBreakdown: tokenMocks.useTokenBreakdown,
}));

beforeEach(() => {
  tokenMocks.useTokenBreakdown.mockReset();
});

describe('filterChatOnlyActions', () => {
  it('keeps runtime mode, attachments, formatting, and chat operations while hiding configuration actions', () => {
    expect(
      filterChatOnlyActions([
        'agentMode',
        'model',
        'search',
        'memory',
        'fileUpload',
        'tools',
        'voiceDictation',
        '---',
        ['typo', 'params', 'clear'],
      ]),
    ).toEqual(['agentMode', 'model', 'fileUpload', 'voiceDictation', '---', ['typo', 'clear']]);
  });

  it('keeps the model chip for chat-only members', () => {
    expect(filterChatOnlyActions(['model', 'plus'])).toEqual(['model', 'plus']);
  });
});

describe('Context window token', () => {
  it('reuses the settled tag breakdown when rendering details', () => {
    tokenMocks.useTokenBreakdown
      .mockReturnValueOnce({
        chatsToken: 3000,
        historySummaryToken: 500,
        maxTokens: 8000,
        systemRoleToken: 1500,
        toolsToken: 1000,
        totalToken: 6000,
      })
      .mockReturnValue({
        chatsToken: 0,
        historySummaryToken: 0,
        maxTokens: 8000,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 0,
      });

    render(createElement(Token));

    expect(tokenMocks.useTokenBreakdown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('token-tag')).toHaveTextContent('6000');
    expect(screen.getByTestId('token-progress-used')).toHaveTextContent('used:6000,rest:2000');
  });
});
