import { describe, expect, it } from 'vitest';

import { escapeXmlAttr, escapeXmlContent } from './xmlEscape';

describe('escapeXmlAttr', () => {
  describe('normal cases', () => {
    it('should escape ampersand (&) to &amp;', () => {
      const result = escapeXmlAttr('foo & bar');
      expect(result).toBe('foo &amp; bar');
    });

    it('should escape double quotes (") to &quot;', () => {
      const result = escapeXmlAttr('foo "bar" baz');
      expect(result).toBe('foo &quot;bar&quot; baz');
    });

    it('should escape less than (<) to &lt;', () => {
      const result = escapeXmlAttr('foo < bar');
      expect(result).toBe('foo &lt; bar');
    });

    it('should escape greater than (>) to &gt;', () => {
      const result = escapeXmlAttr('foo > bar');
      expect(result).toBe('foo &gt; bar');
    });

    it('should escape multiple special characters in one string', () => {
      const result = escapeXmlAttr('Title with <tags> & "quotes"');
      expect(result).toBe('Title with &lt;tags&gt; &amp; &quot;quotes&quot;');
    });

    it('should handle URL with query parameters containing ampersands', () => {
      const result = escapeXmlAttr('https://example.com?foo=bar&baz=qux');
      expect(result).toBe('https://example.com?foo=bar&amp;baz=qux');
    });

    it('should return original string when no special characters present', () => {
      const result = escapeXmlAttr('Simple text without special chars');
      expect(result).toBe('Simple text without special chars');
    });
  });

  describe('multiple occurrences', () => {
    it('should escape multiple ampersands', () => {
      const result = escapeXmlAttr('foo & bar & baz & qux');
      expect(result).toBe('foo &amp; bar &amp; baz &amp; qux');
    });

    it('should escape multiple quotes', () => {
      const result = escapeXmlAttr('"foo" "bar" "baz"');
      expect(result).toBe('&quot;foo&quot; &quot;bar&quot; &quot;baz&quot;');
    });

    it('should escape multiple angle brackets', () => {
      const result = escapeXmlAttr('<tag1> <tag2> <tag3>');
      expect(result).toBe('&lt;tag1&gt; &lt;tag2&gt; &lt;tag3&gt;');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for null input', () => {
      const result = escapeXmlAttr(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = escapeXmlAttr(undefined);
      expect(result).toBe('');
    });

    it('should return empty string for empty string input', () => {
      const result = escapeXmlAttr('');
      expect(result).toBe('');
    });

    it('should handle string with only special characters', () => {
      const result = escapeXmlAttr('&<>"');
      expect(result).toBe('&amp;&lt;&gt;&quot;');
    });

    it('should handle strings with whitespace', () => {
      const result = escapeXmlAttr('  foo & bar  ');
      expect(result).toBe('  foo &amp; bar  ');
    });

    it('should handle newlines and tabs', () => {
      const result = escapeXmlAttr('foo\nbar\tbaz');
      expect(result).toBe('foo\nbar\tbaz');
    });
  });

  describe('order of replacement', () => {
    it('should replace ampersand first to avoid double-escaping entities', () => {
      const result = escapeXmlAttr('&lt;');
      expect(result).toBe('&amp;lt;');
    });

    it('should correctly escape pre-escaped entities', () => {
      const result = escapeXmlAttr('&amp; &quot; &lt; &gt;');
      expect(result).toBe('&amp;amp; &amp;quot; &amp;lt; &amp;gt;');
    });
  });

  describe('security scenarios', () => {
    it('should prevent XML injection via attributes', () => {
      const maliciousInput = '" onclick="alert(\'XSS\')"';
      const result = escapeXmlAttr(maliciousInput);
      expect(result).toBe("&quot; onclick=&quot;alert('XSS')&quot;");
      expect(result).not.toContain('"');
    });

    it('should escape HTML-like content in attributes', () => {
      const result = escapeXmlAttr('<script>alert("XSS")</script>');
      expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    it('should handle CDATA-like strings', () => {
      const result = escapeXmlAttr('<![CDATA[some data]]>');
      expect(result).toBe('&lt;![CDATA[some data]]&gt;');
    });
  });
});

describe('escapeXmlContent', () => {
  describe('normal cases', () => {
    it('should escape ampersand (&) to &amp;', () => {
      const result = escapeXmlContent('foo & bar');
      expect(result).toBe('foo &amp; bar');
    });

    it('should escape less than (<) to &lt;', () => {
      const result = escapeXmlContent('foo < bar');
      expect(result).toBe('foo &lt; bar');
    });

    it('should escape greater than (>) to &gt;', () => {
      const result = escapeXmlContent('foo > bar');
      expect(result).toBe('foo &gt; bar');
    });

    it('should NOT escape double quotes in content', () => {
      const result = escapeXmlContent('foo "bar" baz');
      expect(result).toBe('foo "bar" baz');
    });

    it('should escape multiple special characters', () => {
      const result = escapeXmlContent('Content with <html> & special chars');
      expect(result).toBe('Content with &lt;html&gt; &amp; special chars');
    });

    it('should return original string when no special characters present', () => {
      const result = escapeXmlContent('Simple text without special chars');
      expect(result).toBe('Simple text without special chars');
    });
  });

  describe('multiple occurrences', () => {
    it('should escape multiple ampersands', () => {
      const result = escapeXmlContent('foo & bar & baz & qux');
      expect(result).toBe('foo &amp; bar &amp; baz &amp; qux');
    });

    it('should escape multiple angle brackets', () => {
      const result = escapeXmlContent('<tag1> <tag2> <tag3>');
      expect(result).toBe('&lt;tag1&gt; &lt;tag2&gt; &lt;tag3&gt;');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for null input', () => {
      const result = escapeXmlContent(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = escapeXmlContent(undefined);
      expect(result).toBe('');
    });

    it('should return empty string for empty string input', () => {
      const result = escapeXmlContent('');
      expect(result).toBe('');
    });

    it('should handle string with only special characters', () => {
      const result = escapeXmlContent('&<>');
      expect(result).toBe('&amp;&lt;&gt;');
    });

    it('should preserve quotes in content', () => {
      const result = escapeXmlContent('She said "Hello" to me');
      expect(result).toBe('She said "Hello" to me');
    });

    it('should handle strings with whitespace', () => {
      const result = escapeXmlContent('  foo & bar  ');
      expect(result).toBe('  foo &amp; bar  ');
    });

    it('should handle newlines and tabs', () => {
      const result = escapeXmlContent('foo\nbar\tbaz');
      expect(result).toBe('foo\nbar\tbaz');
    });
  });

  describe('order of replacement', () => {
    it('should replace ampersand first to avoid double-escaping entities', () => {
      const result = escapeXmlContent('&lt;');
      expect(result).toBe('&amp;lt;');
    });

    it('should correctly escape pre-escaped entities', () => {
      const result = escapeXmlContent('&amp; &lt; &gt;');
      expect(result).toBe('&amp;amp; &amp;lt; &amp;gt;');
    });
  });

  describe('security scenarios', () => {
    it('should prevent XML injection via content', () => {
      const maliciousInput = '</item><item>Injected content</item><item>';
      const result = escapeXmlContent(maliciousInput);
      expect(result).toBe('&lt;/item&gt;&lt;item&gt;Injected content&lt;/item&gt;&lt;item&gt;');
      expect(result).not.toContain('<item>');
    });

    it('should escape HTML-like content', () => {
      const result = escapeXmlContent('<script>alert("XSS")</script>');
      expect(result).toBe('&lt;script&gt;alert("XSS")&lt;/script&gt;');
    });

    it('should handle CDATA-like strings', () => {
      const result = escapeXmlContent('<![CDATA[some data]]>');
      expect(result).toBe('&lt;![CDATA[some data]]&gt;');
    });

    it('should prevent comment injection', () => {
      const result = escapeXmlContent('<!-- malicious comment -->');
      expect(result).toBe('&lt;!-- malicious comment --&gt;');
    });
  });

  describe('real-world content examples', () => {
    it('should handle markdown-like content', () => {
      const result = escapeXmlContent('Use <code> tags for inline code & **bold** text');
      expect(result).toBe('Use &lt;code&gt; tags for inline code &amp; **bold** text');
    });

    it('should handle code snippets with comparison operators', () => {
      const result = escapeXmlContent('if (x < 10 && y > 5) { return true; }');
      expect(result).toBe('if (x &lt; 10 &amp;&amp; y &gt; 5) { return true; }');
    });

    it('should handle natural language with comparisons', () => {
      const result = escapeXmlContent('Price is > $100 & < $200');
      expect(result).toBe('Price is &gt; $100 &amp; &lt; $200');
    });
  });
});

describe('escapeXmlAttr vs escapeXmlContent', () => {
  it('should differ in quote handling: attr escapes quotes, content does not', () => {
    const input = 'Text with "quotes"';
    const attrResult = escapeXmlAttr(input);
    const contentResult = escapeXmlContent(input);

    expect(attrResult).toBe('Text with &quot;quotes&quot;');
    expect(contentResult).toBe('Text with "quotes"');
  });

  it('should handle same input with ampersands and angles identically', () => {
    const input = 'foo & bar < baz > qux';
    const attrResult = escapeXmlAttr(input);
    const contentResult = escapeXmlContent(input);

    expect(attrResult).toBe('foo &amp; bar &lt; baz &gt; qux');
    expect(contentResult).toBe('foo &amp; bar &lt; baz &gt; qux');
  });

  it('should both handle null/undefined gracefully', () => {
    expect(escapeXmlAttr(null)).toBe('');
    expect(escapeXmlContent(null)).toBe('');
    expect(escapeXmlAttr(undefined)).toBe('');
    expect(escapeXmlContent(undefined)).toBe('');
  });
});
