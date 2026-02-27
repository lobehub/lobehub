import { describe, expect, it } from 'vitest';

import { searchResultsPrompt } from './searchResults';

describe('searchResultsPrompt', () => {
  it('should return explicit empty message for empty results', () => {
    const result = searchResultsPrompt([]);
    expect(result).toBe('<searchResults>No results found.</searchResults>');
  });

  it('should convert basic search results to compact XML format', () => {
    const results = [
      {
        title: 'Example Title',
        url: 'https://example.com',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Example Title" url="https://example.com" />
</searchResults>`);
  });

  it('should include content as element text when present', () => {
    const results = [
      {
        title: 'Research Paper',
        url: 'http://arxiv.org/abs/2108.11510v1',
        content: 'Deep reinforcement learning survey',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Research Paper" url="http://arxiv.org/abs/2108.11510v1">Deep reinforcement learning survey</item>
</searchResults>`);
  });

  it('should include optional fields as attributes when present', () => {
    const results = [
      {
        title: 'Research Paper',
        url: 'http://arxiv.org/abs/2108.11510v1',
        content: 'Deep reinforcement learning survey',
        publishedDate: '2021-08-25T23:01:48',
        imgSrc: 'https://example.com/image.jpg',
        thumbnail: 'https://example.com/thumb.jpg',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Research Paper" url="http://arxiv.org/abs/2108.11510v1" publishedDate="2021-08-25T23:01:48" imgSrc="https://example.com/image.jpg" thumbnail="https://example.com/thumb.jpg">Deep reinforcement learning survey</item>
</searchResults>`);
  });

  it('should omit optional fields when not present', () => {
    const results = [
      {
        title: 'Simple Result',
        url: 'https://example.com',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Simple Result" url="https://example.com" />
</searchResults>`);
  });

  it('should escape XML special characters in attributes', () => {
    const results = [
      {
        title: 'Title with <tags> & "quotes"',
        url: 'https://example.com?foo=bar&baz=qux',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Title with &lt;tags&gt; &amp; &quot;quotes&quot;" url="https://example.com?foo=bar&amp;baz=qux" />
</searchResults>`);
  });

  it('should escape XML special characters in content', () => {
    const results = [
      {
        title: 'Test',
        url: 'https://example.com',
        content: 'Content with <html> & special chars',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Test" url="https://example.com">Content with &lt;html&gt; &amp; special chars</item>
</searchResults>`);
  });

  it('should handle multiple search results', () => {
    const results = [
      { title: 'First', url: 'https://first.com', content: 'First content' },
      { title: 'Second', url: 'https://second.com', content: 'Second content' },
      { title: 'Third', url: 'https://third.com' },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="First" url="https://first.com">First content</item>
  <item title="Second" url="https://second.com">Second content</item>
  <item title="Third" url="https://third.com" />
</searchResults>`);
  });

  it('should create compact single-line items', () => {
    const results = [
      {
        title: 'Test',
        url: 'https://test.com',
        content: 'Content',
      },
    ];

    const xml = searchResultsPrompt(results);

    expect(xml).toEqual(`<searchResults>
  <item title="Test" url="https://test.com">Content</item>
</searchResults>`);
  });
});
