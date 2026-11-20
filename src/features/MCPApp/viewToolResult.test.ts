import { describe, expect, it } from 'vitest';

import { withoutStoredMedia } from './viewToolResult';

const text = { text: 'sunny', type: 'text' as const };

describe('withoutStoredMedia', () => {
  it('leaves out media the chat stored as a reference, without reading it', () => {
    const result = withoutStoredMedia({
      content: [
        text,
        { data: 'https://files.example.com/a.png', mimeType: 'image/png', type: 'image' },
        { data: 'desktop://mcp/audio/2026/a.mp3', mimeType: 'audio/mpeg', type: 'audio' },
        // A server's own reference to an authenticated endpoint is never followed
        { data: '/trpc/lambda/user.getUserState', mimeType: 'image/png', type: 'image' },
      ],
    });

    expect(result.content).toEqual([text]);
  });

  it('keeps media that is base64, as MCP defines it', () => {
    const image = { data: 'aGk=', mimeType: 'image/png', type: 'image' as const };

    expect(withoutStoredMedia({ content: [text, image] }).content).toEqual([text, image]);
  });
});
