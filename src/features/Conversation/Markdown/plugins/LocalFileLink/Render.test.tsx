/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

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

    fireEvent.click(screen.getByRole('link', { name: 'Group.tsx' }));

    expect(screen.getByTestId('file-icon')).toHaveAttribute('data-file-name', 'Group.tsx');
    expect(screen.getByTestId('file-icon')).toHaveAttribute('data-size', '16');
    expect(useChatStore.getState().openLocalFiles).toEqual([
      {
        filePath: '/Users/me/project/src/Group.tsx',
        workingDirectory: '/Users/me/project',
      },
    ]);
    expect(useChatStore.getState().showPortal).toBe(true);
  });
});
