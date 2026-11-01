import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { type ProjectDetail, useProjectStore } from '@/store/project';
import type { ChatTopic } from '@/types/topic';

import {
  ProjectSectionDynamicMeta,
  useProjectConversationTitle,
  useProjectTabAvatar,
} from './ProjectDynamicMeta';

vi.mock('./workspaceScope', () => ({
  matchesRouteWorkspace: () => true,
  useRouteWorkspaceId: () => null,
}));

const seedStores = () => {
  useProjectStore.setState({
    projectDetailMap: {
      prj_1: {
        project: { id: 'prj_1', name: 'Alpha', workspaceId: null },
      } as ProjectDetail,
    },
  });
  useChatStore.setState({
    topicDetailMap: { tpc_1: { id: 'tpc_1', title: 'Fix login' } as ChatTopic },
  });
};

describe('useProjectConversationTitle', () => {
  afterEach(() => {
    useChatStore.setState({ topicDataMap: {}, topicDetailMap: {} });
    useProjectStore.setState({ projectDetailMap: {} });
  });

  it('resolves the topic title and project name for a conversation tab', () => {
    seedStores();

    const { result } = renderHook(() =>
      useProjectConversationTitle({ projectId: 'prj_1', topicId: 'tpc_1' }),
    );

    expect(result.current).toBe('Fix login · Alpha');
  });

  it('falls back to the project name when the topic is not loaded yet', () => {
    seedStores();

    const { result } = renderHook(() => useProjectConversationTitle({ projectId: 'prj_1' }));

    expect(result.current).toBe('Alpha');
  });

  it('publishes no title before the project detail lands', () => {
    const { result } = renderHook(() =>
      useProjectConversationTitle({ projectId: 'prj_1', topicId: 'tpc_1' }),
    );

    expect(result.current).toBeUndefined();
  });
});

describe('useProjectTabAvatar', () => {
  afterEach(() => {
    useProjectStore.setState({ projectDetailMap: {} });
  });

  it('seeds the generated avatar from the project name when there is no logo', () => {
    seedStores();

    const { result } = renderHook(() => useProjectTabAvatar({ projectId: 'prj_1' }));

    // `null`, not `undefined`: the project has loaded, so a cached logo is stale.
    expect(result.current).toEqual({ avatar: null, avatarSeed: 'Alpha' });
  });

  it("passes the project's own logo through", () => {
    useProjectStore.setState({
      projectDetailMap: {
        prj_1: {
          project: { avatar: '🚀', id: 'prj_1', name: 'Alpha', workspaceId: null },
        } as ProjectDetail,
      },
    });

    const { result } = renderHook(() => useProjectTabAvatar({ projectId: 'prj_1' }));

    expect(result.current).toEqual({ avatar: '🚀', avatarSeed: 'Alpha' });
  });

  it('publishes no avatar before the project detail lands', () => {
    const { result } = renderHook(() => useProjectTabAvatar({ projectId: 'prj_1' }));

    expect(result.current).toEqual({ avatar: undefined, avatarSeed: undefined });
  });
});

describe('ProjectSectionDynamicMeta', () => {
  afterEach(() => {
    useProjectStore.setState({ projectDetailMap: {} });
  });

  it('publishes the project avatar but no title, so the static section label stays', () => {
    seedStores();
    const onResolve = vi.fn();

    renderHook(() => ProjectSectionDynamicMeta({ onResolve, params: { projectId: 'prj_1' } }));

    expect(onResolve).toHaveBeenLastCalledWith({
      avatar: null,
      avatarSeed: 'Alpha',
      backgroundColor: undefined,
      title: undefined,
    });
  });
});
