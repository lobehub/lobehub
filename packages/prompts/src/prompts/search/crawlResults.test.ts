import { describe, expect, it } from 'vitest';

import { crawlResultsPrompt } from './crawlResults';

describe('crawlResultsPrompt', () => {
  it('should return empty XML for empty results', () => {
    const result = crawlResultsPrompt([]);
    expect(result).toBe('<no_crawl_results />');
  });

  it('should convert basic crawl result to compact XML format', () => {
    const results = [
      {
        url: 'https://example.com',
        title: 'Example Page',
        content: 'Page content here',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="https://example.com" title="Example Page">Page content here</page>
</crawlResults>`);
  });

  it('should include all optional metadata fields', () => {
    const results = [
      {
        url: 'http://arxiv.org/abs/2509.09734v1',
        title: 'MCP-AgentBench: Evaluating Real-World Language Agent Performance',
        contentType: 'text' as const,
        description: 'Abstract page for arXiv paper 2509.09734v1',
        length: 10187,
        content: 'Full paper content...',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="http://arxiv.org/abs/2509.09734v1" title="MCP-AgentBench: Evaluating Real-World Language Agent Performance" contentType="text" description="Abstract page for arXiv paper 2509.09734v1" length="10187">Full paper content...</page>
</crawlResults>`);
  });

  it('should handle page without content', () => {
    const results = [
      {
        url: 'https://example.com',
        title: 'Empty Page',
        contentType: 'text' as const,
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="https://example.com" title="Empty Page" contentType="text" />
</crawlResults>`);
  });

  it('should handle error items', () => {
    const results = [
      {
        errorType: 'NetworkError',
        errorMessage: 'Failed to fetch the page',
        url: 'https://failed.com',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <error errorType="NetworkError" errorMessage="Failed to fetch the page" url="https://failed.com" />
</crawlResults>`);
  });

  it('should escape XML special characters in attributes', () => {
    const results = [
      {
        url: 'https://example.com?foo=bar&baz=qux',
        title: 'Title with <tags> & "quotes"',
        description: 'Description with special chars & <html>',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="https://example.com?foo=bar&amp;baz=qux" title="Title with &lt;tags&gt; &amp; &quot;quotes&quot;" description="Description with special chars &amp; &lt;html&gt;" />
</crawlResults>`);
  });

  it('should escape XML special characters in content', () => {
    const results = [
      {
        url: 'https://example.com',
        title: 'Test',
        content: 'Content with <html> tags & special chars',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="https://example.com" title="Test">Content with &lt;html&gt; tags &amp; special chars</page>
</crawlResults>`);
  });

  it('should handle multiple pages with mixed success and errors', () => {
    const results = [
      {
        url: 'https://success1.com',
        title: 'First Page',
        content: 'First content',
      },
      {
        errorType: 'TimeoutError',
        errorMessage: 'Request timeout',
        url: 'https://failed.com',
      },
      {
        url: 'https://success2.com',
        title: 'Second Page',
        content: 'Second content',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="https://success1.com" title="First Page">First content</page>
  <error errorType="TimeoutError" errorMessage="Request timeout" url="https://failed.com" />
  <page url="https://success2.com" title="Second Page">Second content</page>
</crawlResults>`);
  });

  it('should handle error without url', () => {
    const results = [
      {
        errorType: 'UnknownError',
        errorMessage: 'Unknown error occurred',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <error errorType="UnknownError" errorMessage="Unknown error occurred" />
</crawlResults>`);
  });

  it('should handle real arXiv example', () => {
    const results = [
      {
        url: 'http://arxiv.org/abs/2508.01780v1',
        title: 'LiveMCPBench: Can Agents Navigate an Ocean of MCP Tools?',
        contentType: 'text' as const,
        description: 'Abstract page for arXiv paper 2508.01780v1',
        length: 10512,
        content:
          'With the rapid development of Model Context Protocol (MCP), the number of MCP servers has surpassed 10,000...',
      },
    ];

    const xml = crawlResultsPrompt(results);

    expect(xml).toEqual(`<crawlResults>
  <page url="http://arxiv.org/abs/2508.01780v1" title="LiveMCPBench: Can Agents Navigate an Ocean of MCP Tools?" contentType="text" description="Abstract page for arXiv paper 2508.01780v1" length="10512">With the rapid development of Model Context Protocol (MCP), the number of MCP servers has surpassed 10,000...</page>
</crawlResults>`);
  });
});
