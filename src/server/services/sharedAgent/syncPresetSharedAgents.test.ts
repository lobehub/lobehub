// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedAgentModel } from '@/database/models/sharedAgent';

import { syncPresetSharedAgents } from './syncPresetSharedAgents';

vi.mock('@/database/models/sharedAgent', () => ({
  SharedAgentModel: vi.fn(),
}));

describe('syncPresetSharedAgents', () => {
  const mockCreate = vi.fn();
  const mockListAll = vi.fn();
  const mockUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (SharedAgentModel as any).mockImplementation(() => ({
      create: mockCreate,
      listAll: mockListAll,
      update: mockUpdate,
    }));
  });

  it('should create missing preset shared agents', async () => {
    mockListAll.mockResolvedValue([]);

    await syncPresetSharedAgents({} as any);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash-image',
        provider: 'google',
        title: '文生图AI员工',
      }),
    );
  });

  it('should update stale preset shared agents by title', async () => {
    mockListAll.mockResolvedValue([
      {
        id: 'shared_1',
        model: 'gemini-2.5-flash-image',
        provider: 'google',
        tags: ['旧标签'],
        title: '文生图AI员工',
      },
    ]);

    await syncPresetSharedAgents({} as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      'shared_1',
      expect.objectContaining({
        model: 'gemini-2.5-flash-image',
        provider: 'google',
        title: '文生图AI员工',
      }),
    );
  });

  it('should skip updates when preset shared agents are already synced', async () => {
    mockListAll.mockResolvedValue([
      {
        avatar: '🧑‍🎨',
        backgroundColor: '#c4f042',
        description:
          '把用户的工位/作业区照片与需求转写为可直接用于 Midjourney / SDXL / DALL·E / Flux 的高质量提示词与参数建议，保持真实仓库/作业场景一致性。',
        id: 'shared_1',
        model: 'gemini-2.5-flash-image',
        provider: 'google',
        tags: ['文生图', '提示词', '电商', '仓库', '摄影风格'],
        title: '文生图AI员工',
      },
    ]);

    await syncPresetSharedAgents({} as any);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
