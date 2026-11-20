/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { useDeviceStore } from '@/store/device';
import { DEVICE_LIST_KEY } from '@/store/device/projection';
import { useElectronStore } from '@/store/electron';
import {
  initialLocalFilePreviewState,
  localFilePreviewKey,
  useLocalFilePreviewStore,
} from '@/store/localFilePreview';

import { LocalFileTag } from './LocalFileTag';

const platform = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return platform.isDesktop;
  },
}));

vi.mock('@/components/FileIcon', () => ({
  default: () => <span data-testid="file-icon" />,
}));

const { getLocalFilePreview } = vi.hoisted(() => ({
  getLocalFilePreview: vi.fn(),
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: { getLocalFilePreview },
}));

const setTopic = (topicMeta: Record<string, unknown>) =>
  useChatStore.setState({
    activeAgentId: 'agent-1',
    activeTopicId: 'topic-1',
    topicDataMap: {
      'agent_agent-1': {
        items: [
          { id: 'topic-1', metadata: { workingDirectory: '/Users/me/project', ...topicMeta } },
        ],
        total: 1,
      },
    } as any,
  });

const setDevices = (devices: Array<{ deviceId: string; online: boolean }>) =>
  useDeviceStore.setState({ deviceListMap: { [DEVICE_LIST_KEY]: devices as any } });

const setThisMachine = (deviceId: string) =>
  useElectronStore.setState({
    gatewayDeviceInfo: { deviceId, hostname: 'this-mac', platform: 'darwin' },
  });

const imageFile = { name: 'shot.png', path: '/Users/me/project/shot.png' };

describe('LocalFileTag remote device preview', () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
    getLocalFilePreview.mockResolvedValue({ blob: new Blob(['x']), type: 'image' });
  });

  afterEach(() => {
    platform.isDesktop = false;
    getLocalFilePreview.mockReset();
    useChatStore.setState(useChatStore.getInitialState());
    useDeviceStore.setState(useDeviceStore.getInitialState());
    useLocalFilePreviewStore.setState(initialLocalFilePreviewState);
    useElectronStore.setState({ gatewayDeviceInfo: undefined });
  });

  it('reads the thumbnail once through the local-file preview replica, however many tags show it', async () => {
    setTopic({ boundDeviceId: 'device-1' });
    setDevices([{ deviceId: 'device-1', online: true }]);

    render(
      <>
        <LocalFileTag file={imageFile} />
        <LocalFileTag file={imageFile} />
      </>,
    );

    const key = localFilePreviewKey({
      accept: 'image',
      deviceId: 'device-1',
      filePath: '/Users/me/project/shot.png',
      workingDirectory: '/Users/me/project',
    });
    await waitFor(() =>
      expect(useLocalFilePreviewStore.getState().previewMap[key]).toMatchObject({ type: 'image' }),
    );
    expect(getLocalFilePreview).toHaveBeenCalledTimes(1);
  });

  it('reads the image thumbnail through the online topic device off desktop', async () => {
    setTopic({ boundDeviceId: 'device-1' });
    setDevices([{ deviceId: 'device-1', online: true }]);

    render(<LocalFileTag file={imageFile} />);

    await waitFor(() => expect(getLocalFilePreview).toHaveBeenCalledTimes(1));
    expect(getLocalFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        accept: 'image',
        deviceId: 'device-1',
        path: '/Users/me/project/shot.png',
        workingDirectory: '/Users/me/project',
      }),
    );
  });

  it('never falls back to the local IPC read off desktop when no device can serve it', async () => {
    setTopic({ boundDeviceId: 'device-1' });
    setDevices([{ deviceId: 'device-1', online: false }]);

    const { rerender } = render(<LocalFileTag file={imageFile} />);

    setTopic({});
    rerender(<LocalFileTag file={imageFile} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('keeps desktop on local IPC (no deviceId) when the topic ran on this machine', async () => {
    platform.isDesktop = true;
    setThisMachine('device-1');
    setTopic({ boundDeviceId: 'device-1' });
    setDevices([{ deviceId: 'device-1', online: true }]);

    render(<LocalFileTag file={imageFile} />);

    await waitFor(() => expect(getLocalFilePreview).toHaveBeenCalledTimes(1));
    expect(getLocalFilePreview.mock.calls[0][0].deviceId).toBeUndefined();
  });

  it('reads through the topic device on desktop when the topic ran on another machine', async () => {
    platform.isDesktop = true;
    setThisMachine('device-local');
    setTopic({ boundDeviceId: 'device-remote' });
    setDevices([{ deviceId: 'device-remote', online: true }]);

    render(<LocalFileTag file={imageFile} />);

    await waitFor(() => expect(getLocalFilePreview).toHaveBeenCalledTimes(1));
    expect(getLocalFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-remote', path: '/Users/me/project/shot.png' }),
    );
  });

  it('reads nothing on desktop while the other machine is offline', async () => {
    platform.isDesktop = true;
    setThisMachine('device-local');
    setTopic({ boundDeviceId: 'device-remote' });
    setDevices([{ deviceId: 'device-remote', online: false }]);

    render(<LocalFileTag file={imageFile} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getLocalFilePreview).not.toHaveBeenCalled();
  });
});
