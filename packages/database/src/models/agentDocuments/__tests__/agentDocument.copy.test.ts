// @vitest-environment node
// Focused copy-scenario tests for `AgentDocumentModel.copy` — extracted from
// the oversized `agentDocument.test.ts` per the source-layout 800-line rule
// (Codex P2 on #20914). Copy parameter assembly itself lives in
// `../copyDocument.ts`.
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentDocumentModel, DocumentLoadPosition, PolicyLoad } from '../agentDocument';

const userId = 'agent-document-copy-test-user';
const agentId = 'agent-document-copy-test-agent';

let agentDocumentModel: AgentDocumentModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(agents).values([{ id: agentId, userId }]);

  agentDocumentModel = new AgentDocumentModel(serverDB, userId);
});

describe('AgentDocumentModel.copy', () => {
  it('should copy into a new record and keep policy/template metadata', async () => {
    const created = await agentDocumentModel.create(agentId, 'copy-source.md', 'copy me', {
      loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
      loadRules: { maxTokens: 200, priority: 3 },
      metadata: { description: 'source desc', domain: 'A' },
      templateId: 'claw',
    });

    const copied = await agentDocumentModel.copy(created.id, 'Copied Title');

    expect(copied).toBeDefined();
    expect(copied?.id).not.toBe(created.id);
    expect(copied?.documentId).not.toBe(created.documentId);
    expect(copied?.filename).toBe('Copied Title');
    expect(copied?.templateId).toBe('claw');
    expect(copied?.policy?.context?.maxTokens).toBe(200);
    expect(copied?.metadata).toMatchObject({ description: 'source desc', domain: 'A' });
  });

  it('should preserve policyLoad when copying a document', async () => {
    const created = await agentDocumentModel.create(agentId, 'always-doc.md', 'content', {
      policyLoad: PolicyLoad.ALWAYS,
    });

    const copied = await agentDocumentModel.copy(created.id, 'Always Copy');

    expect(copied?.policyLoad).toBe(PolicyLoad.ALWAYS);
  });

  // T-775: an empty-parse shell (editorData with a childless root and empty
  // content — what a raw HTML/XML crawl capture used to persist) must not be
  // duplicated as another shell. The clone reads as Lexical error #38 and
  // blocks cleanup, so copy stores it as raw text instead.
  it('should not duplicate an empty-parse shell as editor data when copying', async () => {
    const created = await agentDocumentModel.create(agentId, 'shell-source.md', '', {
      editorData: {
        root: {
          children: [],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      } as any,
    });
    expect(created.content).toBe('');

    const copied = await agentDocumentModel.copy(created.id, 'Shell Copy');

    expect(copied).toBeDefined();
    expect(copied?.fileType).toBe('text/plain');
    expect(copied?.editorData ?? null).toBeNull();
  });
});
