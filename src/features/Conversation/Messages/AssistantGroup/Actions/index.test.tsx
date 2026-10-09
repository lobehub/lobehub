/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssistantActionsBar } from '../../Assistant/Actions';
import type { MessageActionSlot } from '../../components/MessageActionBar';
import { UserActionsBar } from '../../User/Actions';
import { GroupActionsBar } from './index';

const storeMock = vi.hoisted(() => ({ isGenerating: false }));

// Stub the action bar to expose the resolved `bar` / `menu` slots verbatim.
vi.mock('../../components/MessageActionBar', () => ({
  MessageActionBar: ({
    bar,
    leading,
    menu,
  }: {
    bar?: MessageActionSlot[];
    leading?: React.ReactNode;
    menu?: MessageActionSlot[];
  }) => (
    <div
      data-bar={(bar ?? []).join(',')}
      data-has-leading={!!leading}
      data-menu={(menu ?? []).join(',')}
      data-testid="action-bar"
    >
      {leading}
    </div>
  ),
}));

vi.mock('../../../components/Reaction', () => ({
  ReactionPicker: () => <span data-testid="reaction-picker" />,
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

describe('message action defaults', () => {
  it('does not expose the retired text-to-speech action', () => {
    render(
      <>
        <AssistantActionsBar
          data={{ content: 'Assistant reply', role: 'assistant' } as UIChatMessage}
          id="assistant-1"
        />
        <UserActionsBar
          data={{ content: 'User prompt', role: 'user' } as UIChatMessage}
          id="user-1"
        />
      </>,
    );

    for (const bar of screen.getAllByTestId('action-bar')) {
      expect(bar.getAttribute('data-menu')?.split(',')).not.toContain('tts');
    }
  });
});

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

  /** @example A completed tool-only Codex turn must keep its original messages on regenerate. */
  it('honors action overrides for a completed group without final text', () => {
    // ROOT CAUSE:
    // The no-text early return bypassed Codex overrides and used
    // delAndRegenerate, deleting tool history before a replacement could succeed.
    // Applying the full override must still exclude copy/edit without a text block.
    storeMock.isGenerating = false;
    render(
      <GroupActionsBar
        data={data}
        id="group-1"
        actionsConfig={{
          bar: ['copy', 'edit', 'regenerate'],
          menu: ['copy', 'edit', 'regenerate', 'select', 'del'],
        }}
      />,
    );
    expect(screen.getByTestId('action-bar')).toHaveAttribute('data-bar', 'regenerate');
    expect(screen.getByTestId('action-bar')).toHaveAttribute('data-menu', 'regenerate,select,del');
  });

  it('keeps the defaults for a completed group when the override has no regenerate', () => {
    storeMock.isGenerating = false;
    render(
      <GroupActionsBar
        actionsConfig={{ bar: ['copy'], menu: ['copy', 'divider', 'select', 'divider', 'del'] }}
        data={data}
        id="group-1"
      />,
    );
    const bar = screen.getByTestId('action-bar');
    expect(bar).toHaveAttribute('data-bar', 'delAndRegenerate');
    expect(bar.getAttribute('data-menu')?.split(',')).toContain('share');
  });

  /** @example Streaming tool-only groups remain restricted even with a Codex override. */
  it('keeps streaming no-text groups restricted with an override', () => {
    storeMock.isGenerating = true;
    render(
      <GroupActionsBar
        actionsConfig={{ bar: ['regenerate'], menu: ['regenerate'] }}
        data={data}
        id="group-1"
      />,
    );
    expect(screen.getByTestId('action-bar')).toHaveAttribute('data-bar', 'del');
    expect(screen.getByTestId('action-bar')).toHaveAttribute('data-menu', '');
  });

  it('finished with a trailing text block → full menu', () => {
    storeMock.isGenerating = false;
    renderBar({ contentId: 'block-text' });

    const bar = screen.getByTestId('action-bar');
    const menu = bar.getAttribute('data-menu') ?? '';
    expect(menu.split(',')).toContain('select');
    expect(menu.split(',')).toContain('share');
    expect(menu.split(',')).toContain('edit');
    expect(bar).toHaveAttribute('data-has-leading', 'true');
    expect(screen.getByTestId('reaction-picker')).toBeInTheDocument();
  });
});
