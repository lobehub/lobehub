import { describe, expect, it } from 'vitest';

import { buildLinearRenderModel, isUuidLike } from './utils';

describe('isUuidLike', () => {
  it('matches bare UUIDs but not human Linear ids', () => {
    expect(isUuidLike('55a0597c-be21-4e73-a1ff-1a45aedf0184')).toBe(true);
    expect(isUuidLike('LIN-123')).toBe(false);
    expect(isUuidLike('TEST-456')).toBe(false);
    expect(isUuidLike('Engineering')).toBe(false);
  });
});

describe('buildLinearRenderModel', () => {
  it('summarizes Linear update issue input and result without exposing raw JSON first', () => {
    const model = buildLinearRenderModel({
      apiName: 'save_issue',
      args: {
        id: 'TEST-123',
        links: [
          {
            title: 'PR #1: mock pull request',
            url: 'https://github.com/acme/repo/pull/1',
          },
        ],
        state: 'In Review',
      },
      content: JSON.stringify({
        description: '## Background\n\nMock issue description body.',
        id: 'TEST-123',
        links: [
          {
            title: 'PR #1: mock pull request',
            url: 'https://github.com/acme/repo/pull/1',
          },
        ],
        state: { name: 'In Review' },
        title: 'Mock issue title',
        url: 'https://linear.app/acme/issue/TEST-123',
      }),
    });

    expect(model.actionLabel).toBe('Save issue');
    expect(model.requestFields).toEqual([
      { key: 'id', label: 'ID', value: 'TEST-123' },
      { key: 'state', label: 'State', value: 'In Review' },
    ]);
    expect(model.requestLinks).toHaveLength(1);
    expect(model.resultEntities).toHaveLength(1);
    expect(model.resultEntities[0]).toMatchObject({
      description: '## Background\n\nMock issue description body.',
      id: 'TEST-123',
      state: 'In Review',
      title: 'Mock issue title',
      url: 'https://linear.app/acme/issue/TEST-123',
    });
    expect(model.rawResultJson).toBeUndefined();
  });

  it('normalizes Codex Apps entity-prefixed ids in request fields', () => {
    const model = buildLinearRenderModel({
      apiName: 'get_issue',
      args: { id: 'issue:TEST-123' },
      content: '{"title":"Mock issue title"}',
    });

    expect(model.requestFields).toContainEqual({ key: 'id', label: 'ID', value: 'TEST-123' });
    expect(model.resultEntities[0]).toMatchObject({ title: 'Mock issue title' });
  });

  it('renders a get_issue entity even when it embeds empty sub-collections', () => {
    const model = buildLinearRenderModel({
      apiName: 'mcp__claude_ai_Linear__get_issue',
      args: { id: 'TEST-456' },
      content: JSON.stringify({
        assignee: 'Mock User',
        attachments: [],
        createdAt: '2024-01-02T03:04:05.000Z',
        description: '## Mock description',
        documents: [],
        id: 'TEST-456',
        labels: [],
        parentId: 'TEST-400',
        priority: { name: 'Medium', value: 3 },
        project: 'Mock Project',
        status: 'Backlog',
        team: 'Mock Team',
        title: 'Mock issue title',
        updatedAt: '2024-01-02T03:04:05.000Z',
        url: 'https://linear.app/acme/issue/TEST-456',
      }),
    });

    expect(model.rawResultJson).toBeUndefined();
    expect(model.resultEntities).toHaveLength(1);
    const [entity] = model.resultEntities;
    expect(entity).toMatchObject({
      description: '## Mock description',
      id: 'TEST-456',
      state: 'Backlog',
      title: 'Mock issue title',
      url: 'https://linear.app/acme/issue/TEST-456',
    });
    // `status` is surfaced via the state tag, so it should not duplicate as a field.
    expect(entity.fields.find((field) => field.key === 'status')).toBeUndefined();
    // updatedAt is pulled out of the field grid and kept as raw ISO for the
    // header's relative-time rendering; createdAt is dropped entirely.
    expect(entity.updatedAt).toBe('2024-01-02T03:04:05.000Z');
    expect(entity.fields.find((field) => field.key === 'createdAt')).toBeUndefined();
    expect(entity.fields.find((field) => field.key === 'updatedAt')).toBeUndefined();
    expect(entity.fields).toContainEqual({ key: 'priority', label: 'Priority', value: 'Medium' });
  });

  it('keeps a comment entity titleless (UUID id stays a tag, not the title) with dated fields', () => {
    const model = buildLinearRenderModel({
      apiName: 'mcp__claude_ai_Linear__create_comment',
      args: { issueId: 'TEST-456' },
      content: JSON.stringify({
        body: '## Mock comment body',
        createdAt: '2024-01-02T03:04:05.080Z',
        id: 'ff0dabda-eb1f-4dfe-b525-09114c0d6bd0',
        updatedAt: '2024-01-02T03:04:05.038Z',
      }),
    });

    expect(model.resultEntities).toHaveLength(1);
    const [entity] = model.resultEntities;
    // No human title — the render must not promote the UUID id to the title.
    // The titleless UUID id is retained (it's the card's only handle / link target).
    expect(entity.title).toBeUndefined();
    expect(entity.id).toBe('ff0dabda-eb1f-4dfe-b525-09114c0d6bd0');
    expect(entity.description).toBe('## Mock comment body');
    expect(entity.updatedAt).toBe('2024-01-02T03:04:05.038Z');
  });

  it('still unwraps list_* payloads from their nested collection', () => {
    const model = buildLinearRenderModel({
      apiName: 'list_issues',
      args: {},
      content: JSON.stringify({
        issues: [
          { id: 'TEST-1', title: 'First mock issue' },
          { id: 'TEST-2', title: 'Second mock issue' },
        ],
      }),
    });

    expect(model.resultEntities).toHaveLength(2);
    expect(model.resultEntities.map((entity) => entity.id)).toEqual(['TEST-1', 'TEST-2']);
  });

  it('unwraps search-style { results: [...] } wrappers into cards (Codex bare `search`)', () => {
    // Codex routes Linear search through a bare `search` apiName → parses to
    // `verb: 'other'`, so the unwrap must be driven by the wrapper shape, not the verb.
    const model = buildLinearRenderModel({
      apiName: 'search',
      args: { query: 'mock query' },
      content: JSON.stringify({
        results: [
          { id: 'TEST-1', title: 'First match', url: 'https://linear.app/acme/issue/TEST-1' },
          { id: 'TEST-2', title: 'Second match', url: 'https://linear.app/acme/issue/TEST-2' },
        ],
      }),
    });

    expect(model.rawResultJson).toBeUndefined();
    expect(model.resultEntities).toHaveLength(2);
    expect(model.resultEntities.map((entity) => entity.id)).toEqual(['TEST-1', 'TEST-2']);
  });

  it('keeps a single fetched entity intact even when it embeds a populated sub-collection', () => {
    // A project (fetch-one) carries its own id/title AND a nested `issues` array;
    // the entity must win over its sub-collection.
    const model = buildLinearRenderModel({
      apiName: 'get_project',
      args: { id: 'PRJ-1' },
      content: JSON.stringify({
        id: 'PRJ-1',
        issues: [{ id: 'TEST-1', title: 'Child issue' }],
        name: 'Mock Project',
        url: 'https://linear.app/acme/project/PRJ-1',
      }),
    });

    expect(model.resultEntities).toHaveLength(1);
    expect(model.resultEntities[0]).toMatchObject({ id: 'PRJ-1', title: 'Mock Project' });
  });

  it('keeps non-JSON result text as a readable fallback', () => {
    const model = buildLinearRenderModel({
      apiName: 'search',
      args: { query: 'mock query' },
      content: 'No matching Linear issues found.',
    });

    expect(model.resultText).toBe('No matching Linear issues found.');
  });
});
