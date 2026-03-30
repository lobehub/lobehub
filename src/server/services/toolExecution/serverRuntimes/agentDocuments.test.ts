// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { agentDocumentsRuntime } from './agentDocuments';

const listDocuments = vi.fn();

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(() => ({
    listDocuments,
  })),
}));

describe('agentDocumentsRuntime', () => {
  describe('listDocuments', () => {
    it('should preserve document filenames in runtime output', async () => {
      listDocuments.mockResolvedValue([
        { filename: 'rules.md', id: 'doc-1', title: 'Rules' },
        { filename: 'notes.txt', id: 'doc-2', title: 'Notes' },
      ]);

      const runtime = agentDocumentsRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });
      const result = await runtime.listDocuments({}, { agentId: 'agent-1' });

      expect(listDocuments).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual({
        content: JSON.stringify([
          { filename: 'rules.md', id: 'doc-1', title: 'Rules' },
          { filename: 'notes.txt', id: 'doc-2', title: 'Notes' },
        ]),
        state: {
          documents: [
            { filename: 'rules.md', id: 'doc-1', title: 'Rules' },
            { filename: 'notes.txt', id: 'doc-2', title: 'Notes' },
          ],
        },
        success: true,
      });
    });
  });
});
