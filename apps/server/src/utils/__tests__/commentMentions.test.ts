import { describe, expect, it } from 'vitest';

import {
  extractCommentMentionedUserIds,
  extractMarkdownMentionedUserIds,
  extractMentionedUserIds,
} from '../commentMentions';

const mention = (id: unknown, type = 'member') => ({
  label: 'Alex',
  metadata: { id, type },
  type: 'mention',
});

describe('extractMentionedUserIds', () => {
  it('returns member mention ids from nested editor nodes, deduplicated', () => {
    const editorData = {
      root: {
        children: [
          { children: [{ text: 'hi ' }, mention('user-1')], type: 'paragraph' },
          { children: [mention('user-2'), mention('user-1')], type: 'paragraph' },
        ],
      },
    };

    expect(extractMentionedUserIds(editorData)).toEqual(['user-1', 'user-2']);
  });

  it('ignores non-member mentions, empty ids and malformed input', () => {
    const editorData = {
      root: {
        children: [mention('agent-1', 'agent'), mention(''), mention(42), { type: 'text' }, null],
      },
    };

    expect(extractMentionedUserIds(editorData)).toEqual([]);
    expect(extractMentionedUserIds(undefined)).toEqual([]);
    expect(extractMentionedUserIds('not-json')).toEqual([]);
    expect(extractMentionedUserIds({ root: null })).toEqual([]);
  });
});

describe('extractMarkdownMentionedUserIds', () => {
  it('returns ids from serialized mention tags, deduplicated', () => {
    const content =
      'Hi <mention name="Arvin" id="user-1" />, cc <mention id="user-2" name="Lin"/> and <mention name="Arvin" id="user-1" />';

    expect(extractMarkdownMentionedUserIds(content)).toEqual(['user-1', 'user-2']);
  });

  it('ignores plain @names, tags without an id and non-string input', () => {
    expect(extractMarkdownMentionedUserIds('@Arvin please review')).toEqual([]);
    expect(extractMarkdownMentionedUserIds('<mention name="Arvin" />')).toEqual([]);
    expect(extractMarkdownMentionedUserIds('<mention name="A" data-id="user-1" />')).toEqual([]);
    expect(extractMarkdownMentionedUserIds('<mention name="A" id="user-1">')).toEqual([]);
    expect(extractMarkdownMentionedUserIds(undefined)).toEqual([]);
  });

  it('accepts unquoted ids, as left by shell quoting of `lh task comment -m "…"`', () => {
    // What the CLI receives for: -m "<mention name="Arvin" id="user_1" /> done"
    expect(extractMarkdownMentionedUserIds('<mention name=Arvin id=user_1 /> done')).toEqual([
      'user_1',
    ]);
  });

  it('accepts single-quoted ids and skips tags quoted in code', () => {
    const content = [
      "Hi <mention name='Arvin' id='user-1' />",
      'Syntax: `<mention name="X" id="user-2" />`',
      '```',
      '<mention name="Y" id="user-3" />',
      '```',
      '~~~',
      '<mention name="Z" id="user-4" />',
      '~~~',
      '',
      '    <mention name="W" id="user-5" />',
    ].join('\n');

    expect(extractMarkdownMentionedUserIds(content)).toEqual(['user-1']);
  });
});

describe('extractCommentMentionedUserIds', () => {
  it('prefers the rich-text snapshot and falls back to markdown tags', () => {
    const content = '<mention name="B" id="user-2" />';
    const editorData = { root: { children: [mention('user-1')] } };

    expect(extractCommentMentionedUserIds({ content, editorData })).toEqual(['user-1']);
    expect(extractCommentMentionedUserIds({ content, editorData: null })).toEqual(['user-2']);
  });
});
