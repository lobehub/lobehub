import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LarkApiClient } from './api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const tokenResponse = () =>
  jsonResponse({ code: 0, expire: 7200, msg: 'ok', tenant_access_token: 't-abc' });

describe('LarkApiClient cloud documents', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('getDocxRawContent hits the raw_content endpoint with the tenant token', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { content: '标题\n正文' }, msg: 'ok' }));

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await expect(api.getDocxRawContent('doxcnABC')).resolves.toBe('标题\n正文');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://open.feishu.cn/open-apis/docx/v1/documents/doxcnABC/raw_content');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer t-abc');
  });

  it('getDocxDocument returns title and revision', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: { document: { document_id: 'doxcnABC', revision_id: 12, title: '评审会纪要' } },
        msg: 'ok',
      }),
    );

    const api = new LarkApiClient('cli_app', 'secret', 'lark');
    await expect(api.getDocxDocument('doxcnABC')).resolves.toEqual({
      documentId: 'doxcnABC',
      revisionId: 12,
      title: '评审会纪要',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://open.larksuite.com/open-apis/docx/v1/documents/doxcnABC',
    );
  });

  it('getWikiNode resolves the wrapped object token', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: {
          node: { node_token: 'wikcnX', obj_token: 'doxcnY', obj_type: 'docx', title: 'Wiki 页' },
        },
        msg: 'ok',
      }),
    );

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await expect(api.getWikiNode('wikcnX')).resolves.toEqual({
      nodeToken: 'wikcnX',
      objToken: 'doxcnY',
      objType: 'docx',
      title: 'Wiki 页',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wikcnX',
    );
  });

  it('honours LARK_API_BASE_URL for every call, auth included', async () => {
    vi.stubEnv('LARK_API_BASE_URL', 'http://127.0.0.1:4190/open-apis/');
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { content: 'x' }, msg: 'ok' }));

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await api.getDocxRawContent('doxcnABC');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:4190/open-apis/auth/v3/tenant_access_token/internal',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:4190/open-apis/docx/v1/documents/doxcnABC/raw_content',
    );
  });

  it('surfaces the Feishu error code and permission violation on failure', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        code: 1770032,
        error: {
          permission_violations: [
            { description: '查看新版文档', subject: 'docx:document:readonly', type: 'scope' },
          ],
        },
        msg: 'forbidden',
      }),
    );

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await expect(api.getDocxRawContent('doxcnABC')).rejects.toThrow(
      /1770032 forbidden \(missing permission — docx:document:readonly: 查看新版文档\)/,
    );
  });
});

const TOKEN_RESPONSE = { code: 0, expire: 7200, msg: 'ok', tenant_access_token: 't-acc' };

/**
 * Answer the token handshake `call()` always performs first, then hand the
 * next response to the endpoint under test.
 */
function mockFetch(appResponse: unknown, status = 200) {
  return vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/auth/v3/tenant_access_token/internal')) {
      return new Response(JSON.stringify(TOKEN_RESPONSE), { status: 200 });
    }
    return new Response(JSON.stringify(appResponse), { status });
  });
}

function appInfo(app: Record<string, unknown>) {
  return { code: 0, data: { app }, msg: 'success' };
}

describe('LarkApiClient.getAppOwnerId', () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const client = () => new LarkApiClient('cli_app_1', 'secret', 'feishu');

  it('returns the app owner open_id', async () => {
    fetchSpy = mockFetch(
      appInfo({
        app_id: 'cli_app_1',
        creator_id: 'ou_creator_1111',
        owner: { name: 'Lin', owner_id: 'ou_owner_2222', type: 2 },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(client().getAppOwnerId()).resolves.toEqual({
      openId: 'ou_owner_2222',
      source: 'owner',
    });
  });

  it('asks the app-info endpoint for open_id ids and the required lang', async () => {
    fetchSpy = mockFetch(appInfo({ owner: { owner_id: 'ou_owner_2222' } }));
    vi.stubGlobal('fetch', fetchSpy);

    await client().getAppOwnerId();

    const url = fetchSpy.mock.calls.at(-1)![0] as string;
    expect(url).toContain('/application/v6/applications/cli_app_1');
    expect(url).toContain('user_id_type=open_id');
    // `lang` is a required query parameter; omitting it fails the request.
    expect(url).toContain('lang=');
  });

  it('falls back to the creator when the owner slot is not a person', async () => {
    // A partner- or tenant-owned app puts a non-`ou_` id in `owner`, which can
    // never match an inbound `sender_id.open_id`.
    fetchSpy = mockFetch(
      appInfo({
        creator_id: 'ou_creator_1111',
        owner: { owner_id: 'tenant_abc', type: 0 },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(client().getAppOwnerId()).resolves.toEqual({
      openId: 'ou_creator_1111',
      source: 'creator',
    });
  });

  it('returns null when neither field carries a user open_id', async () => {
    fetchSpy = mockFetch(appInfo({ app_id: 'cli_app_1', owner: { type: 0 } }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(client().getAppOwnerId()).resolves.toBeNull();
  });

  it('surfaces a permission failure instead of returning null', async () => {
    // Missing `application:application:self_manage` comes back as a non-zero
    // business code, which `call()` turns into an error — the caller has to be
    // able to tell "no permission" from "no owner on the app".
    fetchSpy = mockFetch({ code: 99_991_672, msg: 'no permission' });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(client().getAppOwnerId()).rejects.toThrow(/99991672|no permission/);
  });
});

describe('LarkApiClient bitable', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    return { body: init.body ? JSON.parse(init.body) : undefined, method: init.method, url };
  };

  it('createBitableApp posts the name and folder and returns the app token, url and default table', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: {
          app: {
            app_token: 'bascnABC',
            default_table_id: 'tblDefault',
            name: '待办',
            url: 'https://x.feishu.cn/base/bascnABC',
          },
        },
        msg: 'ok',
      }),
    );

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await expect(api.createBitableApp({ folderToken: 'fldX', name: '待办' })).resolves.toEqual({
      appToken: 'bascnABC',
      defaultTableId: 'tblDefault',
      name: '待办',
      url: 'https://x.feishu.cn/base/bascnABC',
    });
    expect(lastCall()).toEqual({
      body: { folder_token: 'fldX', name: '待办' },
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/bitable/v1/apps',
    });
  });

  it('createBitableTable sends the columns under `table` and returns the table id', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: { default_view_id: 'vew1', field_id_list: ['fld1'], table_id: 'tblNew' },
        msg: 'ok',
      }),
    );

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    const fields = [{ field_name: '任务', type: 1 }];
    await expect(api.createBitableTable('bascnABC', { fields, name: '任务表' })).resolves.toEqual({
      defaultViewId: 'vew1',
      fieldIds: ['fld1'],
      tableId: 'tblNew',
    });
    expect(lastCall()).toEqual({
      body: { table: { default_view_name: '任务表', fields, name: '任务表' } },
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/bitable/v1/apps/bascnABC/tables',
    });
  });

  it('batchCreateBitableRecords wraps each row in `fields` and asks for open_id person values', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: { records: [{ record_id: 'rec1' }, { record_id: 'rec2' }] },
        msg: 'ok',
      }),
    );

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await expect(
      api.batchCreateBitableRecords('bascnABC', 'tblNew', [{ 任务: 'a' }, { 任务: 'b' }]),
    ).resolves.toEqual({ recordIds: ['rec1', 'rec2'] });
    expect(lastCall()).toEqual({
      body: { records: [{ fields: { 任务: 'a' } }, { fields: { 任务: 'b' } }] },
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/bitable/v1/apps/bascnABC/tables/tblNew/records/batch_create?user_id_type=open_id',
    });
  });

  it('listBitableTables and listBitableFields map the items', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { items: [{ name: '表1', table_id: 'tbl1' }] }, msg: 'ok' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { items: [{ field_id: 'fld1', field_name: '任务', type: 1 }] },
          msg: 'ok',
        }),
      );

    const api = new LarkApiClient('cli_app', 'secret', 'lark');
    await expect(api.listBitableTables('bascnABC')).resolves.toEqual([
      { name: '表1', tableId: 'tbl1' },
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://open.larksuite.com/open-apis/bitable/v1/apps/bascnABC/tables?page_size=100',
    );
    await expect(api.listBitableFields('bascnABC', 'tbl1')).resolves.toEqual([
      { fieldId: 'fld1', fieldName: '任务', type: 1 },
    ]);
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://open.larksuite.com/open-apis/bitable/v1/apps/bascnABC/tables/tbl1/fields?page_size=100',
    );
  });

  it('listBitableFields follows page_token until every column is collected', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            has_more: true,
            items: [{ field_id: 'fld1', field_name: '任务', type: 1 }],
            page_token: 'p2',
          },
          msg: 'ok',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            has_more: false,
            items: [{ field_id: 'fld101', field_name: '第101列', type: 2 }],
          },
          msg: 'ok',
        }),
      );

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await expect(api.listBitableFields('bascnABC', 'tbl1')).resolves.toEqual([
      { fieldId: 'fld1', fieldName: '任务', type: 1 },
      { fieldId: 'fld101', fieldName: '第101列', type: 2 },
    ]);
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://open.feishu.cn/open-apis/bitable/v1/apps/bascnABC/tables/tbl1/fields?page_size=100&page_token=p2',
    );
  });

  it('addDriveCollaborator adds an open_id member to the bitable without notifying', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { member: {} }, msg: 'ok' }));

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await api.addDriveCollaborator('bascnABC', 'bitable', { openId: 'ou_1', perm: 'full_access' });
    expect(lastCall()).toEqual({
      body: { member_id: 'ou_1', member_type: 'openid', perm: 'full_access' },
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/drive/v1/permissions/bascnABC/members?need_notification=false&type=bitable',
    });
  });

  it('deleteBitableTable issues a DELETE', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {}, msg: 'ok' }));

    const api = new LarkApiClient('cli_app', 'secret', 'feishu');
    await api.deleteBitableTable('bascnABC', 'tblDefault');
    expect(lastCall()).toEqual({
      body: undefined,
      method: 'DELETE',
      url: 'https://open.feishu.cn/open-apis/bitable/v1/apps/bascnABC/tables/tblDefault',
    });
  });
});
