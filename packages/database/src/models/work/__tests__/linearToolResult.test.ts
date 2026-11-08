// @vitest-environment node
import type { SkillToolResultWorkInput } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { WORK_DESCRIPTION_PREVIEW_LENGTH } from '../internal';
import { normalizeLinearToolResult } from '../linearToolResult';

type Extra = Partial<Omit<SkillToolResultWorkInput, 'data'>>;

const issue = (data: unknown, extra: Extra = {}) =>
  normalizeLinearToolResult({ data, toolName: 'save_issue', ...extra });

const document = (data: unknown) =>
  normalizeLinearToolResult({ data, toolName: 'create_document' });

describe('normalizeLinearToolResult · payload unwrapping', () => {
  it('unwraps an array payload through its first entry', () => {
    const operation = issue([{ id: 'issue-uuid-1', title: 'From an array' }]);

    expect(operation?.type).toBe('register');
    expect(operation?.params.resourceId).toBe('issue-uuid-1');
    expect(operation?.params.resourceType).toBe('linear_issue');
    expect(operation?.params.title).toBe('From an array');
  });

  it('returns null when the array holds no record', () => {
    expect(issue([42])).toBeNull();
  });

  it('returns null for a scalar payload that is not a record', () => {
    expect(issue('plain text result')).toBeNull();
  });

  it('returns null for an empty payload on both entity paths', () => {
    expect(issue(null)).toBeNull();
    expect(document(null)).toBeNull();
  });

  it('returns null when the unwrapped record carries no identity field', () => {
    expect(issue({ title: 'Identity missing' })).toBeNull();
  });

  it('unwraps a document payload nested under `document`', () => {
    const operation = document({ document: { id: 'doc-uuid-1', slug: 'my-doc', title: 'Doc' } });

    expect(operation?.params.resourceId).toBe('doc-uuid-1');
    expect(operation?.params.resourceType).toBe('linear_document');
    expect(operation?.params.identifier).toBe('my-doc');
  });
});

describe('normalizeLinearToolResult · identifier resolution', () => {
  it('uses the record id when it already looks like an issue identifier', () => {
    const operation = issue({ id: 'ENG-123', title: 'Looks like a key' });

    expect(operation?.params.identifier).toBe('ENG-123');
    expect(operation?.params.patchFields).toContain('identifier');
  });

  it('falls back to the issue segment of the url', () => {
    const operation = issue({
      id: 'issue-uuid-2',
      title: 'From url',
      url: 'https://linear.app/acme/issue/ENG-42',
    });

    expect(operation?.params.identifier).toBe('ENG-42');
  });

  it('resolves no identifier when the url carries no issue segment', () => {
    const operation = issue({
      id: 'issue-uuid-3',
      title: 'No segment',
      url: 'https://linear.app/acme/profile',
    });

    expect(operation?.params.identifier).toBeNull();
  });

  it('resolves no identifier when the issue segment is the last path element', () => {
    const operation = issue({
      id: 'issue-uuid-4',
      title: 'Dangling segment',
      url: 'https://linear.app/acme/issue',
    });

    expect(operation?.params.identifier).toBeNull();
  });

  it('resolves no identifier when the url cannot be parsed', () => {
    const operation = issue({ id: 'issue-uuid-5', title: 'Broken url', url: 'not-a-url' });

    expect(operation?.params.identifier).toBeNull();
    expect(operation?.params.url).toBeUndefined();
  });

  it('falls back to the document segment of the url when the record has no slug', () => {
    const operation = document({
      document: {
        id: 'doc-uuid-2',
        title: 'Doc from url',
        url: 'https://linear.app/acme/document/my-doc',
      },
    });

    expect(operation?.params.identifier).toBe('my-doc');
  });
});

describe('normalizeLinearToolResult · text fields', () => {
  it('caps the card preview while keeping the full body in content', () => {
    const long = 'x'.repeat(WORK_DESCRIPTION_PREVIEW_LENGTH + 30);
    const operation = issue({ description: long, id: 'issue-uuid-6', title: 'Long body' });

    expect(operation?.params.description).toBe(`${'x'.repeat(WORK_DESCRIPTION_PREVIEW_LENGTH)}...`);
    expect(operation?.params.content).toBe(long);
  });

  it('drops a blank description but still records the patch field', () => {
    const operation = issue({ description: '', id: 'issue-uuid-7', title: 'Blank body' });

    expect(operation?.params.description).toBeNull();
    expect(operation?.params.patchFields).toContain('description');
  });

  it('carries an explicit null field through as a null patch', () => {
    const operation = issue({ content: null, id: 'issue-uuid-8', title: null });

    expect(operation?.params.title).toBeNull();
    expect(operation?.params.content).toBeNull();
    expect(operation?.params.patchFields).toContain('title');
    expect(operation?.params.patchFields).toContain('content');
  });

  it('drops a blank string status instead of persisting an empty value', () => {
    const operation = issue({ id: 'issue-uuid-9', status: '', title: 'Blank status' });

    expect(operation?.params.status).toBeNull();
  });

  it('reads the status from a nested state object', () => {
    const operation = issue({
      id: 'issue-uuid-10',
      state: { name: 'In Progress' },
      title: 'Nested state',
    });

    expect(operation?.params.status).toBe('In Progress');
  });
});
