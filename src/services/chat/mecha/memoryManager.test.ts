import type { UserMemoryIdentityItem } from '@lobechat/context-engine';
import type {
  RetrieveMemoryResult,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryPreference,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as chatStore from '@/store/chat';
import * as userMemoryStore from '@/store/userMemory';
import * as userMemorySelectors from '@/store/userMemory/selectors';

import {
  combineUserMemoryData,
  resolveGlobalIdentities,
  resolveTopicMemories,
} from './memoryManager';

// Test helper to create memory objects with required fields
const createContext = (
  id: string,
  description: string,
  title?: string,
): Omit<UserMemoryContext, 'userId' | 'titleVector' | 'descriptionVector'> => ({
  accessedAt: new Date('2024-01-15'),
  associatedObjects: null,
  associatedSubjects: null,
  createdAt: new Date('2024-01-15'),
  currentStatus: null,
  description,
  id,
  metadata: null,
  scoreImpact: null,
  scoreUrgency: null,
  tags: null,
  title: title || null,
  type: null,
  updatedAt: new Date('2024-01-15'),
  userMemoryIds: null,
});

const createExperience = (
  id: string,
  keyLearning: string,
): Omit<
  UserMemoryExperience,
  'userId' | 'actionVector' | 'situationVector' | 'keyLearningVector'
> => ({
  accessedAt: new Date('2024-01-15'),
  action: null,
  createdAt: new Date('2024-01-15'),
  id,
  keyLearning,
  metadata: null,
  possibleOutcome: null,
  reasoning: null,
  scoreConfidence: null,
  situation: null,
  tags: null,
  type: null,
  updatedAt: new Date('2024-01-15'),
  userMemoryId: null,
});

const createPreference = (
  id: string,
  conclusionDirectives: string,
): Omit<UserMemoryPreference, 'userId' | 'conclusionDirectivesVector'> => ({
  accessedAt: new Date('2024-01-15'),
  conclusionDirectives,
  createdAt: new Date('2024-01-15'),
  id,
  metadata: null,
  scorePriority: null,
  suggestions: null,
  tags: null,
  type: null,
  updatedAt: new Date('2024-01-15'),
  userMemoryId: null,
});

describe('memoryManager', () => {
  const mockChatStoreState = { activeTopicId: 'topic-123' };
  const mockUserMemoryStoreState = { someState: true };

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue(mockChatStoreState as any);
    vi.spyOn(userMemoryStore, 'getUserMemoryStoreState').mockReturnValue(
      mockUserMemoryStoreState as any,
    );
  });

  describe('resolveGlobalIdentities', () => {
    it('should return mapped global identities from user memory store', () => {
      const mockGlobalIdentities = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Software engineer specializing in frontend',
          id: 'identity-1',
          metadata: { source: 'conversation' },
          role: 'professional',
          type: 'role',
        },
        {
          capturedAt: '2024-01-16T14:30:00Z',
          description: 'Prefers React for UI development',
          id: 'identity-2',
          metadata: { source: 'preference' },
          role: 'preference',
          type: 'preference',
        },
      ];

      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(
        () => mockGlobalIdentities as any,
      );

      const result = resolveGlobalIdentities();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        capturedAt: '2024-01-15T10:00:00Z',
        description: 'Software engineer specializing in frontend',
        id: 'identity-1',
        role: 'professional',
        type: 'role',
      });
      expect(result[1]).toEqual({
        capturedAt: '2024-01-16T14:30:00Z',
        description: 'Prefers React for UI development',
        id: 'identity-2',
        role: 'preference',
        type: 'preference',
      });
    });

    it('should filter out metadata property from identities', () => {
      const mockGlobalIdentities = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Test identity',
          id: 'identity-1',
          metadata: { source: 'test', extra: 'data' },
          role: 'test-role',
          type: 'test-type',
        },
      ];

      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(
        () => mockGlobalIdentities as any,
      );

      const result = resolveGlobalIdentities();

      expect(result[0]).not.toHaveProperty('metadata');
      expect(result[0]).toEqual({
        capturedAt: '2024-01-15T10:00:00Z',
        description: 'Test identity',
        id: 'identity-1',
        role: 'test-role',
        type: 'test-type',
      });
    });

    it('should return empty array when no global identities exist', () => {
      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(
        () => [],
      );

      const result = resolveGlobalIdentities();

      expect(result).toEqual([]);
    });

    it('should call getUserMemoryStoreState to get store state', () => {
      const getUserMemoryStoreStateSpy = vi.spyOn(
        userMemoryStore,
        'getUserMemoryStoreState',
      ) as any;
      const globalIdentitiesSpy = vi
        .spyOn(userMemorySelectors.identitySelectors, 'globalIdentities')
        .mockImplementation(() => []);

      resolveGlobalIdentities();

      expect(getUserMemoryStoreStateSpy).toHaveBeenCalledTimes(1);
      expect(globalIdentitiesSpy).toHaveBeenCalledWith(mockUserMemoryStoreState);
    });

    it('should handle identities with all required fields', () => {
      const mockIdentity: UserMemoryIdentityItem = {
        capturedAt: '2024-01-15T10:00:00Z',
        description: 'Complete identity',
        id: 'identity-complete',
        role: 'complete-role',
        type: 'complete-type',
      };

      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(() => [
        { ...mockIdentity, metadata: { extra: 'field' } } as any,
      ]);

      const result = resolveGlobalIdentities();

      expect(result).toEqual([mockIdentity]);
    });
  });

  describe('resolveTopicMemories', () => {
    const mockTopicMemories: RetrieveMemoryResult = {
      contexts: [
        {
          accessedAt: new Date('2024-01-15'),
          associatedObjects: null,
          associatedSubjects: null,
          createdAt: new Date('2024-01-15'),
          currentStatus: null,
          description: 'User is working on a React project',
          id: 'ctx-1',
          metadata: null,
          scoreImpact: null,
          scoreUrgency: null,
          tags: null,
          title: 'React Project',
          type: null,
          updatedAt: new Date('2024-01-15'),
          userMemoryIds: null,
        },
        {
          accessedAt: new Date('2024-01-16'),
          associatedObjects: null,
          associatedSubjects: null,
          createdAt: new Date('2024-01-16'),
          currentStatus: null,
          description: 'Project uses TypeScript',
          id: 'ctx-2',
          metadata: null,
          scoreImpact: null,
          scoreUrgency: null,
          tags: null,
          title: 'TypeScript',
          type: null,
          updatedAt: new Date('2024-01-16'),
          userMemoryIds: null,
        },
      ],
      experiences: [
        {
          accessedAt: new Date('2024-01-15'),
          action: 'Implemented Zustand store',
          createdAt: new Date('2024-01-15'),
          id: 'exp-1',
          keyLearning: 'User struggled with state management before',
          metadata: null,
          possibleOutcome: null,
          reasoning: null,
          scoreConfidence: null,
          situation: 'State management',
          tags: null,
          type: null,
          updatedAt: new Date('2024-01-15'),
          userMemoryId: null,
        },
      ],
      preferences: [
        {
          accessedAt: new Date('2024-01-15'),
          conclusionDirectives: 'User prefers functional components',
          createdAt: new Date('2024-01-15'),
          id: 'pref-1',
          metadata: null,
          scorePriority: null,
          suggestions: null,
          tags: null,
          type: null,
          updatedAt: new Date('2024-01-15'),
          userMemoryId: null,
        },
      ],
    };

    it('should return topic memories from cache for active topic', () => {
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => mockTopicMemories,
      );

      const result = resolveTopicMemories();

      expect(result).toEqual(mockTopicMemories);
      expect(userMemorySelectors.agentMemorySelectors.topicMemories).toHaveBeenCalledWith(
        'topic-123',
      );
    });

    it('should return topic memories for specific topicId from context', () => {
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => mockTopicMemories,
      );

      const result = resolveTopicMemories({ topicId: 'custom-topic-456' });

      expect(result).toEqual(mockTopicMemories);
      expect(userMemorySelectors.agentMemorySelectors.topicMemories).toHaveBeenCalledWith(
        'custom-topic-456',
      );
    });

    it('should return empty memories when topicId is undefined and no active topic', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue({
        activeTopicId: undefined,
      } as any);

      const result = resolveTopicMemories();

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should return empty memories when topicId is null', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue({
        activeTopicId: null,
      } as any);

      const result = resolveTopicMemories({ topicId: null as any });

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should return empty memories when topic has no cached memories', () => {
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => undefined,
      );

      const result = resolveTopicMemories({ topicId: 'topic-no-cache' });

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should return empty memories when cachedMemories is null', () => {
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => null as any,
      );

      const result = resolveTopicMemories({ topicId: 'topic-null-cache' });

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        preferences: [],
      });
    });

    it('should prioritize context topicId over active topic', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue({
        activeTopicId: 'active-topic-789',
      } as any);
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => mockTopicMemories,
      );

      const result = resolveTopicMemories({ topicId: 'context-topic-999' });

      expect(result).toEqual(mockTopicMemories);
      expect(userMemorySelectors.agentMemorySelectors.topicMemories).toHaveBeenCalledWith(
        'context-topic-999',
      );
    });

    it('should call getUserMemoryStoreState to get store state', () => {
      const getUserMemoryStoreStateSpy = vi.spyOn(
        userMemoryStore,
        'getUserMemoryStoreState',
      ) as any;
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => mockTopicMemories,
      );

      resolveTopicMemories({ topicId: 'topic-123' });

      expect(getUserMemoryStoreStateSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle memories with only contexts', () => {
      const memoriesWithOnlyContexts: RetrieveMemoryResult = {
        contexts: [createContext('ctx-1', 'Context 1')],
        experiences: [],
        preferences: [],
      };

      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => memoriesWithOnlyContexts,
      );

      const result = resolveTopicMemories({ topicId: 'topic-123' });

      expect(result).toEqual(memoriesWithOnlyContexts);
      expect(result.contexts).toHaveLength(1);
      expect(result.experiences).toHaveLength(0);
      expect(result.preferences).toHaveLength(0);
    });

    it('should handle memories with all types populated', () => {
      const fullMemories: RetrieveMemoryResult = {
        contexts: [createContext('ctx-1', 'Context 1'), createContext('ctx-2', 'Context 2')],
        experiences: [
          createExperience('exp-1', 'Experience 1'),
          createExperience('exp-2', 'Experience 2'),
        ],
        preferences: [
          createPreference('pref-1', 'Preference 1'),
          createPreference('pref-2', 'Preference 2'),
        ],
      };

      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => fullMemories,
      );

      const result = resolveTopicMemories({ topicId: 'topic-123' });

      expect(result).toEqual(fullMemories);
      expect(result.contexts).toHaveLength(2);
      expect(result.experiences).toHaveLength(2);
      expect(result.preferences).toHaveLength(2);
    });

    it('should not trigger network requests (cache-only behavior)', () => {
      // This test documents that the function only reads from cache
      const topicMemoriesSpy = vi
        .spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories')
        .mockReturnValue(() => mockTopicMemories);

      resolveTopicMemories({ topicId: 'topic-123' });

      // Should only call selector once, no additional fetching
      expect(topicMemoriesSpy).toHaveBeenCalledTimes(1);
      expect(topicMemoriesSpy).toHaveBeenCalledWith('topic-123');
    });
  });

  describe('combineUserMemoryData', () => {
    it('should combine topic memories and identities correctly', () => {
      const topicMemories: RetrieveMemoryResult = {
        contexts: [createContext('ctx-1', 'Project context')],
        experiences: [createExperience('exp-1', 'Past experience')],
        preferences: [createPreference('pref-1', 'User preference')],
      };

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'User identity',
          id: 'identity-1',
          role: 'developer',
          type: 'professional',
        },
      ];

      const result = combineUserMemoryData(topicMemories, identities);

      expect(result).toEqual({
        contexts: topicMemories.contexts,
        experiences: topicMemories.experiences,
        identities: identities,
        preferences: topicMemories.preferences,
      });
    });

    it('should handle empty topic memories', () => {
      const emptyMemories: RetrieveMemoryResult = {
        contexts: [],
        experiences: [],
        preferences: [],
      };

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'User identity',
          id: 'identity-1',
          role: 'developer',
          type: 'professional',
        },
      ];

      const result = combineUserMemoryData(emptyMemories, identities);

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        identities: identities,
        preferences: [],
      });
    });

    it('should handle empty identities', () => {
      const topicMemories: RetrieveMemoryResult = {
        contexts: [createContext('ctx-1', 'Context')],
        experiences: [createExperience('exp-1', 'Experience')],
        preferences: [createPreference('pref-1', 'Preference')],
      };

      const result = combineUserMemoryData(topicMemories, []);

      expect(result).toEqual({
        contexts: topicMemories.contexts,
        experiences: topicMemories.experiences,
        identities: [],
        preferences: topicMemories.preferences,
      });
    });

    it('should handle both empty memories and identities', () => {
      const emptyMemories: RetrieveMemoryResult = {
        contexts: [],
        experiences: [],
        preferences: [],
      };

      const result = combineUserMemoryData(emptyMemories, []);

      expect(result).toEqual({
        contexts: [],
        experiences: [],
        identities: [],
        preferences: [],
      });
    });

    it('should preserve original array references', () => {
      const topicMemories: RetrieveMemoryResult = {
        contexts: [createContext('ctx-1', 'Context')],
        experiences: [createExperience('exp-1', 'Experience')],
        preferences: [createPreference('pref-1', 'Preference')],
      };

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Identity',
          id: 'id-1',
          role: 'role',
          type: 'type',
        },
      ];

      const result = combineUserMemoryData(topicMemories, identities);

      // Check that references are preserved
      expect(result.contexts).toBe(topicMemories.contexts);
      expect(result.experiences).toBe(topicMemories.experiences);
      expect(result.preferences).toBe(topicMemories.preferences);
      expect(result.identities).toBe(identities);
    });

    it('should combine multiple memories with multiple identities', () => {
      const topicMemories: RetrieveMemoryResult = {
        contexts: [
          createContext('ctx-1', 'Context 1'),
          createContext('ctx-2', 'Context 2'),
          createContext('ctx-3', 'Context 3'),
        ],
        experiences: [
          createExperience('exp-1', 'Experience 1'),
          createExperience('exp-2', 'Experience 2'),
        ],
        preferences: [
          createPreference('pref-1', 'Preference 1'),
          createPreference('pref-2', 'Preference 2'),
          createPreference('pref-3', 'Preference 3'),
          createPreference('pref-4', 'Preference 4'),
        ],
      };

      const identities: UserMemoryIdentityItem[] = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Identity 1',
          id: 'id-1',
          role: 'role-1',
          type: 'type-1',
        },
        {
          capturedAt: '2024-01-16T11:00:00Z',
          description: 'Identity 2',
          id: 'id-2',
          role: 'role-2',
          type: 'type-2',
        },
        {
          capturedAt: '2024-01-17T12:00:00Z',
          description: 'Identity 3',
          id: 'id-3',
          role: 'role-3',
          type: 'type-3',
        },
      ];

      const result = combineUserMemoryData(topicMemories, identities);

      expect(result.contexts).toHaveLength(3);
      expect(result.experiences).toHaveLength(2);
      expect(result.preferences).toHaveLength(4);
      expect(result.identities).toHaveLength(3);
    });
  });

  describe('integration scenarios', () => {
    it('should work together: resolve identities and memories, then combine', () => {
      const mockGlobalIdentities = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Developer identity',
          id: 'identity-1',
          metadata: { source: 'conversation' },
          role: 'developer',
          type: 'professional',
        },
      ];

      const mockTopicMemories: RetrieveMemoryResult = {
        contexts: [createContext('ctx-1', 'Working on LobeChat')],
        experiences: [createExperience('exp-1', 'Used Zustand before')],
        preferences: [createPreference('pref-1', 'Prefers TypeScript')],
      };

      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(
        () => mockGlobalIdentities as any,
      );
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => mockTopicMemories,
      );

      // Resolve both
      const identities = resolveGlobalIdentities();
      const memories = resolveTopicMemories({ topicId: 'topic-123' });

      // Combine them
      const combined = combineUserMemoryData(memories, identities);

      expect(combined.contexts).toEqual([createContext('ctx-1', 'Working on LobeChat')]);
      expect(combined.experiences).toEqual([createExperience('exp-1', 'Used Zustand before')]);
      expect(combined.identities).toEqual([
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'Developer identity',
          id: 'identity-1',
          role: 'developer',
          type: 'professional',
        },
      ]);
      expect(combined.preferences).toEqual([createPreference('pref-1', 'Prefers TypeScript')]);
    });

    it('should handle scenario with no active topic and no identities', () => {
      vi.spyOn(chatStore, 'getChatStoreState').mockReturnValue({
        activeTopicId: undefined,
      } as any);
      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(
        () => [],
      );

      const identities = resolveGlobalIdentities();
      const memories = resolveTopicMemories();
      const combined = combineUserMemoryData(memories, identities);

      expect(combined).toEqual({
        contexts: [],
        experiences: [],
        identities: [],
        preferences: [],
      });
    });

    it('should handle scenario with identities but no topic memories', () => {
      const mockGlobalIdentities = [
        {
          capturedAt: '2024-01-15T10:00:00Z',
          description: 'User identity',
          id: 'identity-1',
          metadata: {},
          role: 'user',
          type: 'basic',
        },
      ];

      vi.spyOn(userMemorySelectors.identitySelectors, 'globalIdentities').mockImplementation(
        () => mockGlobalIdentities as any,
      );
      vi.spyOn(userMemorySelectors.agentMemorySelectors, 'topicMemories').mockReturnValue(
        () => undefined,
      );

      const identities = resolveGlobalIdentities();
      const memories = resolveTopicMemories({ topicId: 'topic-no-cache' });
      const combined = combineUserMemoryData(memories, identities);

      expect(combined).toEqual({
        contexts: [],
        experiences: [],
        identities: [
          {
            capturedAt: '2024-01-15T10:00:00Z',
            description: 'User identity',
            id: 'identity-1',
            role: 'user',
            type: 'basic',
          },
        ],
        preferences: [],
      });
    });
  });
});
