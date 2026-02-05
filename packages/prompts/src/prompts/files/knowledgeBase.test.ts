import { describe, expect, it } from 'vitest';

import type { FileContent } from '../knowledgeBaseQA';
import type { KnowledgeBaseInfo } from './knowledgeBase';
import { promptAgentKnowledge } from './knowledgeBase';

describe('promptAgentKnowledge', () => {
  it('should return empty string when no files and no knowledge bases', () => {
    const result = promptAgentKnowledge({});
    expect(result).toBe('');
  });

  it('should format only files when no knowledge bases', () => {
    const fileContents: FileContent[] = [
      {
        content: 'This is the content of document 1',
        fileId: 'file1',
        filename: 'doc1.txt',
      },
      {
        content: 'This is the content of document 2',
        fileId: 'file2',
        filename: 'doc2.md',
      },
    ];

    const result = promptAgentKnowledge({ fileContents });
    expect(result).toMatchSnapshot();
  });

  it('should format only knowledge bases when no files', () => {
    const knowledgeBases: KnowledgeBaseInfo[] = [
      {
        description: 'API documentation',
        id: 'kb1',
        name: 'Documentation',
      },
      {
        description: null,
        id: 'kb2',
        name: 'FAQs',
      },
    ];

    const result = promptAgentKnowledge({ knowledgeBases });
    expect(result).toMatchSnapshot();
  });

  it('should format both files and knowledge bases', () => {
    const fileContents: FileContent[] = [
      {
        content: 'File content here',
        fileId: 'file1',
        filename: 'readme.md',
      },
    ];

    const knowledgeBases: KnowledgeBaseInfo[] = [
      {
        description: 'Company knowledge base',
        id: 'kb1',
        name: 'Internal Docs',
      },
    ];

    const result = promptAgentKnowledge({ fileContents, knowledgeBases });
    expect(result).toMatchSnapshot();
  });

  it('should handle file with error', () => {
    const fileContents: FileContent[] = [
      {
        content: '',
        error: 'File not found',
        fileId: 'file1',
        filename: 'missing.txt',
      },
    ];

    const result = promptAgentKnowledge({ fileContents });
    expect(result).toMatchSnapshot();
  });

  it('should handle multiple files and multiple knowledge bases', () => {
    const fileContents: FileContent[] = [
      {
        content: 'Content of first file',
        fileId: 'file1',
        filename: 'first.txt',
      },
      {
        content: 'Content of second file',
        fileId: 'file2',
        filename: 'second.md',
      },
      {
        content: '',
        error: 'Parse error',
        fileId: 'file3',
        filename: 'broken.pdf',
      },
    ];

    const knowledgeBases: KnowledgeBaseInfo[] = [
      {
        description: 'Technical documentation',
        id: 'kb1',
        name: 'Tech Docs',
      },
      {
        description: null,
        id: 'kb2',
        name: 'User Guides',
      },
      {
        description: 'Frequently asked questions',
        id: 'kb3',
        name: 'FAQ Database',
      },
    ];

    const result = promptAgentKnowledge({ fileContents, knowledgeBases });
    expect(result).toMatchSnapshot();
  });

  it('should handle knowledge base without description', () => {
    const knowledgeBases: KnowledgeBaseInfo[] = [
      {
        id: 'kb1',
        name: 'Simple KB',
      },
    ];

    const result = promptAgentKnowledge({ knowledgeBases });
    expect(result).toMatchSnapshot();
  });

  it('should handle file with special characters in filename', () => {
    const fileContents: FileContent[] = [
      {
        content: 'Special content',
        fileId: 'file1',
        filename: 'file with spaces & special-chars.txt',
      },
    ];

    const result = promptAgentKnowledge({ fileContents });
    expect(result).toMatchSnapshot();
  });

  it('should handle file with multiline content', () => {
    const fileContents: FileContent[] = [
      {
        content: `Line 1
Line 2
Line 3

Line 5 with gap`,
        fileId: 'file1',
        filename: 'multiline.txt',
      },
    ];

    const result = promptAgentKnowledge({ fileContents });
    expect(result).toMatchSnapshot();
  });
});
