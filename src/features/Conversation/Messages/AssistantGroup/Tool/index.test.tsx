/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from '@/features/Conversation/store';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';

import Tool from './index';

vi.mock('react-i18next', () => ({
  Trans: ({ children }: PropsWithChildren) => children,
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

const transcript = [
  { content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
  {
    content: '',
    createdAt: 1,
    id: 'a1',
    parentId: 'u1',
    role: 'assistant',
    tools: [
      {
        apiName: 'Bash',
        arguments: JSON.stringify({ command: 'ls', description: 'list files' }),
        id: 'call_1',
        identifier: 'claude-code',
        type: 'builtin',
      },
    ],
    updatedAt: 1,
  },
  {
    content: 'a.txt',
    createdAt: 2,
    id: 't1',
    parentId: 'a1',
    role: 'tool',
    tool_call_id: 'call_1',
    updatedAt: 2,
  },
] as UIChatMessage[];

const renderTool = (props: { disableEditing?: boolean } = {}) => {
  const store = createStore({
    context: { agentId: 'agent', threadId: null, topicId: 'topic' },
    messages: transcript,
  });
  return render(
    <ServerConfigStoreProvider>
      <Provider createStore={() => store}>
        <Tool assistantMessageId="a1" id="call_1" {...props} />
      </Provider>
    </ServerConfigStoreProvider>,
  );
};

// ActionIcon titles render as tooltips, so find the accordion's action slot.
const debugAction = () => document.querySelector('.lobe-accordion__action .lucide-bug');

describe('Tool row actions', () => {
  afterEach(() => cleanup());

  /** @example The hover-only actions were most of each row's DOM in a 500-step list. */
  it('mounts the hover actions only once the row is pointed at', () => {
    const { container } = renderTool();

    // The collapsed row is there (its trigger), just without the actions.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(debugAction()).toBeNull();

    fireEvent.pointerEnter(container.firstElementChild!);

    expect(debugAction()).toBeInTheDocument();
  });

  it('mounts the actions when the row receives keyboard focus', () => {
    renderTool();
    expect(debugAction()).toBeNull();

    // React's onFocus listens to the bubbling `focusin`.
    fireEvent.focusIn(screen.getAllByRole('button')[0]);

    expect(debugAction()).toBeInTheDocument();
  });

  it('never mounts the actions when editing is disabled', () => {
    const { container } = renderTool({ disableEditing: true });

    fireEvent.pointerEnter(container.firstElementChild!);

    expect(debugAction()).toBeNull();
  });
});
