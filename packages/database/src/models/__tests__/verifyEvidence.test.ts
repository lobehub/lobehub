// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  files,
  users,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { VerifyCheckResultModel } from '../verifyCheckResult';
import { VerifyEvidenceModel } from '../verifyEvidence';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-evidence-test-user';
const operationId = 'verify-evidence-test-op';

let checkResultId: string;
let fileId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await new AgentOperationModel(serverDB, userId).recordStart({ operationId });
  const run = await new VerifyRunModel(serverDB, userId).ensureForOperation(operationId);
  const result = await new VerifyCheckResultModel(serverDB, userId).create({
    checkItemId: 'item-1',
    checkItemIndex: 0,
    verifierType: 'agent',
    verifyRunId: run.id,
  });
  checkResultId = result.id;
  const [file] = await serverDB
    .insert(files)
    .values({
      fileType: 'image/png',
      name: 'toolbar.png',
      size: 2048,
      url: 's3://evidence/toolbar.png',
      userId,
    })
    .returning();
  fileId = file.id;
});

afterEach(async () => {
  await serverDB.delete(verifyEvidence);
  await serverDB.delete(files);
  await serverDB.delete(verifyCheckResults);
  await serverDB.delete(verifyRuns);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('VerifyEvidenceModel', () => {
  it('creates a file-backed evidence row scoped to the user and reads it back', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    const created = await model.create({
      capturedBy: 'agent-browser',
      checkResultId,
      description: '首页首屏完整渲染',
      fileId,
      type: 'screenshot',
    });

    const found = await model.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.type).toBe('screenshot');
    expect(found?.fileId).toBe(fileId);
    expect(found?.content).toBeNull();
    expect(found?.capturedBy).toBe('agent-browser');

    // a different user must not see the row
    const otherModel = new VerifyEvidenceModel(serverDB, 'someone-else');
    expect(await otherModel.findById(created.id)).toBeUndefined();
  });

  it('creates an inline text evidence row with no file', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    const created = await model.create({
      capturedBy: 'cdp',
      checkResultId,
      content: 'console: 0 errors',
      type: 'text',
    });

    const found = await model.findById(created.id);
    expect(found?.content).toBe('console: 0 errors');
    expect(found?.fileId).toBeNull();
  });

  it('createMany returns an empty array without inserting when given no rows', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    expect(await model.createMany([])).toEqual([]);
    expect(await model.listByCheckResult(checkResultId)).toHaveLength(0);
  });

  it('lists evidence for one check result, oldest first', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    await model.createMany([
      { checkResultId, fileId, type: 'screenshot' },
      { checkResultId, content: 'dom snapshot', type: 'dom_snapshot' },
    ]);

    const rows = await model.listByCheckResult(checkResultId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(['dom_snapshot', 'screenshot']);
  });

  it('deletes an evidence row by id', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    const created = await model.create({ checkResultId, content: 'gone', type: 'text' });

    await model.delete(created.id);
    expect(await model.findById(created.id)).toBeUndefined();
  });

  it('nulls file_id when the underlying file is removed, keeping the evidence row', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    const created = await model.create({ checkResultId, fileId, type: 'screenshot' });

    await serverDB.delete(files);

    const found = await model.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.fileId).toBeNull();
  });

  it('cascades when its check result is removed', async () => {
    const model = new VerifyEvidenceModel(serverDB, userId);
    await model.create({ checkResultId, content: 'x', type: 'text' });

    await serverDB.delete(verifyCheckResults);
    expect(await model.listByCheckResult(checkResultId)).toHaveLength(0);
  });
});
