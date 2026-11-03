import type { ChatSemanticSearchChunk, KnowledgeItem } from '@lobechat/types';
import { KnowledgeType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { knowledgeBaseQAPrompts } from './index';

describe('knowledgeBaseQAPrompts', () => {
  // Define test data
  const mockChunks: ChatSemanticSearchChunk[] = [
    {
      id: '1',
      fileId: 'file1',
      fileName: 'test.txt',
      text: 'This is a test chunk',
      similarity: 0.8,
      pageNumber: 1,
    },
  ];

  const mockKnowledge: KnowledgeItem[] = [
    {
      id: 'kb1',
      name: 'Test Knowledge',
      type: KnowledgeType.File,
      fileType: 'txt',
      description: 'Test description',
    },
  ];

  const userQuery = 'What is the test about?';
  const rewriteQuery = 'Could you explain the content of the test?';

  it('should return empty string if chunks is empty', () => {
    const result = knowledgeBaseQAPrompts({
      chunks: [],
      knowledge: mockKnowledge,
      userQuery,
    });

    expect(result).toBe('');
  });

  it('should return empty string if chunks is undefined', () => {
    const result = knowledgeBaseQAPrompts({
      knowledge: mockKnowledge,
      userQuery,
    });

    expect(result).toBe('');
  });

  it('should generate prompt with all parameters', () => {
    const result = knowledgeBaseQAPrompts({
      chunks: mockChunks,
      knowledge: mockKnowledge,
      userQuery,
      rewriteQuery,
    });

    // Verify the prompt structure and content
    expect(result).toMatchSnapshot();
  });

  it('should generate prompt without rewriteQuery', () => {
    const result = knowledgeBaseQAPrompts({
      chunks: mockChunks,
      knowledge: mockKnowledge,
      userQuery,
    });

    expect(result).toContain('<raw_query>What is the test about?</raw_query>');
    expect(result).not.toContain('<rewrite_query>');
  });

  it('should generate prompt without knowledge', () => {
    const result = knowledgeBaseQAPrompts({
      chunks: mockChunks,
      userQuery,
    });

    expect(result).toContain(
      'You are also a helpful assistant good answering questions related to',
    );
    expect(result).not.toContain('<knowledge_bases>');
  });

  it('should handle empty knowledge array', () => {
    const result = knowledgeBaseQAPrompts({
      chunks: mockChunks,
      knowledge: [],
      userQuery,
    });

    expect(result).toContain(
      'You are also a helpful assistant good answering questions related to',
    );
    expect(result).not.toContain('<knowledge_bases>');
  });

  it('should properly escape special characters in input', () => {
    const specialChunks: ChatSemanticSearchChunk[] = [
      {
        id: '1',
        fileId: 'file1',
        fileName: 'test&.txt',
        text: 'This is a test with & < > "quotes"',
        similarity: 0.8,
      },
    ];

    const result = knowledgeBaseQAPrompts({
      chunks: specialChunks,
      userQuery: 'Test with & < > "quotes"',
    });

    expect(result).toContain('test&.txt');
    expect(result).toContain('This is a test with & < > "quotes"');
    expect(result).toContain('Test with & < > "quotes"');
  });

  it('should handle multiple knowledge items', () => {
    const multipleKnowledge: KnowledgeItem[] = [
      {
        id: 'kb1',
        name: 'Knowledge 1',
        type: KnowledgeType.File,
      },
      {
        id: 'kb2',
        name: 'Knowledge 2',
        type: KnowledgeType.KnowledgeBase,
      },
    ];

    const result = knowledgeBaseQAPrompts({
      chunks: mockChunks,
      knowledge: multipleKnowledge,
      userQuery,
    });

    expect(result).toContain('Knowledge 1/Knowledge 2');
    expect(result).toContain('<knowledge id="kb1"');
    expect(result).toContain('<knowledge id="kb2"');
  });
});
