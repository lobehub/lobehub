import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_FILE_TYPE,
  AGENT_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
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

  it('returns editor for agent document metadata even when filename has no extension', () => {
    expect(
      getDocumentRenderMode({
        fileType: AGENT_DOCUMENT_FILE_TYPE,
        filename: 'workflow-note',
        sourceType: AGENT_DOCUMENT_SOURCE_TYPE,
        title: 'workflow-note',
      }),
    ).toEqual({ mode: 'editor' });
  });

  it('returns editor for derived document category', () => {
    expect(
      getDocumentRenderMode({
        category: AGENT_DOCUMENT_CATEGORY,
        filename: 'draft',
        title: 'draft',
      }),
    ).toEqual({ mode: 'editor' });
  });

  it('returns highlight for agent document metadata with explicit code filename', () => {
    expect(
      getDocumentRenderMode({
        fileType: AGENT_DOCUMENT_FILE_TYPE,
        filename: 'config.json',
        sourceType: AGENT_DOCUMENT_SOURCE_TYPE,
        title: 'config',
      }),
    ).toEqual({
      language: 'json',
      mode: 'highlight',
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
