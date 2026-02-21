import { describe, expect, it } from 'vitest';

import type { FileSearchResult } from './formatSearchResults';
import { formatSearchResults } from './formatSearchResults';

describe('formatSearchResults', () => {
  it('should format single file with multiple chunks', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'file-123',
        fileName: 'Getting Started Guide.md',
        relevanceScore: 0.92,
        topChunks: [
          {
            similarity: 0.95,
            text: 'To get started with the application, first install all dependencies using npm install or yarn install. Make sure you have Node.js version 16 or higher installed on your system.',
          },
          {
            similarity: 0.88,
            text: 'After installation, you can run the development server with npm run dev. The application will be available at http://localhost:3000 by default.',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'how to install the application');
    expect(result).toMatchSnapshot();
  });

  it('should format multiple files with varying relevance scores', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'doc-001',
        fileName: 'API Reference.md',
        relevanceScore: 0.95,
        topChunks: [
          {
            similarity: 0.98,
            text: 'The Authentication API provides endpoints for user login, logout, and token refresh. All endpoints require HTTPS and proper API keys.',
          },
          {
            similarity: 0.92,
            text: 'To authenticate a user, send a POST request to /api/auth/login with username and password in the request body.',
          },
        ],
      },
      {
        fileId: 'doc-002',
        fileName: 'Security Best Practices.md',
        relevanceScore: 0.87,
        topChunks: [
          {
            similarity: 0.89,
            text: 'Always use environment variables to store sensitive information like API keys and database credentials. Never commit these to version control.',
          },
          {
            similarity: 0.85,
            text: 'Implement rate limiting on all public endpoints to prevent abuse and DDoS attacks.',
          },
        ],
      },
      {
        fileId: 'doc-003',
        fileName: 'Troubleshooting Guide.md',
        relevanceScore: 0.73,
        topChunks: [
          {
            similarity: 0.75,
            text: 'If you encounter authentication errors, first verify that your API key is valid and has not expired.',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'API authentication security');
    expect(result).toMatchSnapshot();
  });

  it('should format long text chunks without truncation', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'long-doc',
        fileName: 'Detailed Documentation.md',
        relevanceScore: 0.91,
        topChunks: [
          {
            similarity: 0.93,
            text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'documentation details');
    expect(result).toMatchSnapshot();
  });

  it('should handle empty file results', () => {
    const fileResults: FileSearchResult[] = [];
    const result = formatSearchResults(fileResults, 'no results query');
    expect(result).toMatchSnapshot();
  });

  it('should format file with special characters in name', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'special-123',
        fileName: 'FAQ: Common Questions & Answers (2024).md',
        relevanceScore: 0.88,
        topChunks: [
          {
            similarity: 0.9,
            text: 'Q: How do I reset my password? A: Click on the "Forgot Password" link on the login page.',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'password reset');
    expect(result).toMatchSnapshot();
  });

  it('should handle files with low relevance scores', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'low-relevance',
        fileName: 'Tangentially Related.md',
        relevanceScore: 0.32,
        topChunks: [
          {
            similarity: 0.35,
            text: 'This document contains some loosely related information that might be helpful.',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'specific technical query');
    expect(result).toMatchSnapshot();
  });

  it('should format query with special characters', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'code-sample',
        fileName: 'Code Examples.md',
        relevanceScore: 0.94,
        topChunks: [
          {
            similarity: 0.96,
            text: 'Use the following TypeScript code: const result = await fetchData<T>({ url, params });',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'How to use fetchData<T> with async/await?');
    expect(result).toMatchSnapshot();
  });

  it('should handle file with multiple high-similarity chunks', () => {
    const fileResults: FileSearchResult[] = [
      {
        fileId: 'comprehensive-guide',
        fileName: 'Complete Tutorial.md',
        relevanceScore: 0.96,
        topChunks: [
          {
            similarity: 0.98,
            text: 'Step 1: Initialize the project with the configuration file.',
          },
          {
            similarity: 0.97,
            text: 'Step 2: Configure the environment variables for your deployment.',
          },
          {
            similarity: 0.96,
            text: 'Step 3: Run the migration scripts to set up the database schema.',
          },
          {
            similarity: 0.95,
            text: 'Step 4: Start the development server and verify everything is working.',
          },
        ],
      },
    ];

    const result = formatSearchResults(fileResults, 'project setup steps');
    expect(result).toMatchSnapshot();
  });
});
