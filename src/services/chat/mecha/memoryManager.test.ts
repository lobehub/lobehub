import type { UserMemoryIdentityItem } from '@lobechat/context-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as chatStore from '@/store/chat';
import * as userMemoryStore from '@/store/userMemory';
import { agentMemorySelectors, identitySelectors } from '@/store/userMemory/selectors';

import {
  combineUserMemoryData,
  resolveGlobalIdentities,
  resolveTopicMemories,
} from './memoryManager';

describe('memoryManager', () => {
  const mockUserMemoryStoreState = {
    globalIdentities: [],
    topicMemoriesMap: {},
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveGlobalIdentities', () => {
    it('should return formatted global identities from store', () => {
      const mockIdentities = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Software engineer with 5 years of experience',
          id: 'identity-1',
          role: 'professional',
          type: 'occupation',
        },
        {
          capturedAt: '2024-01-16T12:00:00Z',
          description: 'Lives in San Francisco',
          id: 'identity-2',
          role: 'personal',
          type: 'location',
        },
      ];

      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue({
        ...mockUserMemoryStoreState,
        globalIdentities: mockIdentities,
      } as any);

      const result = resolveGlobalIdentities();

      expect(result).toEqual([
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Software engineer with 5 years of experience',
          id: 'identity-1',
          role: 'professional',
          type: 'occupation',
        },
        {
          capturedAt: '2024-01-16T12:00:00Z',
          description: 'Lives in San Francisco',
          id: 'identity-2',
          role: 'personal',
          type: 'location',
        },
      ]);
    });

    it('should return empty array when no global identities exist', () => {
      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue({
        ...mockUserMemoryStoreState,
        globalIdentities: [],
      } as any);

      const result = resolveGlobalIdentities();

      expect(result).toEqual([]);
    });

    it('should map all identity fields correctly', () => {
      const mockIdentity = {
        capturedAt: '2024-01-20T08:30:00Z',
        description: 'Prefers dark mode',
        extraField: 'should not be included',
        id: 'identity-3',
        role: 'user',
        type: 'preference',
      };

      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue({
        ...mockUserMemoryStoreState,
        globalIdentities: [mockIdentity],
      } as any);

      const result = resolveGlobalIdentities();

      expect(result[0]).toHaveProperty('capturedAt', '2024-01-20T08:30:00Z');
      expect(result[0]).toHaveProperty('description', 'Prefers dark mode');
      expect(result[0]).toHaveProperty('id', 'identity-3');
      expect(result[0]).toHaveProperty('role', 'user');
      expect(result[0]).toHaveProperty('type', 'preference');
      expect(result[0]).not.toHaveProperty('extraField');
    });
  });

  describe('resolveTopicMemories', () => {
    const mockChatStoreState = {
      activeTopicId: 'topic-123',
    };

    it('should return topic memories from cache when topicId is provided in context', () => {
      const mockMemories = {
        contexts: ['Context about project discussion'],
        experiences: ['User prefers TypeScript over JavaScript'],
        preferences: ['Likes detailed code examples'],
      };

      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => mockMemories as any);

      const result = resolveTopicMemories({ topicId: 'topic-456' });

      expect(result).toEqual(mockMemories);
      expect(agentMemorySelectors.topicMemories).toHaveBeenCalledWith('topic-456');
    });

    it('should use active topic ID when no context is provided', () => {
      const mockMemories = {
        contexts: ['Active topic context'],
        experiences: ['Active topic experience'],
        preferences: ['Active topic preference'],
      };

      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue(mockChatStoreState as any);
      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => mockMemories as any);

      const result = resolveTopicMemories();

      expect(result).toEqual(mockMemories);
      expect(agentMemorySelectors.topicMemories).toHaveBeenCalledWith('topic-123');
    });

    it('should use active topic ID when context is empty object', () => {
      const mockMemories = {
        contexts: [],
        experiences: [],
        preferences: [],
      };

      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue(mockChatStoreState as any);
      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => mockMemories as any);

      const result = resolveTopicMemories({});

      expect(result).toEqual(mockMemories);
      expect(agentMemorySelectors.topicMemories).toHaveBeenCalledWith('topic-123');
    });

    it('should return empty memories when no topic ID is available', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue({ activeTopicId: undefined } as any);

      const result = resolveTopicMemories();

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should return empty memories when topicId is undefined in context', () => {
      const result = resolveTopicMemories({ topicId: undefined });

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should return empty memories when cached memories are undefined', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue(mockChatStoreState as any);
      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => undefined);

      const result = resolveTopicMemories();

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should return empty memories when cached memories are null', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue(mockChatStoreState as any);
      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => null as any);

      const result = resolveTopicMemories();

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should prioritize context topicId over active topic ID', () => {
      const mockMemories = {
        contexts: ['Context-specific memories'],
        experiences: [],
        preferences: [],
      };

      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue(mockChatStoreState as any);
      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => mockMemories as any);

      const result = resolveTopicMemories({ topicId: 'custom-topic-789' });

      expect(result).toEqual(mockMemories);
      expect(agentMemorySelectors.topicMemories).toHaveBeenCalledWith('custom-topic-789');
      expect(chatStore.getChatStoreState).not.toHaveBeenCalled();
    });

    it('should handle memories with all memory types populated', () => {
      const mockMemories = {
        contexts: ['Project architecture discussion', 'API design preferences'],
        experiences: [
          'User struggled with async/await patterns',
          'Successfully debugged memory leak',
        ],
        preferences: ['Prefers functional programming', 'Likes concise code comments'],
      };

      vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
        mockUserMemoryStoreState as any,
      );
      vi.spyOn(agentMemorySelectors, 'topicMemories').mockReturnValue(() => mockMemories as any);

      const result = resolveTopicMemories({ topicId: 'topic-full' });

      expect(result.contexts).toHaveLength(2);
      expect(result.experiences).toHaveLength(2);
      expect(result.preferences).toHaveLength(2);
      expect(result).toEqual(mockMemories);
    });
  });

  describe('combineUserMemoryData', () => {
    it('should combine topic memories and identities correctly', () => {
      const topicMemories = {
        contexts: ['Project discussion'],
        experiences: ['User experience with TypeScript'],
        preferences: ['Prefers detailed examples'],
      } as any;

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Software engineer',
          id: 'identity-1',
          role: 'professional',
          type: 'occupation',
        },
      ];

      const result = combineUserMemoryData(topicMemories, identities);

      expect(result).toEqual({
        contexts: ['Project discussion'],
        experiences: ['User experience with TypeScript'],
        identities: [
          {
            capturedAt: '2024-01-15T10:00:00Z',
            description: 'Software engineer',
            id: 'identity-1',
            role: 'professional',
            type: 'occupation',
          },
        ],
        preferences: ['Prefers detailed examples'],
      });
    });

    it('should handle empty topic memories', () => {
      const topicMemories = {
        contexts: [],
        experiences: [],
        preferences: [],
      } as any;

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Software engineer',
          id: 'identity-1',
          role: 'professional',
          type: 'occupation',
        },
      ];

      const result = combineUserMemoryData(topicMemories, identities);

      expect(result.contexts).toEqual([]);
      expect(result.experiences).toEqual([]);
      expect(result.preferences).toEqual([]);
      expect(result.identities).toEqual(identities);
    });

    it('should handle empty identities', () => {
      const topicMemories = {
        contexts: ['Context 1'],
        experiences: ['Experience 1'],
        preferences: ['Preference 1'],
      } as any;

      const result = combineUserMemoryData(topicMemories, []);

      expect(result.identities).toEqual([]);
      expect(result.contexts).toEqual(['Context 1']);
      expect(result.experiences).toEqual(['Experience 1']);
      expect(result.preferences).toEqual(['Preference 1']);
    });

    it('should handle both empty memories and identities', () => {
      const topicMemories = {
        contexts: [],
        experiences: [],
        preferences: [],
      } as any;

      const result = combineUserMemoryData(topicMemories, []);

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        identities: [],
        preferences: [],
      });
    });

    it('should preserve all fields from topic memories', () => {
      const topicMemories = {
        contexts: ['Context A', 'Context B', 'Context C'],
        experiences: ['Experience X', 'Experience Y'],
        preferences: ['Preference 1'],
      } as any;

      const identities: UserMemoryIdentityItem[] = [];

      const result = combineUserMemoryData(topicMemories, identities);

      expect(result.contexts).toHaveLength(3);
      expect(result.experiences).toHaveLength(2);
      expect(result.preferences).toHaveLength(1);
      expect(result.contexts).toEqual(['Context A', 'Context B', 'Context C']);
    });

    it('should preserve all fields from identities', () => {
      const topicMemories = {
        contexts: [],
        experiences: [],
        preferences: [],
      } as any;

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Engineer',
          id: 'id-1',
          role: 'professional',
          type: 'occupation',
        },
        {
          capturedAt: '2024-01-16T11:00:00Z',
          description: 'From NYC',
          id: 'id-2',
          role: 'personal',
          type: 'location',
        },
      ];

      const result = combineUserMemoryData(topicMemories, identities);

      expect(result.identities).toHaveLength(2);
      expect(result.identities![0]).toEqual(identities[0]);
      expect(result.identities![1]).toEqual(identities[1]);
    });
  });
});
