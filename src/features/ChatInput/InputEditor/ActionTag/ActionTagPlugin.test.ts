import { AGENT_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import {
  INLINE_ACTION_TAG_REGEX,
  isInCodeContext,
  resolveActionTagFromMatch,
} from './ActionTagPlugin';

// Minimal Lexical-node stand-in for isInCodeContext, which only reads
// hasFormat / getType / getParent.
const makeNode = (opts: { format?: boolean; parent?: any; type?: string }): any => ({
  getParent: () => opts.parent ?? null,
  getType: () => opts.type ?? 'text',
  hasFormat: (f: string) => f === 'code' && !!opts.format,
});

describe('INLINE_ACTION_TAG_REGEX', () => {
  it('matches the tag a user typed, with trailing text (the regression case)', () => {
    const text = '<skill name="ux-audit" label="ux-audit" />  搞 LOBE-11218';
    const match = INLINE_ACTION_TAG_REGEX.exec(text);

    expect(match).not.toBeNull();
    expect(match!.index).toBe(0);
    expect(match![0]).toBe('<skill name="ux-audit" label="ux-audit" />');
    expect(match![1]).toBe('skill');
  });

  it('matches a tag sitting after leading text', () => {
    const match = INLINE_ACTION_TAG_REGEX.exec('run <tool name="search" label="Search" /> now');
    expect(match!.index).toBe(4);
    expect(match![1]).toBe('tool');
  });

  it('tolerates no space before the self-close and mixed casing', () => {
    expect(INLINE_ACTION_TAG_REGEX.exec('<Skill name="a" label="a"/>')?.[1]).toBe('Skill');
  });

  it('does not match an unterminated / partial tag while still typing', () => {
    expect(INLINE_ACTION_TAG_REGEX.exec('<skill name="ux-audit"')).toBeNull();
  });

  it('ignores unrelated tags', () => {
    expect(INLINE_ACTION_TAG_REGEX.exec('<div name="x" />')).toBeNull();
  });
});

describe('resolveActionTagFromMatch', () => {
  it('resolves a plain skill tag', () => {
    expect(resolveActionTagFromMatch('skill', ' name="ux-audit" label="ux-audit" ')).toMatchObject({
      actionCategory: 'skill',
      actionLabel: 'ux-audit',
      actionType: 'ux-audit',
    });
  });

  it('recovers the agentSkill category from the identifier prefix', () => {
    const attrs = ` name="${AGENT_SKILLS_IDENTIFIER_PREFIX}my-doc" label="My Doc" `;
    expect(resolveActionTagFromMatch('skill', attrs)).toMatchObject({
      actionCategory: 'agentSkill',
      actionLabel: 'My Doc',
    });
  });

  it('resolves tool and projectSkill tags', () => {
    expect(resolveActionTagFromMatch('tool', ' name="search" label="Search" ')).toMatchObject({
      actionCategory: 'tool',
      actionType: 'search',
    });
    expect(
      resolveActionTagFromMatch('projectSkill', ' name="ux-audit" label="UX Audit" '),
    ).toMatchObject({ actionCategory: 'projectSkill', actionType: 'ux-audit' });
  });

  it('resolves a legacy <action> tag with an explicit category', () => {
    expect(
      resolveActionTagFromMatch('action', ' type="newTopic" category="command" label="New Topic" '),
    ).toMatchObject({
      actionCategory: 'command',
      actionLabel: 'New Topic',
      actionType: 'newTopic',
    });
  });

  it('returns null for an unknown tag name', () => {
    expect(resolveActionTagFromMatch('div', ' name="x" ')).toBeNull();
  });

  it('handles single-quoted attribute values', () => {
    expect(resolveActionTagFromMatch('skill', " name='a' label='B' ")).toMatchObject({
      actionType: 'a',
      actionLabel: 'B',
    });
  });
});

describe('isInCodeContext', () => {
  it('is false for a plain text node in a paragraph', () => {
    expect(isInCodeContext(makeNode({ parent: makeNode({ type: 'paragraph' }) }))).toBe(false);
  });

  it('is true for an inline-code formatted text node', () => {
    expect(isInCodeContext(makeNode({ format: true }))).toBe(true);
  });

  it('is true for a highlighted code token node', () => {
    expect(isInCodeContext(makeNode({ type: 'code-highlight' }))).toBe(true);
  });

  it('is true for text wrapped in an inline-code (codeInline) element', () => {
    expect(isInCodeContext(makeNode({ parent: makeNode({ type: 'codeInline' }) }))).toBe(true);
  });

  it('is true for text nested inside a code block', () => {
    const codeBlock = makeNode({ type: 'code' });
    const inner = makeNode({ parent: codeBlock, type: 'paragraph' });
    expect(isInCodeContext(makeNode({ parent: inner }))).toBe(true);
  });
});
