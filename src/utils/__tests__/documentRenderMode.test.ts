import { describe, expect, it } from 'vitest';

import { getDocumentRenderMode } from '../documentRenderMode';

describe('getDocumentRenderMode', () => {
  it('returns editor for SKILL.md skill index', () => {
    expect(getDocumentRenderMode({ fileType: 'skills/index', title: 'SKILL.md' })).toEqual({
      mode: 'editor',
    });
  });

  it('returns editor when filename ends with .md', () => {
    expect(getDocumentRenderMode({ filename: 'note.md', title: 'note' })).toEqual({
      mode: 'editor',
    });
  });

  it('returns editor when filename ends with .mdx', () => {
    expect(getDocumentRenderMode({ filename: 'note.mdx', title: 'note' })).toEqual({
      mode: 'editor',
    });
  });

  it('returns highlight with detected language for known code filenames', () => {
    expect(getDocumentRenderMode({ filename: 'topic_call.txt', title: 'topic_call' })).toEqual({
      language: 'txt',
      mode: 'highlight',
    });
    expect(getDocumentRenderMode({ filename: 'config.json', title: 'config' })).toEqual({
      language: 'json',
      mode: 'highlight',
    });
  });

  it('returns editor when filename is missing (notebook markdown document)', () => {
    expect(
      getDocumentRenderMode({ fileType: 'markdown', filename: null, title: 'Meeting notes' }),
    ).toEqual({ mode: 'editor' });
  });

  it('returns editor when filename is missing regardless of title extension shape', () => {
    expect(getDocumentRenderMode({ fileType: 'note', title: 'plans.draft' })).toEqual({
      mode: 'editor',
    });
    expect(getDocumentRenderMode({ fileType: 'agent/plan', title: 'Untitled' })).toEqual({
      mode: 'editor',
    });
  });
});
