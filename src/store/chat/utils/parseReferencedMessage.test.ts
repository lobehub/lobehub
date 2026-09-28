import { describe, expect, it } from 'vitest';

import { cleanBotPromptTags, splitReferencedMessage } from './parseReferencedMessage';

describe('splitReferencedMessage', () => {
  it('returns the content untouched when there is no referenced block', () => {
    expect(splitReferencedMessage('hello')).toEqual({ body: 'hello' });
  });

  it('splits a plain Discord-style referenced block from the user text', () => {
    expect(
      splitReferencedMessage(
        '<referenced_message sender="Bob">@Lobo 帮 @Shadow Arvin 查一下明天的天气</referenced_message>\n你怎么看',
      ),
    ).toEqual({
      body: '你怎么看',
      reference: { sender: 'Bob', text: '@Lobo 帮 @Shadow Arvin 查一下明天的天气' },
    });
  });

  it('parses Telegram full message + selected quote', () => {
    expect(
      splitReferencedMessage(
        '<referenced_message sender="Dana"><full_message>full original</full_message>\n<selected_quote>fragment</selected_quote></referenced_message>\nreply',
      ),
    ).toEqual({
      body: 'reply',
      reference: { selectedQuote: 'fragment', sender: 'Dana', text: 'full original' },
    });
  });

  it('parses a selected quote without a full message', () => {
    expect(
      splitReferencedMessage(
        '<referenced_message sender="unknown"><selected_quote>fragment</selected_quote></referenced_message>\nreply',
      ),
    ).toEqual({
      body: 'reply',
      reference: { selectedQuote: 'fragment', sender: 'unknown', text: undefined },
    });
  });

  it('keeps multi-line quoted text and does not swallow the body', () => {
    const { body, reference } = splitReferencedMessage(
      '<referenced_message sender="A">line1\nline2</referenced_message>\nmine </referenced_message> still mine',
    );
    expect(reference).toEqual({ sender: 'A', text: 'line1\nline2' });
    expect(body).toBe('mine </referenced_message> still mine');
  });

  it('ignores a referenced block that is not at the start', () => {
    const content = 'hi <referenced_message sender="A">x</referenced_message>';
    expect(splitReferencedMessage(content)).toEqual({ body: content });
  });
});

describe('cleanBotPromptTags', () => {
  it('removes both the speaker tag and the referenced block', () => {
    expect(
      cleanBotPromptTags(
        '<speaker id="1" username="u" nickname="n" />\n<referenced_message sender="Bob">q</referenced_message>\n你怎么看',
      ),
    ).toBe('你怎么看');
  });

  it('leaves ordinary content alone', () => {
    expect(cleanBotPromptTags('plain')).toBe('plain');
  });
});
