// @vitest-environment node
import type { MusicGenerationAsset } from '@lobechat/types';
import { AsyncTaskStatus, FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  asyncTasks,
  files,
  generationBatches,
  generations,
  generationTopics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { GenerationModel as GenerationModelType } from '../generation';

const serverDB: LobeChatDatabase = await getTestDB();

const mockGetFileAccessUrl = vi.fn();
const mockGetFullFileUrl = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFileAccessUrl: mockGetFileAccessUrl, getFullFileUrl: mockGetFullFileUrl };
  }),
}));

const userId = 'music-generation-test-user';
let generationModel: GenerationModelType;

// The server-db suite runs with `isolate: false`: generation.test.ts mocks `../file`
// and the file service, and whichever file loads `../generation` first would bind
// it to its own mocks. Load a fresh copy here (real FileModel, this file's
// FileService mock) and leave no mocked module behind for the other files.
beforeAll(async () => {
  vi.resetModules();
  const { GenerationModel } = await import('../generation');
  generationModel = new GenerationModel(serverDB, userId);
});

afterAll(() => {
  vi.doUnmock('@/server/services/file');
  vi.resetModules();
});

const musicAsset: MusicGenerationAsset = {
  coverUrl: 'generations/music/song_cover.jpg',
  duration: 121.5,
  mimeType: 'audio/mpeg',
  originalUrl: 'https://cdn.example.com/song.mp3',
  providerTrackId: 'clip-1',
  title: 'Rain',
  type: 'audio',
  url: 'generations/music/song_audio.mp3',
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetFullFileUrl.mockImplementation(async (key: string) => `https://s3.example.com/${key}`);
  mockGetFileAccessUrl.mockImplementation(async ({ fileId }: { fileId?: string }) =>
    fileId ? `https://example.com/f/${fileId}` : undefined,
  );

  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB
    .insert(generationTopics)
    .values({ id: 'music-topic', title: 'Music', type: 'music', userId });
  await serverDB.insert(generationBatches).values({
    config: { prompt: 'lo-fi rain' },
    generationTopicId: 'music-topic',
    id: 'music-batch',
    model: 'song-model',
    prompt: 'lo-fi rain',
    provider: 'fal',
    userId,
  });
  await serverDB.insert(asyncTasks).values({
    id: '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f',
    status: AsyncTaskStatus.Processing,
    type: 'music_generation',
    userId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('GenerationModel with music assets', () => {
  it('stores a song asset and its music_generation file in one transaction', async () => {
    const [generation] = await serverDB
      .insert(generations)
      .values({
        asyncTaskId: '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f',
        generationBatchId: 'music-batch',
        userId,
      })
      .returning();

    const result = await generationModel.createAssetAndFile(
      generation.id,
      musicAsset,
      {
        fileHash: 'music-hash-1',
        fileType: 'audio/mpeg',
        name: 'Rain.mp3',
        size: 2048,
        url: 'generations/music/song_audio.mp3',
      },
      FileSource.MusicGeneration,
    );

    expect(result?.file.id).toBeDefined();

    const stored = await serverDB.query.generations.findFirst({
      where: eq(generations.id, generation.id),
    });
    expect(stored?.asset).toEqual(musicAsset);
    expect(stored?.fileId).toBe(result!.file.id);

    const file = await serverDB.query.files.findFirst({ where: eq(files.id, result!.file.id) });
    expect(file).toMatchObject({
      fileType: 'audio/mpeg',
      name: 'Rain.mp3',
      source: FileSource.MusicGeneration,
    });
  });

  it('resolves the audio and cover keys of a song to accessible URLs', async () => {
    const result = await generationModel.transformGeneration({
      accessedAt: new Date(),
      asset: { ...musicAsset } as any,
      asyncTask: null as any,
      asyncTaskId: null,
      createdAt: new Date(),
      fileId: 'file-1',
      generationBatchId: 'music-batch',
      id: 'gen-1',
      seed: null,
      updatedAt: new Date(),
      userId,
      workspaceId: null,
    } as any);

    expect(result.asset).toMatchObject({
      coverUrl: 'https://s3.example.com/generations/music/song_cover.jpg',
      duration: 121.5,
      title: 'Rain',
      type: 'audio',
      url: 'https://example.com/f/file-1',
    });
    expect(mockGetFileAccessUrl).toHaveBeenCalledWith({
      fileId: 'file-1',
      url: 'generations/music/song_audio.mp3',
    });
  });

  it('resolves a song without cover art', async () => {
    const { coverUrl: _, ...withoutCover } = musicAsset;
    const result = await generationModel.transformGeneration({
      asset: { ...withoutCover } as any,
      asyncTaskId: null,
      createdAt: new Date(),
      fileId: 'file-2',
      id: 'gen-2',
      seed: null,
    } as any);

    expect(result.asset).toMatchObject({ url: 'https://example.com/f/file-2' });
    expect((result.asset as any).coverUrl).toBeUndefined();
    expect(mockGetFullFileUrl).not.toHaveBeenCalled();
  });
});
