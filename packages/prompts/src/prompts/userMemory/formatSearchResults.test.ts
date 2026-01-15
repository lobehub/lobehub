import { UserMemoryContextObjectType, UserMemoryContextSubjectType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { formatMemorySearchResults } from './formatSearchResults';

describe('formatMemorySearchResults', () => {
  it('should return empty results message when no memories found', () => {
    const result = formatMemorySearchResults({
      query: 'test query',
      results: {
        contexts: [],
        experiences: [],
        preferences: [],
      },
    });

    expect(result).toMatchSnapshot();
  });

  it('should format context memories with full content', () => {
    const result = formatMemorySearchResults({
      query: 'project',
      results: {
        contexts: [
          {
            accessedAt: new Date('2024-01-01'),
            associatedObjects: [{ name: 'React', type: UserMemoryContextObjectType.Application }],
            associatedSubjects: [{ name: 'John', type: UserMemoryContextSubjectType.Person }],
            createdAt: new Date('2024-01-01'),
            currentStatus: 'in-progress',
            description: 'Building a new web application',
            id: 'ctx-1',
            metadata: null,
            scoreImpact: 8,
            scoreUrgency: 7,
            tags: ['frontend', 'react'],
            title: 'Web App Project',
            type: 'project',
            updatedAt: new Date('2024-01-01'),
            userMemoryIds: null,
          },
        ],
        experiences: [],
        preferences: [],
      },
    });

    expect(result).toMatchSnapshot();
  });

  it('should format experience memories with full content', () => {
    const result = formatMemorySearchResults({
      query: 'debugging',
      results: {
        contexts: [],
        experiences: [
          {
            accessedAt: new Date('2024-01-01'),
            action: 'Used breakpoints instead of console.log',
            createdAt: new Date('2024-01-01'),
            id: 'exp-1',
            keyLearning: 'Breakpoints save time in complex debugging',
            metadata: null,
            possibleOutcome: 'Faster debugging sessions',
            reasoning: 'Console logs clutter the code',
            scoreConfidence: 9,
            situation: 'Debugging complex state issues',
            tags: ['debugging', 'best-practice'],
            type: 'lesson',
            updatedAt: new Date('2024-01-01'),
            userMemoryId: null,
          },
        ],
        preferences: [],
      },
    });

    expect(result).toMatchSnapshot();
  });

  it('should format preference memories with full content', () => {
    const result = formatMemorySearchResults({
      query: 'code style',
      results: {
        contexts: [],
        experiences: [],
        preferences: [
          {
            accessedAt: new Date('2024-01-01'),
            conclusionDirectives: 'Always use TypeScript strict mode',
            createdAt: new Date('2024-01-01'),
            id: 'pref-1',
            metadata: null,
            scorePriority: 10,
            suggestions: 'Consider adding eslint rules',
            tags: ['typescript', 'code-quality'],
            type: 'coding-standard',
            updatedAt: new Date('2024-01-01'),
            userMemoryId: null,
          },
        ],
      },
    });

    expect(result).toMatchSnapshot();
  });

  it('should format mixed results with all memory types', () => {
    const result = formatMemorySearchResults({
      query: 'work',
      results: {
        contexts: [
          {
            accessedAt: new Date('2024-01-01'),
            associatedObjects: null,
            associatedSubjects: null,
            createdAt: new Date('2024-01-01'),
            currentStatus: null,
            description: 'Context description',
            id: 'ctx-1',
            metadata: null,
            scoreImpact: null,
            scoreUrgency: null,
            tags: null,
            title: 'Context Title',
            type: null,
            updatedAt: new Date('2024-01-01'),
            userMemoryIds: null,
          },
        ],
        experiences: [
          {
            accessedAt: new Date('2024-01-01'),
            action: null,
            createdAt: new Date('2024-01-01'),
            id: 'exp-1',
            keyLearning: 'Key learning',
            metadata: null,
            possibleOutcome: null,
            reasoning: null,
            scoreConfidence: null,
            situation: 'Situation',
            tags: null,
            type: null,
            updatedAt: new Date('2024-01-01'),
            userMemoryId: null,
          },
        ],
        preferences: [
          {
            accessedAt: new Date('2024-01-01'),
            conclusionDirectives: 'Directive',
            createdAt: new Date('2024-01-01'),
            id: 'pref-1',
            metadata: null,
            scorePriority: null,
            suggestions: null,
            tags: null,
            type: null,
            updatedAt: new Date('2024-01-01'),
            userMemoryId: null,
          },
        ],
      },
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle null and undefined values gracefully', () => {
    const result = formatMemorySearchResults({
      query: 'test',
      results: {
        contexts: [
          {
            accessedAt: new Date('2024-01-01'),
            associatedObjects: null,
            associatedSubjects: null,
            createdAt: new Date('2024-01-01'),
            currentStatus: null,
            description: null,
            id: 'ctx-1',
            metadata: null,
            scoreImpact: null,
            scoreUrgency: null,
            tags: null,
            title: null,
            type: null,
            updatedAt: new Date('2024-01-01'),
            userMemoryIds: null,
          },
        ],
        experiences: [],
        preferences: [],
      },
    });

    expect(result).toMatchSnapshot();
  });
});
