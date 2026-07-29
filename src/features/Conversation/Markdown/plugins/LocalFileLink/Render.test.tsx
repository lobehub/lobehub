/**
 * @vitest-environment happy-dom
 */
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { createLocalFileTabId } from '@/store/chat/slices/portal/helpers';

import type { MarkdownElementProps } from '../type';
import Render from './Render';

interface LocalFileLinkProperties {
  linkHref?: string;
  linkLabel?: string;
}

const createRenderProps = (
  properties: LocalFileLinkProperties,
): MarkdownElementProps<LocalFileLinkProperties> => ({
  children: null,
  id: 'local-file-link',
  node: {
    properties,
  },
  tagName: 'lobeLocalFileLink',
  type: 'element',
});

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

vi.mock('@/components/FileIcon', () => ({
  default: ({ fileName, size }: { fileName: string; size?: number }) => (
    <span data-file-name={fileName} data-size={size} data-testid="file-icon" />
  ),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  Tooltip: ({
    children,
    mouseEnterDelay,
    placement,
    title,
  }: {
    children: ReactNode;
    mouseEnterDelay?: number;
    placement?: string;
    title?: ReactNode;
  }) => (
    <span
      data-mouse-enter-delay={String(mouseEnterDelay)}
      data-placement={placement}
      data-testid="local-file-tooltip"
      data-title={typeof title === 'string' ? title : undefined}
    >
      {children}
    </span>
  ),
}));

describe('LocalFileLink Render', () => {
  afterEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  it('opens local file links in the right-side local file portal', () => {
    useChatStore.setState({
      activeAgentId: 'agent-1',
      activeTopicId: 'topic-1',
      topicDataMap: {
        'agent_agent-1': {
          items: [
            {
              id: 'topic-1',
              metadata: { workingDirectory: '/Users/me/project' },
            },
          ],
          total: 1,
        },
      } as any,
    });

    render(
      <Render
        {...createRenderProps({
          linkHref: '/Users/me/project/src/Group.tsx:265',
          linkLabel: 'Group.tsx',
        })}
      />,
    );

    const link = screen.getByRole('link', { name: 'Group.tsx' });

    expect(screen.getByTestId('local-file-tooltip')).toHaveAttribute(
      'data-title',
      '/Users/me/project/src/Group.tsx (line 265)',
    );
    expect(screen.getByTestId('local-file-tooltip')).toHaveAttribute(
      'data-mouse-enter-delay',
      '0.1',
    );
    expect(screen.getByTestId('local-file-tooltip')).toHaveAttribute('data-placement', 'topLeft');

    fireEvent.click(link);

    expect(screen.getByTestId('file-icon')).toHaveAttribute('data-file-name', 'Group.tsx');
    expect(screen.getByTestId('file-icon')).toHaveAttribute('data-size', '16');
    expect(useChatStore.getState().openLocalFiles).toEqual([
      {
        allowExternalFilePreview: false,
        filePath: '/Users/me/project/src/Group.tsx',
        id: createLocalFileTabId({
          filePath: '/Users/me/project/src/Group.tsx',
          workingDirectory: '/Users/me/project',
        }),
        workingDirectory: '/Users/me/project',
      },
    ]);
    expect(useChatStore.getState().showPortal).toBe(true);
  });

  it('claims the link so the desktop preload does not open it in the system browser', () => {
    render(
      <Render
        {...createRenderProps({
          linkHref: '/Users/me/project/src/Group.tsx',
          linkLabel: 'Group.tsx',
        })}
      />,
    );

    const link = screen.getByRole('link', { name: 'Group.tsx' });
    expect(link).toHaveAttribute(RENDERER_HANDLED_LINK_ATTR, 'true');

    // A modifier-click has no meaning on desktop — the portal still takes it.
    fireEvent.click(link, { metaKey: true });
    expect(useChatStore.getState().openLocalFiles).toHaveLength(1);
  });

  it('marks links outside the current workspace as user-approved external previews', () => {
    useChatStore.setState({
      activeAgentId: 'agent-1',
      activeTopicId: 'topic-1',
      topicDataMap: {
        'agent_agent-1': {
          items: [
            {
              id: 'topic-1',
              metadata: { workingDirectory: '/Users/me/project' },
            },
          ],
          total: 1,
        },
      } as any,
    });

    render(
      <Render
        {...createRenderProps({
          linkHref: '/tmp/worktree-switcher-demo.html',
          linkLabel: 'worktree-switcher-demo.html',
        })}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'worktree-switcher-demo.html' }));

    expect(useChatStore.getState().openLocalFiles).toEqual([
      {
        allowExternalFilePreview: true,
        filePath: '/tmp/worktree-switcher-demo.html',
        id: createLocalFileTabId({
          filePath: '/tmp/worktree-switcher-demo.html',
          workingDirectory: '/tmp',
        }),
        workingDirectory: '/tmp',
      },
    ]);
  });
});
