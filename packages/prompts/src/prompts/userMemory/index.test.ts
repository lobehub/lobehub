import { describe, expect, it } from 'vitest';

import { promptUserMemory } from './index';

describe('promptUserMemory', () => {
  describe('empty cases', () => {
    it('should return empty string when no memories at all', () => {
      const result = promptUserMemory({
        memories: {},
      });
      expect(result).toBe('');
    });

    it('should return empty string when all memory arrays are empty', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [],
          experiences: [],
          preferences: [],
        },
      });
      expect(result).toBe('');
    });
  });

  describe('contexts only', () => {
    it('should format single context', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'User is a software engineer working on web applications',
              id: 'ctx-1',
              title: 'Professional Background',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format multiple contexts', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'User prefers TypeScript over JavaScript',
              id: 'ctx-1',
              title: 'Language Preference',
            },
            {
              description: 'User is building a SaaS product',
              id: 'ctx-2',
              title: 'Current Project',
            },
            {
              description: 'User is based in San Francisco timezone',
              id: 'ctx-3',
              title: 'Location',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle context with null/undefined values', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: null,
              id: 'ctx-1',
              title: null,
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle context without id', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'Some context description',
              title: 'Some Title',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });
  });

  describe('experiences only', () => {
    it('should format single experience', () => {
      const result = promptUserMemory({
        memories: {
          experiences: [
            {
              id: 'exp-1',
              keyLearning: 'User prefers concise explanations with code examples',
              situation: 'User asked about React hooks implementation',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format multiple experiences', () => {
      const result = promptUserMemory({
        memories: {
          experiences: [
            {
              id: 'exp-1',
              keyLearning: 'User likes step-by-step debugging guidance',
              situation: 'Debugging a memory leak in Node.js',
            },
            {
              id: 'exp-2',
              keyLearning: 'User appreciates alternative approaches being mentioned',
              situation: 'Discussing database schema design',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle experience with null/undefined values', () => {
      const result = promptUserMemory({
        memories: {
          experiences: [
            {
              id: 'exp-1',
              keyLearning: null,
              situation: null,
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });
  });

  describe('preferences only', () => {
    it('should format single preference', () => {
      const result = promptUserMemory({
        memories: {
          preferences: [
            {
              conclusionDirectives: 'Always use TypeScript strict mode',
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format multiple preferences', () => {
      const result = promptUserMemory({
        memories: {
          preferences: [
            {
              conclusionDirectives: 'Prefer functional programming patterns',
              id: 'pref-1',
            },
            {
              conclusionDirectives: 'Use ESLint with Prettier for formatting',
              id: 'pref-2',
            },
            {
              conclusionDirectives: 'Write unit tests for all new features',
              id: 'pref-3',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should skip preference with null conclusionDirectives', () => {
      const result = promptUserMemory({
        memories: {
          preferences: [
            {
              conclusionDirectives: null,
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should skip preference with empty conclusionDirectives', () => {
      const result = promptUserMemory({
        memories: {
          preferences: [
            {
              conclusionDirectives: '',
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should filter out empty preferences and keep valid ones', () => {
      const result = promptUserMemory({
        memories: {
          preferences: [
            {
              conclusionDirectives: null,
              id: 'pref-1',
            },
            {
              conclusionDirectives: 'Valid preference',
              id: 'pref-2',
            },
            {
              conclusionDirectives: '',
              id: 'pref-3',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });
  });

  describe('identities only', () => {
    it('should format identities grouped by type', () => {
      const result = promptUserMemory({
        memories: {
          identities: [
            {
              description: 'User is a father of two children',
              id: 'id-1',
              role: 'Father',
              type: 'personal',
            },
            {
              description: 'User is a senior software engineer',
              id: 'id-2',
              role: 'Software Engineer',
              type: 'professional',
            },
            {
              description: 'User is based in Shanghai',
              id: 'id-3',
              type: 'demographic',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format single type identities (personal only)', () => {
      const result = promptUserMemory({
        memories: {
          identities: [
            {
              description: 'User is married',
              id: 'id-1',
              type: 'personal',
            },
            {
              description: 'User has a pet dog',
              id: 'id-2',
              type: 'personal',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format single type identities (professional only)', () => {
      const result = promptUserMemory({
        memories: {
          identities: [
            {
              description: 'User works at a tech startup',
              id: 'id-1',
              role: 'CTO',
              type: 'professional',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format single type identities (demographic only)', () => {
      const result = promptUserMemory({
        memories: {
          identities: [
            {
              description: 'User is 35 years old',
              id: 'id-1',
              type: 'demographic',
            },
            {
              description: 'User speaks Mandarin and English',
              id: 'id-2',
              type: 'demographic',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle identity without role', () => {
      const result = promptUserMemory({
        memories: {
          identities: [
            {
              description: 'User enjoys hiking',
              id: 'id-1',
              type: 'personal',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle identity with null values', () => {
      const result = promptUserMemory({
        memories: {
          identities: [
            {
              description: null,
              id: 'id-1',
              role: null,
              type: 'personal',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });
  });

  describe('mixed memory types', () => {
    it('should format all memory types together', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'Senior developer with 10 years experience',
              id: 'ctx-1',
              title: 'Experience Level',
            },
          ],
          experiences: [
            {
              id: 'exp-1',
              keyLearning: 'Prefers detailed architectural discussions',
              situation: 'System design conversation',
            },
          ],
          identities: [
            {
              description: 'User is a tech lead at a startup',
              id: 'id-1',
              role: 'Tech Lead',
              type: 'professional',
            },
          ],
          preferences: [
            {
              conclusionDirectives: 'Use design patterns when appropriate',
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format all memory types with multiple identities', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'Working on AI products',
              id: 'ctx-1',
              title: 'Current Work',
            },
          ],
          experiences: [
            {
              id: 'exp-1',
              keyLearning: 'Likes practical examples',
              situation: 'Code review session',
            },
          ],
          identities: [
            {
              description: 'User is a father',
              id: 'id-1',
              role: 'Father',
              type: 'personal',
            },
            {
              description: 'User is a senior engineer',
              id: 'id-2',
              role: 'Senior Engineer',
              type: 'professional',
            },
            {
              description: 'User lives in Beijing',
              id: 'id-3',
              type: 'demographic',
            },
          ],
          preferences: [
            {
              conclusionDirectives: 'Prefer concise responses',
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format contexts and experiences without preferences', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'Working on mobile app development',
              id: 'ctx-1',
              title: 'Current Focus',
            },
          ],
          experiences: [
            {
              id: 'exp-1',
              keyLearning: 'Likes React Native examples',
              situation: 'Mobile development discussion',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format contexts and preferences without experiences', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'Backend developer specializing in APIs',
              id: 'ctx-1',
              title: 'Specialization',
            },
          ],
          preferences: [
            {
              conclusionDirectives: 'Always include error handling in examples',
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should format experiences and preferences without contexts', () => {
      const result = promptUserMemory({
        memories: {
          experiences: [
            {
              id: 'exp-1',
              keyLearning: 'Appreciates performance optimization tips',
              situation: 'Database query optimization',
            },
          ],
          preferences: [
            {
              conclusionDirectives: 'Mention time complexity for algorithms',
              id: 'pref-1',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in content', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: 'Uses <React/> & Vue.js frameworks with "strict" mode',
              id: 'ctx-1',
              title: 'Tech Stack & Tools',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle multiline content', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: `Line 1: First point
Line 2: Second point
Line 3: Third point`,
              id: 'ctx-1',
              title: 'Multi-line Context',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle very long content', () => {
      const longDescription = 'A'.repeat(500);
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: longDescription,
              id: 'ctx-1',
              title: 'Long Content Test',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });

    it('should handle unicode characters', () => {
      const result = promptUserMemory({
        memories: {
          contexts: [
            {
              description: '用户偏好中文回复 🚀 with émojis and spëcial chàracters',
              id: 'ctx-1',
              title: '语言偏好 🌍',
            },
          ],
        },
      });
      expect(result).toMatchSnapshot();
    });
  });
});
