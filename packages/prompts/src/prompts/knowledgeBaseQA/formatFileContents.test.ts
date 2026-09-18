import { describe, expect, it } from 'vitest';

import type { FileContent } from './formatFileContents';
import { promptFileContents } from './formatFileContents';

describe('promptFileContents', () => {
  it('should format single file content', () => {
    const fileContents: FileContent[] = [
      {
        content: 'This is the file content with some important information.',
        fileId: 'file-001',
        filename: 'document.md',
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
  });

  it('should format multiple file contents', () => {
    const fileContents: FileContent[] = [
      {
        content: 'First file content about API authentication.',
        fileId: 'file-001',
        filename: 'auth-guide.md',
      },
      {
        content: 'Second file content about database setup and configuration.',
        fileId: 'file-002',
        filename: 'db-setup.md',
      },
      {
        content: 'Third file content with deployment instructions.',
        fileId: 'file-003',
        filename: 'deployment.md',
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
  });

  it('should handle file with error', () => {
    const fileContents: FileContent[] = [
      {
        content: '',
        error: 'File not found',
        fileId: 'file-404',
        filename: 'missing.md',
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
  });

  it('should handle mixed successful and error files', () => {
    const fileContents: FileContent[] = [
      {
        content: 'Successfully loaded content from this file.',
        fileId: 'file-001',
        filename: 'success.md',
      },
      {
        content: '',
        error: 'Permission denied',
        fileId: 'file-002',
        filename: 'restricted.md',
      },
      {
        content: 'Another successfully loaded file with more content.',
        fileId: 'file-003',
        filename: 'another-success.md',
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
  });

  it('should handle file with special characters in name', () => {
    const fileContents: FileContent[] = [
      {
        content: 'Content from a file with special characters in the name.',
        fileId: 'file-special',
        filename: 'FAQ: Q&A (2024).md',
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
  });

  it('should handle file with long content', () => {
    const fileContents: FileContent[] = [
      {
        content: `# Comprehensive Guide

## Introduction
This is a very long document with multiple sections and detailed information.

## Section 1
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Section 2
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Conclusion
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`,
        fileId: 'file-long',
        filename: 'comprehensive-guide.md',
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
  });

  it('should explain an empty window whose offset is past the end of the file', () => {
    const result = promptFileContents([
      {
        content: '',
        fileId: 'file-eof',
        filename: 'short.md',
        range: {
          endLine: 0,
          startLine: 900,
          totalCharCount: 100,
          totalLineCount: 800,
          truncated: false,
        },
      },
    ]);

    expect(result).toContain('lines="900-0"');
    expect(result).toContain('offset 900 is past the end of this 800-line file');
  });

  it('should explain a line that was cut to fit the per-call cap', () => {
    const result = promptFileContents([
      {
        content: 'x'.repeat(10),
        fileId: 'file-cut',
        filename: 'minified.json',
        range: {
          cutLine: { keptChars: 10, line: 1, totalChars: 30_000 },
          endLine: 1,
          startLine: 1,
          totalCharCount: 30_002,
          totalLineCount: 2,
          truncated: true,
        },
      },
    ]);

    expect(result).toContain('Line 1 is 30000 characters long and was cut at 10');
    expect(result).toContain('offset=2 to continue with the next line');
  });

  it('should render a paged window with range attributes and a continue notice', () => {
    const fileContents: FileContent[] = [
      {
        content: 'line 1\nline 2',
        fileId: 'file-paged',
        filename: 'long.md',
        range: {
          endLine: 2,
          startLine: 1,
          totalCharCount: 30_334,
          totalLineCount: 800,
          truncated: true,
        },
      },
      {
        content: 'tail line',
        fileId: 'file-complete',
        filename: 'short.md',
        range: {
          endLine: 1,
          startLine: 1,
          totalCharCount: 9,
          totalLineCount: 1,
          truncated: false,
        },
      },
    ];

    const result = promptFileContents(fileContents);
    expect(result).toMatchSnapshot();
    expect(result).toContain('lines="1-2" totalLines="800" totalChars="30334" truncated="true"');
    expect(result).toContain('Call readKnowledge again with offset=3 to continue.');
    expect(result).not.toContain('offset=2 to continue');
  });
});
