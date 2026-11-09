/**
 * @vitest-environment happy-dom
 */
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import type { TooltipProps } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { createLocalFileTabId } from '@/store/chat/slices/portal/helpers';
import { useDeviceStore } from '@/store/device';
import { DEVICE_LIST_KEY } from '@/store/device/projection';

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

const platform = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return platform.isDesktop;
  },
}));

vi.mock('@/components/FileIcon', () => ({
  default: ({ fileName, size }: { fileName: string; size?: number }) => (
    <span data-file-name={fileName} data-size={size} data-testid="file-icon" />
  ),
}));

const tooltipPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const ActualTooltip = actual.Tooltip as ComponentType<TooltipProps>;
  return {
    ...actual,
    Tooltip: (props: TooltipProps) => {
      tooltipPropsSpy(props);
      return <ActualTooltip {...props} />;
    },
  };
});

describe('LocalFileLink Render', () => {
  afterEach(() => {
    platform.isDesktop = true;
    useChatStore.setState(useChatStore.getInitialState());
    useDeviceStore.setState(useDeviceStore.getInitialState());
  });

  it.each(['/home/ubuntu/workspace/src/client.ts:391', './src/client.ts:391'])(
    'renders %s as a non-navigable file reference on web',
    (href) => {
      platform.isDesktop = false;
      const { container } = render(
        <Render {...createRenderProps({ linkHref: href, linkLabel: 'client.ts' })} />,
      );

      expect(screen.queryByRole('link')).toBeNull();
      expect(container.querySelector('[href]')).toBeNull();
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-file-name', 'client.ts');
      fireEvent.click(screen.getByText('client.ts'));
      fireEvent.click(screen.getByText('client.ts'), { metaKey: true });
      fireEvent(
        screen.getByText('client.ts'),
        new MouseEvent('auxclick', { bubbles: true, button: 1 }),
      );
      expect(useChatStore.getState().openLocalFiles).toEqual([]);
    },
  );

  it('keeps unresolved relative references non-navigable on desktop', () => {
    const { container } = render(
      <Render {...createRenderProps({ linkHref: './client.ts', linkLabel: 'client.ts' })} />,
    );
    expect(container.querySelector('[href]')).toBeNull();
    fireEvent.click(screen.getByText('client.ts'));
    expect(useChatStore.getState().openLocalFiles).toEqual([]);
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

    expect(tooltipPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mouseEnterDelay: 0.1,
        placement: 'topLeft',
        title: '/Users/me/project/src/Group.tsx (line 265)',
      }),
    );

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
  describe('on mobile / web with a remote topic device', () => {
    const setRemoteTopic = (topicMetadata: Record<string, unknown>) =>
      useChatStore.setState({
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        topicDataMap: {
          'agent_agent-1': {
            items: [
              {
                id: 'topic-1',
                metadata: { workingDirectory: '/Users/me/project', ...topicMetadata },
              },
            ],
            total: 1,
          },
        } as any,
      });

    const setDevices = (devices: Array<{ deviceId: string; online: boolean }>) =>
      useDeviceStore.setState({ deviceListMap: { [DEVICE_LIST_KEY]: devices as any } });

    const renderPdfLink = () =>
      render(
        <Render
          {...createRenderProps({
            linkHref: '/Users/me/project/docs/x.pdf',
            linkLabel: 'x.pdf',
          })}
        />,
      );

    it('opens the portal through the online topic device', () => {
      platform.isDesktop = false;
      setRemoteTopic({ boundDeviceId: 'device-1' });
      setDevices([{ deviceId: 'device-1', online: true }]);

      renderPdfLink();
      fireEvent.click(screen.getByRole('link', { name: 'x.pdf' }));

      expect(useChatStore.getState().openLocalFiles).toEqual([
        {
          allowExternalFilePreview: false,
          deviceId: 'device-1',
          filePath: '/Users/me/project/docs/x.pdf',
          id: createLocalFileTabId({
            deviceId: 'device-1',
            filePath: '/Users/me/project/docs/x.pdf',
            workingDirectory: '/Users/me/project',
          }),
          workingDirectory: '/Users/me/project',
        },
      ]);
      expect(useChatStore.getState().showPortal).toBe(true);
    });

    it('stays a non-clickable chip when the topic has no device', () => {
      platform.isDesktop = false;
      setRemoteTopic({});
      setDevices([{ deviceId: 'device-1', online: true }]);

      const { container } = renderPdfLink();

      expect(screen.queryByRole('link')).toBeNull();
      expect(container.querySelector('[href]')).toBeNull();
      fireEvent.click(screen.getByText('x.pdf'));
      expect(useChatStore.getState().openLocalFiles).toEqual([]);
    });

    it('stays a non-clickable chip while the topic device is offline', () => {
      platform.isDesktop = false;
      setRemoteTopic({ boundDeviceId: 'device-1' });
      setDevices([{ deviceId: 'device-1', online: false }]);

      renderPdfLink();

      expect(screen.queryByRole('link')).toBeNull();
      fireEvent.click(screen.getByText('x.pdf'));
      expect(useChatStore.getState().openLocalFiles).toEqual([]);
    });

    it('keeps desktop on local IPC even when the topic has a device', () => {
      setRemoteTopic({ boundDeviceId: 'device-1' });
      setDevices([{ deviceId: 'device-1', online: true }]);

      renderPdfLink();
      fireEvent.click(screen.getByRole('link', { name: 'x.pdf' }));

      const [opened] = useChatStore.getState().openLocalFiles;
      expect(opened).not.toHaveProperty('deviceId');
      expect(opened.id).toBe(
        createLocalFileTabId({
          filePath: '/Users/me/project/docs/x.pdf',
          workingDirectory: '/Users/me/project',
        }),
      );
    });
  });
});
