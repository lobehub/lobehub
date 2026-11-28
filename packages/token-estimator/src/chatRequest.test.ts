import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { estimateChatRequestInputTokens } from './chatRequest';
import { VISUAL_INPUT_TOKEN_ESTIMATE } from './media';

describe('estimateChatRequestInputTokens', () => {
  it('returns zero for an empty request', () => {
    expect(estimateChatRequestInputTokens([])).toMatchObject({
      audioCount: 0,
      imageCount: 0,
      totalTokens: 0,
      videoCount: 0,
    });
  });

  it('counts media by item, never by their base64 URL text', () => {
    const result = estimateChatRequestInputTokens([
      {
        content: [
          { text: 'describe these', type: 'text' },
          { image_url: { url: `data:image/png;base64,${'A'.repeat(100_000)}` }, type: 'image_url' },
          { type: 'video_url', video_url: { url: 'https://example.com/a.mp4' } },
          { audio_url: { url: 'https://example.com/a.mp3' }, type: 'audio_url' },
        ],
        role: 'user',
      },
    ]);

    expect(result.textTokens).toBe(
      estimateTokenCount('user') + estimateTokenCount('describe these'),
    );
    expect(result).toMatchObject({
      audioCount: 1,
      imageCount: 1,
      imageTokens: VISUAL_INPUT_TOKEN_ESTIMATE,
      videoCount: 1,
      videoTokens: VISUAL_INPUT_TOKEN_ESTIMATE,
    });
    expect(result.totalTokens).toBe(
      result.textTokens + result.imageTokens + result.videoTokens + result.audioTokens,
    );
  });

  it('counts tool definitions, tool calls and reasoning as text', () => {
    const tools = [{ function: { name: 'search', parameters: {} }, type: 'function' }];
    const toolCalls = [{ function: { arguments: '{}', name: 'search' }, id: 'call_1' }];
    const result = estimateChatRequestInputTokens(
      [
        {
          content: 'ok',
          reasoning: { content: 'thinking hard' },
          role: 'assistant',
          tool_calls: toolCalls,
        },
      ],
      { tools },
    );

    expect(result.textTokens).toBe(
      estimateTokenCount('assistant') +
        estimateTokenCount(JSON.stringify(toolCalls)) +
        estimateTokenCount('thinking hard') +
        estimateTokenCount('ok') +
        estimateTokenCount(JSON.stringify(tools)),
    );
  });

  it('tolerates an audio part without its payload', () => {
    const result = estimateChatRequestInputTokens([
      { content: [{ type: 'audio_url' }], role: 'user' },
    ]);

    expect(result.audioCount).toBe(1);
    expect(result.audioTokens).toBeGreaterThan(0);
  });
});
