// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database';
import { AgentDocumentModel } from '@/database/models/agentDocuments';

import { AgentDocumentsService } from './index';

vi.mock('@/database/models/agentDocuments', async (importOriginal) => ({
  // Real helpers (H1 title extraction, filenames); only the model is stubbed.
  ...(await importOriginal<any>()),
  AgentDocumentModel: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/agentSkill', () => ({ AgentSkillModel: vi.fn() }));
vi.mock('@/database/models/topicDocument', () => ({ TopicDocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('../document', () => ({ DocumentService: vi.fn() }));
vi.mock('../file', () => ({ FileService: vi.fn() }));
vi.mock('../skill/resource', () => ({ SkillResourceService: vi.fn() }));
vi.mock('../agentDocumentVfs', () => ({ AgentDocumentVfsService: vi.fn() }));

const DOC_ID = '22222222-2222-4222-8222-222222222222';

// The shape of the 2026-11-15 vent: alerts as raw HTML between plan sections,
// with the flow chart, backend changes, release and risks after the first one.
const plan = [
  '# Rollout plan',
  '',
  '## Background',
  '',
  'Late feeds drop rows.',
  '',
  '<alert type="warning">',
  'Dropped rows cannot be recovered.',
  '</alert>',
  '',
  '## Flow',
  '',
  '```mermaid',
  'graph TD; Feed-->Importer;',
  '```',
  '',
  '## Backend changes',
  '',
  '- Retry late feeds',
  '',
  '## Release',
  '',
  '<alert type="info">',
  'Canary first.',
  '</alert>',
  '',
  '## Risks',
  '',
  'Retry storms if the feed stays down.',
].join('\n');

describe('AgentDocumentsService raw HTML blocks', () => {
  let stored: Record<string, any> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = undefined;
    const model = {
      create: vi.fn(async (agentId: string, filename: string, content: string, params: any) => {
        stored = { agentId, content, filename, id: DOC_ID, ...params };
        return stored;
      }),
      findById: vi.fn(async () => stored),
      findByParentAndFilename: vi.fn(async () => undefined),
      updateEditorSnapshotIfUnchanged: vi.fn(async () => true),
    };
    (AgentDocumentModel as any).mockImplementation(function (this: any) {
      Object.assign(this, model);
    });
  });

  it('createDocument stores the whole plan and readDocument returns all of it', async () => {
    const service = new AgentDocumentsService({} as LobeChatDatabase, 'user-1');

    const created = await service.createDocument('agent-1', '', plan);
    const read = await service.getDocumentSnapshotById(DOC_ID, 'agent-1');

    expect(created.title).toBe('Rollout plan');
    for (const section of ['## Flow', '## Backend changes', '## Release', '## Risks']) {
      expect(created.content).toContain(section);
    }
    expect(created.content).toContain('<alert type="info">\nCanary first.\n</alert>');
    expect(read?.content).toBe(created.content);
    expect(read?.litexml).toContain('Retry storms if the feed stays down.');
  });
});
