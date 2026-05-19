import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioGenerationModel } from '../audioGeneration';
import type { LobeChatDatabase } from '../type';
import type { AudioGenerationSelectItem } from '../schemas/audio';

describe('AudioGenerationModel', () => {
  let mockDb: LobeChatDatabase;
  let model: AudioGenerationModel;
  const userId = 'test-user-123';

  beforeEach(() => {
    mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 'audio-123',
              userId,
              prompt: 'Test prompt',
              musicStyle: 'pop',
              duration: 30,
              modelVersion: 'v5.5',
              taskId: 'task-123',
              status: 'pending',
              audioUrl: null,
              audioMetadata: null,
              error: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      }),
      query: {
        audioGenerations: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      update: vi.fn(),
      delete: vi.fn(),
      select: vi.fn(),
    } as any;

    model = new AudioGenerationModel(mockDb, userId);
  });

  it('should create a new audio generation', async () => {
    const result = await model.create({
      prompt: 'Test prompt',
      musicStyle: 'pop',
      duration: 30,
      modelVersion: 'v5.5',
      taskId: 'task-123',
      status: 'pending',
    });

    expect(result).toHaveProperty('id', 'audio-123');
    expect(result).toHaveProperty('taskId', 'task-123');
    expect(result.status).toBe('pending');
  });

  it('should find audio generation by ID', async () => {
    const mockAudio: AudioGenerationSelectItem = {
      id: 'audio-123',
      userId,
      prompt: 'Test prompt',
      musicStyle: 'pop',
      duration: 30,
      modelVersion: 'v5.5',
      taskId: 'task-123',
      status: 'pending',
      audioUrl: null,
      audioMetadata: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (mockDb.query.audioGenerations.findFirst as any).mockResolvedValue(mockAudio);

    const result = await model.findById('audio-123');
    expect(result?.id).toBe('audio-123');
  });

  it('should find audio generation by task ID', async () => {
    const mockAudio: AudioGenerationSelectItem = {
      id: 'audio-123',
      userId,
      prompt: 'Test prompt',
      musicStyle: 'pop',
      duration: 30,
      modelVersion: 'v5.5',
      taskId: 'task-123',
      status: 'pending',
      audioUrl: null,
      audioMetadata: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (mockDb.query.audioGenerations.findFirst as any).mockResolvedValue(mockAudio);

    const result = await model.findByTaskId('task-123');
    expect(result?.taskId).toBe('task-123');
  });

  it('should update audio generation record', async () => {
    await model.update('audio-123', {
      status: 'completed',
      audioUrl: 'https://example.com/audio.mp3',
    });

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should delete audio generation record', async () => {
    await model.delete('audio-123');
    expect(mockDb.delete).toHaveBeenCalled();
  });
});
