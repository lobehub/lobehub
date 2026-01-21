import { MemorySourceType } from '@lobechat/types';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BuildIngestOptions,
  IngestPayload,
  LocomoQASample,
  LocomoSession,
  LocomoTurn,
} from './locomo';
import { buildIngestPayload, convertLocomoFile, loadLocomoFile } from './locomo';

vi.mock('node:fs');

describe('locomo converter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('buildIngestPayload', () => {
    it('should build basic ingest payload with minimal data', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_001',
      };

      const options: BuildIngestOptions = {};
      const result = buildIngestPayload(sample, options);

      expect(result.sampleId).toBe('sample_001');
      expect(result.topicId).toBe('sample_sample_001');
      expect(result.source).toBe(MemorySourceType.BenchmarkLocomo);
      expect(result.force).toBe(true);
      expect(result.layers).toEqual([]);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('session_1');
      expect(result.sessions[0].turns).toHaveLength(1);
      expect(result.sessions[0].turns[0].speaker).toBe('User');
      expect(result.sessions[0].turns[0].text).toBe('Hello');
      expect(result.sessions[0].turns[0].role).toBe('user');
    });

    it('should apply custom options', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_002',
      };

      const options: BuildIngestOptions = {
        layers: ['identity', 'context'],
        source: MemorySourceType.ChatTopic,
        topicIdPrefix: 'custom',
      };

      const result = buildIngestPayload(sample, options);

      expect(result.topicId).toBe('custom_sample_002');
      expect(result.source).toBe(MemorySourceType.ChatTopic);
      expect(result.layers).toEqual(['identity', 'context']);
    });

    it('should parse and format session dateTime', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
          session_1_date_time: '3:45 pm on 15 January, 2024',
        },
        qa: [],
        sample_id: 'sample_003',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].timestamp).toBeDefined();
      expect(result.sessions[0].timestamp).toContain('2024-01-15');
      expect(result.sessions[0].turns[0].createdAt).toBeDefined();
      expect(result.sessions[0].turns[0].createdAt).toContain('2024-01-15');
    });

    it('should handle alternative date format', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
          session_1_date_time: '10:30 am on 5 Jan, 2024',
        },
        qa: [],
        sample_id: 'sample_004',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].timestamp).toBeDefined();
      expect(result.sessions[0].timestamp).toContain('2024-01-05');
    });

    it('should handle invalid date format gracefully', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
          session_1_date_time: 'invalid date',
        },
        qa: [],
        sample_id: 'sample_005',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].timestamp).toBeUndefined();
      expect(console.warn).toHaveBeenCalled();
    });

    it('should warn when session is missing dateTime', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_006',
      };

      buildIngestPayload(sample, {});

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('session session_1 is missing dateTime'),
      );
    });

    it('should resolve speaker roles with speaker_a and speaker_b', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'John',
              text: 'Hello',
            } as LocomoTurn,
            {
              speaker: 'Assistant',
              text: 'Hi there!',
            } as LocomoTurn,
          ],
          speaker_a: 'John',
          speaker_b: 'Assistant',
        },
        qa: [],
        sample_id: 'sample_007',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].role).toBe('user');
      expect(result.sessions[0].turns[0].speaker).toBe('John');
      expect(result.sessions[0].turns[1].role).toBe('assistant');
      expect(result.sessions[0].turns[1].speaker).toBe('Assistant');
    });

    it('should apply custom speaker roles', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'John',
              text: 'Hello',
            } as LocomoTurn,
            {
              speaker: 'Bot',
              text: 'Hi!',
            } as LocomoTurn,
            {
              speaker: 'System',
              text: 'Notification',
            } as LocomoTurn,
          ],
          speaker_a: 'John',
          speaker_b: 'Bot',
        },
        qa: [],
        sample_id: 'sample_008',
      };

      const options: BuildIngestOptions = {
        speakerRoles: {
          defaultRole: 'system',
          speakerA: 'customer',
          speakerB: 'agent',
        },
      };

      const result = buildIngestPayload(sample, options);

      expect(result.sessions[0].turns[0].role).toBe('customer');
      expect(result.sessions[0].turns[1].role).toBe('agent');
      expect(result.sessions[0].turns[2].role).toBe('system');
    });

    it('should handle multiple sessions and sort them correctly', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_3: [{ speaker: 'User', text: 'Third' } as LocomoTurn],
          session_1: [{ speaker: 'User', text: 'First' } as LocomoTurn],
          session_2: [{ speaker: 'User', text: 'Second' } as LocomoTurn],
        },
        qa: [],
        sample_id: 'sample_009',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions).toHaveLength(3);
      expect(result.sessions[0].sessionId).toBe('session_1');
      expect(result.sessions[0].turns[0].text).toBe('First');
      expect(result.sessions[1].sessionId).toBe('session_2');
      expect(result.sessions[1].turns[0].text).toBe('Second');
      expect(result.sessions[2].sessionId).toBe('session_3');
      expect(result.sessions[2].turns[0].text).toBe('Third');
    });

    it('should ignore non-session keys in conversation', () => {
      const sample: LocomoQASample = {
        conversation: {
          not_a_session: 'some value',
          session_1: [{ speaker: 'User', text: 'Hello' } as LocomoTurn],
          session_1_date_time: '3:45 pm on 15 January, 2024',
          speaker_a: 'User',
          speaker_b: 'Bot',
        },
        qa: [],
        sample_id: 'sample_010',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('session_1');
    });

    it('should handle image captions as string', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              blip_caption: 'A beautiful sunset',
              speaker: 'User',
              text: 'Look at this!',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_011',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].imageCaption).toBe('A beautiful sunset');
      expect(result.sessions[0].turns[0].text).toBe('Look at this!');
    });

    it('should handle image captions as array', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              blip_caption: ['Caption 1', 'Caption 2'],
              speaker: 'User',
              text: 'Multiple images',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_012',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].imageCaption).toBe('Caption 1\nCaption 2');
    });

    it('should include image captions in text when option is enabled', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              blip_caption: 'A cat',
              speaker: 'User',
              text: 'Look at this',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_013',
      };

      const options: BuildIngestOptions = {
        includeImageCaptions: true,
      };

      const result = buildIngestPayload(sample, options);

      expect(result.sessions[0].turns[0].text).toBe('Look at this\n[Image: A cat]');
    });

    it('should include multiple image captions in text', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              blip_caption: ['Cat', 'Dog'],
              speaker: 'User',
              text: 'Pets',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_014',
      };

      const options: BuildIngestOptions = {
        includeImageCaptions: true,
      };

      const result = buildIngestPayload(sample, options);

      expect(result.sessions[0].turns[0].text).toBe('Pets\n[Image: Cat]\n[Image: Dog]');
    });

    it('should handle text ending with newline when including captions', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              blip_caption: 'A cat',
              speaker: 'User',
              text: 'Look at this\n',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_015',
      };

      const options: BuildIngestOptions = {
        includeImageCaptions: true,
      };

      const result = buildIngestPayload(sample, options);

      expect(result.sessions[0].turns[0].text).toBe('Look at this\n[Image: A cat]');
    });

    it('should handle image URLs as string', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              img_url: 'https://example.com/image.jpg',
              speaker: 'User',
              text: 'Image',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_016',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].imageUrls).toEqual(['https://example.com/image.jpg']);
    });

    it('should handle image URLs as array', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              img_url: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
              speaker: 'User',
              text: 'Images',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_017',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].imageUrls).toEqual([
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
      ]);
    });

    it('should omit imageUrls when empty', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              speaker: 'User',
              text: 'No images',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_018',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].imageUrls).toBeUndefined();
    });

    it('should handle dia_id field', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              dia_id: 'dialog_123',
              speaker: 'User',
              text: 'Hello',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_019',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].diaId).toBe('dialog_123');
    });

    it('should filter out falsy values in image arrays', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            {
              blip_caption: ['Valid', '', 'Another'],
              img_url: ['url1', '', 'url2'],
              speaker: 'User',
              text: 'Test',
            } as LocomoTurn,
          ],
        },
        qa: [],
        sample_id: 'sample_020',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns[0].imageCaption).toBe('Valid\nAnother');
      expect(result.sessions[0].turns[0].imageUrls).toEqual(['url1', 'url2']);
    });

    it('should filter out null/undefined turns from sessions', () => {
      const sample: LocomoQASample = {
        conversation: {
          session_1: [
            { speaker: 'User', text: 'Hello' } as LocomoTurn,
            null as any,
            { speaker: 'Bot', text: 'Hi' } as LocomoTurn,
            undefined as any,
          ],
        },
        qa: [],
        sample_id: 'sample_021',
      };

      const result = buildIngestPayload(sample, {});

      expect(result.sessions[0].turns).toHaveLength(2);
      expect(result.sessions[0].turns[0].text).toBe('Hello');
      expect(result.sessions[0].turns[1].text).toBe('Hi');
    });
  });

  describe('loadLocomoFile', () => {
    it('should load and parse JSON file successfully', () => {
      const mockData = [
        {
          conversation: {
            session_1: [{ speaker: 'User', text: 'Hello' }],
          },
          qa: [],
          sample_id: 'sample_001',
        },
      ];

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData));

      const result = loadLocomoFile('/path/to/file.json');

      expect(result).toEqual(mockData);
      expect(readFileSync).toHaveBeenCalledWith(expect.any(String), 'utf8');
    });

    it('should throw error when JSON is not an array', () => {
      const mockData = { not: 'an array' };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData));

      expect(() => loadLocomoFile('/path/to/file.json')).toThrowError(
        'Expected LoCoMo JSON to be an array of samples',
      );
    });

    it('should throw error when JSON is invalid', () => {
      vi.mocked(readFileSync).mockReturnValue('invalid json{{{');

      expect(() => loadLocomoFile('/path/to/file.json')).toThrowError();
    });

    it('should resolve absolute path', () => {
      const mockData: LocomoQASample[] = [];
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData));

      loadLocomoFile('./relative/path/file.json');

      expect(readFileSync).toHaveBeenCalledWith(expect.any(String), 'utf8');
      const callPath = vi.mocked(readFileSync).mock.calls[0][0] as string;
      expect(callPath).not.toContain('./');
    });
  });

  describe('convertLocomoFile', () => {
    it('should load file and convert all samples', () => {
      const mockData = [
        {
          conversation: {
            session_1: [{ speaker: 'User', text: 'Hello' }],
          },
          qa: [],
          sample_id: 'sample_001',
        },
        {
          conversation: {
            session_1: [{ speaker: 'User', text: 'World' }],
          },
          qa: [],
          sample_id: 'sample_002',
        },
      ];

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData));

      const options: BuildIngestOptions = {
        layers: ['identity'],
      };

      const result = convertLocomoFile('/path/to/file.json', options);

      expect(result).toHaveLength(2);
      expect(result[0].sampleId).toBe('sample_001');
      expect(result[0].layers).toEqual(['identity']);
      expect(result[1].sampleId).toBe('sample_002');
      expect(result[1].layers).toEqual(['identity']);
    });

    it('should return empty array when file contains no samples', () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]));

      const result = convertLocomoFile('/path/to/file.json', {});

      expect(result).toEqual([]);
    });

    it('should pass options to buildIngestPayload', () => {
      const mockData = [
        {
          conversation: {
            session_1: [{ speaker: 'User', text: 'Hello' }],
          },
          qa: [],
          sample_id: 'sample_001',
        },
      ];

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData));

      const options: BuildIngestOptions = {
        layers: ['context', 'preference'],
        source: MemorySourceType.ChatTopic,
        topicIdPrefix: 'test',
      };

      const result = convertLocomoFile('/path/to/file.json', options);

      expect(result[0].layers).toEqual(['context', 'preference']);
      expect(result[0].source).toBe(MemorySourceType.ChatTopic);
      expect(result[0].topicId).toBe('test_sample_001');
    });
  });
});
