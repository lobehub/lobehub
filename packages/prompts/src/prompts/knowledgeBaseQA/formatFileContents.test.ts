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
});
