/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupActionsBar } from './index';

const storeMock = vi.hoisted(() => ({ isGenerating: false }));

// Flexbox → passthrough so we can read the inner MessageActionBar stub.
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Stub the action bar to expose the resolved `bar` / `menu` slots verbatim.
vi.mock('../../components/MessageActionBar', () => ({
  MessageActionBar: ({ bar, menu }: { bar?: string[]; menu?: string[] }) => (
    <div
      data-bar={(bar ?? []).join(',')}
      data-menu={(menu ?? []).join(',')}
      data-testid="action-bar"
    />
  ),
}));

vi.mock('../../../components/Reaction', () => ({
  ReactionPicker: () => null,
}));

// isAssistantGroupItemGenerating(id) is called through useConversationStore; the
// mocked hook feeds the selector our controllable flag.
vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isAssistantGroupItemGenerating: () => (isGenerating: boolean) => isGenerating,
  },
  useConversationStore: (selector: (v: boolean) => unknown) => selector(storeMock.isGenerating),
}));

const data = { id: 'group-1', role: 'assistantGroup', tools: [] } as unknown as UIChatMessage;

const renderBar = (props: { contentId?: string }) =>
  render(<GroupActionsBar data={data} id="group-1" {...props} />);

describe('GroupActionsBar — hetero (assistantGroup) forward/select gating', () => {
  it('still generating with no text block → only delete', () => {
    storeMock.isGenerating = true;
    renderBar({ contentId: undefined });

    const bar = screen.getByTestId('action-bar');
    expect(bar).toHaveAttribute('data-bar', 'del');
    expect(bar).toHaveAttribute('data-menu', '');
  });

  it('finished but last block is a tool call → exposes share, select, and delete', () => {
    storeMock.isGenerating = false;
    renderBar({ contentId: undefined });

    const bar = screen.getByTestId('action-bar');
    const menu = bar.getAttribute('data-menu') ?? '';
    expect(menu.split(',')).toContain('select');
    expect(menu.split(',')).toContain('share');
    expect(menu.split(',')).toContain('del');
    expect(bar).toHaveAttribute('data-bar', 'delAndRegenerate');
  });

  it('finished with a trailing text block → full menu', () => {
    storeMock.isGenerating = false;
    renderBar({ contentId: 'block-text' });

    const bar = screen.getByTestId('action-bar');
    const menu = bar.getAttribute('data-menu') ?? '';
    expect(menu.split(',')).toContain('select');
    expect(menu.split(',')).toContain('share');
    expect(menu.split(',')).toContain('edit');
  });
});
