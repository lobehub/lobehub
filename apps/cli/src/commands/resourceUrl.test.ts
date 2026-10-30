import { describe, expect, it, vi } from 'vitest';

import {
  resolveUrlBuilder,
  resourcePath,
  searchResultPath,
  withUrl,
  withUrls,
} from './resourceUrl';

vi.mock('../api/workspace', () => ({ resolveWorkspaceId: () => 'ws-1' }));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));

const clientWith = (query: () => Promise<unknown>) =>
  ({ workspace: { getById: { query } } }) as any;

describe('resourcePath', () => {
  it.each([
    [resourcePath.agent('agt_1'), '/agent/agt_1'],
    [resourcePath.topic({ agentId: 'agt_1', id: 'tpc_1' }), '/agent/agt_1/tpc_1'],
    [resourcePath.topic({ groupId: 'grp_1', id: 'tpc_1' }), '/group/grp_1/tpc_1'],
    [
      resourcePath.message({ agentId: 'agt_1', id: 'msg_1', topicId: 'tpc_1' }),
      '/agent/agt_1/tpc_1#msg_1',
    ],
    // Group-chat hits carry `groupId` instead of `agentId`; without it the
    // resolver falls through to a missing agent route and the URL is dropped.
    [
      resourcePath.message({ groupId: 'grp_1', id: 'msg_1', topicId: 'tpc_1' }),
      '/group/grp_1/tpc_1#msg_1',
    ],
    [resourcePath.message({ groupId: 'grp_1', id: 'msg_1' }), '/group/grp_1#msg_1'],
    [resourcePath.document({ id: 'docs_1' }), '/page/docs_1'],
    [
      resourcePath.document({ id: 'docs_1', knowledgeBaseId: 'kb_1' }),
      '/resource/library/kb_1?file=docs_1',
    ],
    [resourcePath.file({ id: 'file_1' }), '/resource/file/file_1'],
    [resourcePath.dashboard({ id: 'dsh_1', projectId: 'prj_1' }), '/project/prj_1/dashboard/dsh_1'],
    [resourcePath.task({ id: 'task_1', identifier: 'T-1', name: 'Ship it' }), '/task/T-1/ship-it'],
    [resourcePath.acceptance('acc_1'), '/acceptance/acc_1'],
  ])('builds %s', (actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('gives no path when the entity lacks the ids its page needs', () => {
    expect(resourcePath.topic({ id: 'tpc_1' })).toBeUndefined();
    expect(resourcePath.task({ name: 'no identifier' })).toBeUndefined();
    expect(searchResultPath({ id: 'x', type: 'unknown' })).toBeUndefined();
  });
});

describe('withUrl', () => {
  it('prefixes the active workspace slug', async () => {
    const toUrl = await resolveUrlBuilder(clientWith(async () => ({ slug: 'acme' })));

    expect(withUrls([{ id: 'agt_1' }], toUrl, (a) => resourcePath.agent(a.id))).toEqual([
      { id: 'agt_1', url: 'https://app.example.com/acme/agent/agt_1' },
    ]);
  });

  it('keeps an entity-owned url and adds the page link as appUrl', async () => {
    const toUrl = await resolveUrlBuilder(clientWith(async () => ({ slug: 'acme' })));
    const file = { id: 'file_1', url: 'https://s3.example.com/a.png' };

    expect(withUrl(file, toUrl, resourcePath.file(file))).toEqual({
      ...file,
      appUrl: 'https://app.example.com/acme/resource/file/file_1',
    });
  });

  it('passes a not-found null read through', async () => {
    const toUrl = await resolveUrlBuilder(clientWith(async () => ({ slug: 'acme' })));

    expect(withUrl(null as unknown as object, toUrl, resourcePath.group('grp_1'))).toBeNull();
  });

  it('leaves items untouched when the workspace lookup fails', async () => {
    const toUrl = await resolveUrlBuilder(clientWith(() => Promise.reject(new Error('denied'))));

    expect(withUrl({ id: 'agt_1' }, toUrl, resourcePath.agent('agt_1'))).toEqual({ id: 'agt_1' });
  });
});
