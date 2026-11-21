import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { describe, expect, it, vi } from 'vitest';

import {
  addBitableRecords,
  BITABLE_FIELD_TYPE_CODES,
  BITABLE_RECORD_BATCH_SIZE,
  createBitable,
  toBitableCellValue,
} from './bitable';
import { FeishuMessageService } from './service';

const createApi = () => {
  const api = {
    addDriveCollaborator: vi.fn().mockResolvedValue(undefined),
    batchCreateBitableRecords: vi
      .fn()
      .mockImplementation(async (_app: string, _table: string, rows: unknown[]) => ({
        recordIds: rows.map((_, i) => `rec${i}`),
      })),
    createBitableApp: vi.fn().mockResolvedValue({
      appToken: 'bascnABC',
      defaultTableId: 'tblDefault',
      name: '项目待办',
      url: 'https://x.feishu.cn/base/bascnABC',
    }),
    createBitableTable: vi
      .fn()
      .mockResolvedValue({ defaultViewId: 'vew1', fieldIds: [], tableId: 'tblNew' }),
    deleteBitableTable: vi.fn().mockResolvedValue(undefined),
    getWikiNode: vi.fn(),
    listBitableFields: vi.fn().mockResolvedValue([
      { fieldId: 'f1', fieldName: '任务', type: 1 },
      { fieldId: 'f2', fieldName: '负责人', type: 11 },
      { fieldId: 'f3', fieldName: '截止日期', type: 5 },
    ]),
    listBitableTables: vi.fn().mockResolvedValue([{ name: '任务表', tableId: 'tblFirst' }]),
  };
  return api as typeof api & LarkApiClient;
};

/** A definite Feishu rejection: nothing in the batch was written. */
const REJECTED = new Error(
  'Lark API POST /bitable/v1/apps/bascnABC/tables/tblNew/records/batch_create failed: 1254290 TooManyRequest',
);

const FIELDS = [
  { name: '任务', type: 'text' as const },
  { name: '负责人', type: 'person' as const },
  { name: '截止日期', type: 'date' as const },
  { name: '状态', options: ['待开始', '进行中', '已完成'], type: 'singleSelect' as const },
  { name: '标签', type: 'multiSelect' as const },
  { name: '工时', type: 'number' as const },
  { name: '完成', type: 'checkbox' as const },
  { name: '链接', type: 'url' as const },
];

describe('createBitable', () => {
  it('creates the app and typed table, drops the default table, writes rows and shares it', async () => {
    const api = createApi();

    const result = await createBitable(
      api,
      {
        collaborators: [{ openId: 'ou_owner' }, { openId: 'ou_viewer', perm: 'view' }],
        fields: FIELDS,
        name: '项目待办',
        platform: 'feishu',
        records: [
          {
            任务: '整理需求',
            完成: '否',
            工时: '3',
            截止日期: '2026-11-20',
            标签: '后端',
            状态: '进行中',
            负责人: 'ou_owner',
            链接: 'https://example.com',
          },
        ],
        tableName: '任务表',
      },
      'feishu',
    );

    expect(api.createBitableApp).toHaveBeenCalledWith({ folderToken: undefined, name: '项目待办' });
    expect(api.createBitableTable).toHaveBeenCalledWith('bascnABC', {
      fields: [
        { field_name: '任务', type: 1 },
        { field_name: '负责人', property: { multiple: true }, type: 11 },
        {
          field_name: '截止日期',
          property: { auto_fill: false, date_formatter: 'yyyy/MM/dd' },
          type: 5,
        },
        {
          field_name: '状态',
          property: { options: [{ name: '待开始' }, { name: '进行中' }, { name: '已完成' }] },
          type: 3,
        },
        { field_name: '标签', type: 4 },
        { field_name: '工时', type: 2 },
        { field_name: '完成', type: 7 },
        { field_name: '链接', type: 15 },
      ],
      name: '任务表',
    });
    expect(api.deleteBitableTable).toHaveBeenCalledWith('bascnABC', 'tblDefault');
    expect(api.batchCreateBitableRecords).toHaveBeenCalledWith(
      'bascnABC',
      'tblNew',
      [
        {
          任务: '整理需求',
          完成: false,
          工时: 3,
          截止日期: Date.parse('2026-11-20'),
          标签: ['后端'],
          状态: '进行中',
          负责人: [{ id: 'ou_owner' }],
          链接: { link: 'https://example.com', text: 'https://example.com' },
        },
      ],
      { clientToken: expect.any(String) },
    );
    expect(api.addDriveCollaborator).toHaveBeenNthCalledWith(1, 'bascnABC', 'bitable', {
      openId: 'ou_owner',
      perm: 'full_access',
    });
    expect(api.addDriveCollaborator).toHaveBeenNthCalledWith(2, 'bascnABC', 'bitable', {
      openId: 'ou_viewer',
      perm: 'view',
    });
    expect(result).toEqual({
      appToken: 'bascnABC',
      collaborators: ['ou_owner', 'ou_viewer'],
      issues: undefined,
      name: '项目待办',
      platform: 'feishu',
      recordIds: ['rec0'],
      tableId: 'tblNew',
      url: 'https://x.feishu.cn/base/bascnABC',
    });
  });

  it('keeps the Bitable and reports per-collaborator failures instead of throwing', async () => {
    const api = createApi();
    api.addDriveCollaborator
      .mockRejectedValueOnce(new Error('Lark API POST /drive failed: 99991672 Access denied'))
      .mockResolvedValueOnce(undefined);

    const result = await createBitable(
      api,
      {
        collaborators: [{ openId: 'ou_a' }, { openId: 'ou_b' }, { openId: 'ou_b' }],
        fields: [{ name: '任务', type: 'text' }],
        name: '待办',
        platform: 'feishu',
      },
      'feishu',
    );

    expect(api.addDriveCollaborator).toHaveBeenCalledTimes(2);
    expect(result.collaborators).toEqual(['ou_b']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0].target).toBe('ou_a');
    expect(result.issues![0].error).toContain('docs:permission.member:create');
    expect(result.url).toBe('https://x.feishu.cn/base/bascnABC');
  });

  it('reports bad rows as an issue but still returns the created table', async () => {
    const api = createApi();

    const result = await createBitable(
      api,
      {
        fields: [{ name: '任务', type: 'text' }],
        name: '待办',
        platform: 'feishu',
        records: [{ 不存在: 'x' }],
      },
      'feishu',
    );

    expect(api.batchCreateBitableRecords).not.toHaveBeenCalled();
    expect(result.tableId).toBe('tblNew');
    expect(result.issues?.[0]).toMatchObject({ target: 'records' });
    expect(result.issues?.[0].error).toContain('unknown column "不存在"');
    expect(result.issues?.[0].error).toContain('addBitableRecords');
  });

  it('matches seed-record keys to columns whose names were trimmed', async () => {
    const api = createApi();

    const result = await createBitable(
      api,
      {
        fields: [{ name: ' 任务 ', type: 'text' }],
        name: '待办',
        platform: 'feishu',
        records: [{ ' 任务 ': '写周报' }],
      },
      'feishu',
    );

    expect(api.createBitableTable.mock.calls[0][1].fields[0].field_name).toBe('任务');
    expect(api.batchCreateBitableRecords).toHaveBeenCalledWith(
      'bascnABC',
      'tblNew',
      [{ 任务: '写周报' }],
      { clientToken: expect.any(String) },
    );
    expect(result.issues).toBeUndefined();
  });

  it('splits more than 500 rows into several batch requests', async () => {
    const api = createApi();
    const records = Array.from({ length: BITABLE_RECORD_BATCH_SIZE + 1 }, (_, i) => ({
      任务: `t${i}`,
    }));

    const result = await createBitable(
      api,
      { fields: [{ name: '任务', type: 'text' }], name: '待办', platform: 'feishu', records },
      'feishu',
    );

    expect(api.batchCreateBitableRecords).toHaveBeenCalledTimes(2);
    expect(api.batchCreateBitableRecords.mock.calls[1][2]).toHaveLength(1);
    expect(result.recordIds).toHaveLength(BITABLE_RECORD_BATCH_SIZE + 1);
  });

  it('keeps the ids of committed batches when a later batch fails', async () => {
    const api = createApi();
    api.batchCreateBitableRecords
      .mockImplementationOnce(async (_a: string, _t: string, rows: unknown[]) => ({
        recordIds: rows.map((_, i) => `rec${i}`),
      }))
      .mockRejectedValueOnce(REJECTED);
    const records = Array.from({ length: BITABLE_RECORD_BATCH_SIZE + 1 }, (_, i) => ({
      任务: `t${i}`,
    }));

    const result = await createBitable(
      api,
      { fields: [{ name: '任务', type: 'text' }], name: '待办', platform: 'feishu', records },
      'feishu',
    );

    expect(result.recordIds).toHaveLength(BITABLE_RECORD_BATCH_SIZE);
    expect(result.issues?.[0].error).toContain(
      `${BITABLE_RECORD_BATCH_SIZE} of ${BITABLE_RECORD_BATCH_SIZE + 1} rows were already written`,
    );
    expect(result.issues?.[0].error).toContain(`retry only rows #${BITABLE_RECORD_BATCH_SIZE + 1}`);
  });

  it('validates columns before creating anything', async () => {
    const api = createApi();

    await expect(
      createBitable(
        api,
        {
          fields: [
            { name: '任务', type: 'text' },
            { name: '任务', type: 'number' },
          ],
          name: '待办',
          platform: 'feishu',
        },
        'feishu',
      ),
    ).rejects.toThrow('Duplicate column name "任务"');
    expect(api.createBitableApp).not.toHaveBeenCalled();
  });

  it('rejects a primary column type Feishu cannot index before creating anything', async () => {
    const api = createApi();

    await expect(
      createBitable(
        api,
        {
          fields: [
            { name: '负责人', type: 'person' },
            { name: '任务', type: 'text' },
          ],
          name: '待办',
          platform: 'feishu',
        },
        'feishu',
      ),
    ).rejects.toThrow('primary column and cannot be person');
    expect(api.createBitableApp).not.toHaveBeenCalled();
  });

  it('turns a missing bitable scope into an actionable hint', async () => {
    const api = createApi();
    api.createBitableApp.mockRejectedValueOnce(
      new Error('Lark API POST /bitable/v1/apps failed: 99991672 Access denied'),
    );

    await expect(
      createBitable(
        api,
        { fields: [{ name: '任务', type: 'text' }], name: '待办', platform: 'feishu' },
        'feishu',
      ),
    ).rejects.toThrow('bitable:app');
  });

  it('names the orphan Bitable when its table cannot be created', async () => {
    const api = createApi();
    api.createBitableTable.mockRejectedValueOnce(new Error('boom'));

    await expect(
      createBitable(
        api,
        { fields: [{ name: '任务', type: 'text' }], name: '待办', platform: 'feishu' },
        'feishu',
      ),
    ).rejects.toThrow('The Bitable was created (https://x.feishu.cn/base/bascnABC)');
  });
});

describe('addBitableRecords', () => {
  it('takes the app token and table from a /base/ URL and converts by column type', async () => {
    const api = createApi();

    const result = await addBitableRecords(
      api,
      {
        platform: 'feishu',
        records: [{ 任务: '验收', 截止日期: 1_763_600_000, 负责人: ['ou_1', { id: 'ou_2' }] }],
        url: 'https://x.feishu.cn/base/bascnABC?table=tblX&view=vew1',
      },
      'feishu',
    );

    expect(api.listBitableTables).not.toHaveBeenCalled();
    expect(api.listBitableFields).toHaveBeenCalledWith('bascnABC', 'tblX');
    expect(api.batchCreateBitableRecords).toHaveBeenCalledWith(
      'bascnABC',
      'tblX',
      [{ 任务: '验收', 截止日期: 1_763_600_000_000, 负责人: [{ id: 'ou_1' }, { id: 'ou_2' }] }],
      { clientToken: expect.any(String) },
    );
    expect(result).toEqual({
      appToken: 'bascnABC',
      platform: 'feishu',
      recordIds: ['rec0'],
      tableId: 'tblX',
    });
  });

  it('falls back to the first table when none is named', async () => {
    const api = createApi();

    const result = await addBitableRecords(
      api,
      { appToken: 'bascnABC', platform: 'lark', records: [{ 任务: 'a' }] },
      'lark',
    );

    expect(api.listBitableTables).toHaveBeenCalledWith('bascnABC');
    expect(result.tableId).toBe('tblFirst');
  });

  it('resolves a wiki link wrapping a Bitable', async () => {
    const api = createApi();
    api.getWikiNode.mockResolvedValueOnce({
      nodeToken: 'wikcn1',
      objToken: 'bascnWIKI',
      objType: 'bitable',
    });

    const result = await addBitableRecords(
      api,
      { platform: 'feishu', records: [{ 任务: 'a' }], url: 'https://x.feishu.cn/wiki/wikcn1' },
      'feishu',
    );

    expect(result.appToken).toBe('bascnWIKI');
  });

  it('rejects non-Bitable links', async () => {
    const api = createApi();

    await expect(
      addBitableRecords(
        api,
        { platform: 'feishu', records: [{ 任务: 'a' }], url: 'https://x.feishu.cn/docx/doxcn1' },
        'feishu',
      ),
    ).rejects.toThrow('not a Bitable');
  });

  it('retries an unconfirmed batch with the same client token', async () => {
    const api = createApi();
    api.batchCreateBitableRecords
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(
        new Error('Lark API POST /x failed: 1255040 request timed out, please try again later'),
      );

    const result = await addBitableRecords(
      api,
      { appToken: 'bascnABC', platform: 'feishu', records: [{ 任务: 'a' }] },
      'feishu',
    );

    expect(result.recordIds).toEqual(['rec0']);
    const tokens = api.batchCreateBitableRecords.mock.calls.map((call) => call[3]?.clientToken);
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/);
  });

  it('uses a fresh client token for each batch', async () => {
    const api = createApi();
    const records = Array.from({ length: BITABLE_RECORD_BATCH_SIZE + 1 }, () => ({ 任务: 'a' }));

    await addBitableRecords(api, { appToken: 'bascnABC', platform: 'feishu', records }, 'feishu');

    const [first, second] = api.batchCreateBitableRecords.mock.calls.map(
      (call) => call[3]?.clientToken,
    );
    expect(first).not.toBe(second);
  });

  it('reports a batch Feishu never confirmed as unknown, not as unwritten', async () => {
    const api = createApi();
    api.batchCreateBitableRecords
      .mockImplementationOnce(async (_a: string, _t: string, rows: unknown[]) => ({
        recordIds: rows.map((_, i) => `rec${i}`),
      }))
      .mockRejectedValue(new Error('Lark API POST /x failed: 502 Bad Gateway'));
    const records = Array.from({ length: BITABLE_RECORD_BATCH_SIZE * 2 + 3 }, () => ({
      任务: 'a',
    }));

    const error = await addBitableRecords(
      api,
      { appToken: 'bascnABC', platform: 'feishu', records },
      'feishu',
    ).catch((e: Error) => e);

    // 1 committed batch + 3 attempts at the second; the third is never sent.
    expect(api.batchCreateBitableRecords).toHaveBeenCalledTimes(4);
    expect(error.message).toContain(
      `did not confirm whether rows #${BITABLE_RECORD_BATCH_SIZE + 1}–#${BITABLE_RECORD_BATCH_SIZE * 2} were written`,
    );
    expect(error.message).toContain('check the table');
    expect(error.message).toContain(
      `rows #${BITABLE_RECORD_BATCH_SIZE * 2 + 1}–#${BITABLE_RECORD_BATCH_SIZE * 2 + 3} were not written`,
    );
    expect(error.message).not.toContain('retry only');
  });

  it('does not retry a batch Feishu definitely rejected', async () => {
    const api = createApi();
    api.batchCreateBitableRecords.mockRejectedValueOnce(REJECTED);

    await expect(
      addBitableRecords(
        api,
        { appToken: 'bascnABC', platform: 'feishu', records: [{ 任务: 'a' }] },
        'feishu',
      ),
    ).rejects.toThrow('1254290');
    expect(api.batchCreateBitableRecords).toHaveBeenCalledTimes(1);
  });

  it('says which rows landed when a later batch fails', async () => {
    const api = createApi();
    api.batchCreateBitableRecords
      .mockImplementationOnce(async (_a: string, _t: string, rows: unknown[]) => ({
        recordIds: rows.map((_, i) => `rec${i}`),
      }))
      .mockRejectedValueOnce(REJECTED);
    const records = Array.from({ length: BITABLE_RECORD_BATCH_SIZE + 2 }, () => ({ 任务: 'a' }));

    await expect(
      addBitableRecords(api, { appToken: 'bascnABC', platform: 'feishu', records }, 'feishu'),
    ).rejects.toThrow(
      `${BITABLE_RECORD_BATCH_SIZE} of ${BITABLE_RECORD_BATCH_SIZE + 2} rows were already written`,
    );
  });

  it('lists the real columns when a row names an unknown one', async () => {
    const api = createApi();

    await expect(
      addBitableRecords(
        api,
        { appToken: 'bascnABC', platform: 'feishu', records: [{ 优先级: '高' }] },
        'feishu',
      ),
    ).rejects.toThrow('Columns are: 任务, 负责人, 截止日期');
  });
});

describe('toBitableCellValue', () => {
  it('rejects values that cannot fit the column type', () => {
    expect(() => toBitableCellValue('工时', BITABLE_FIELD_TYPE_CODES.number, 'abc')).toThrow(
      'not a number',
    );
    expect(() => toBitableCellValue('截止', BITABLE_FIELD_TYPE_CODES.date, '下周')).toThrow(
      'not a date',
    );
  });

  it('keeps millisecond timestamps and reads only short values as seconds', () => {
    const date = BITABLE_FIELD_TYPE_CODES.date;
    expect(toBitableCellValue('d', date, 31_536_000_000)).toBe(31_536_000_000);
    expect(toBitableCellValue('d', date, 1_763_600_000_000)).toBe(1_763_600_000_000);
    expect(toBitableCellValue('d', date, 1_763_600_000)).toBe(1_763_600_000_000);
    expect(toBitableCellValue('d', date, '1763600000')).toBe(1_763_600_000_000);
  });

  it('passes values of column types it does not create through unchanged', () => {
    const value = [{ file_token: 'x' }];
    expect(toBitableCellValue('附件', 17, value)).toBe(value);
  });
});

describe('FeishuMessageService bitable', () => {
  it('delegates to the bitable helpers with its platform name', async () => {
    const api = createApi();
    const service = new FeishuMessageService(api, 'lark');

    const created = await service.createBitable({
      fields: [{ name: '任务', type: 'text' }],
      name: '待办',
      platform: 'lark',
    });
    const added = await service.addBitableRecords({
      appToken: 'bascnABC',
      platform: 'lark',
      records: [{ 任务: 'a' }],
    });

    expect(created.platform).toBe('lark');
    expect(added.platform).toBe('lark');
  });
});
