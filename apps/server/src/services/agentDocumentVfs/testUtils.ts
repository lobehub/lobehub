import { vi } from 'vitest';

import { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';

import { createSkillMount } from './mounts/skills/createSkillMount';

/**
 * Shared fixtures for the `AgentDocumentVfsService` scenario tests.
 *
 * Each test file keeps its own `vi.mock` calls for `@/database/models/agentDocuments`,
 * `./mounts/skills/createSkillMount` and `../file`; these helpers only wire the mocked
 * constructors to the shared mock instances below.
 */
export const db = {} as LobeChatDatabase;
export const userId = 'user-1';

export const mockAgentDocumentModel = {
  create: vi.fn(),
  findByDocumentId: vi.fn(),
  findByIdWithOptions: vi.fn(),
  findByParentAndFilename: vi.fn(),
  listByParentAndFilename: vi.fn(),
  listByParent: vi.fn(),
  listDeletedByAgent: vi.fn(),
  movePath: vi.fn(),
  permanentlyDelete: vi.fn(),
  restore: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
};

export const mockSkillMount = {
  create: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
};

/** Resets the shared model and skill-mount mocks; call from each file's `beforeEach`. */
export const resetVfsMocks = () => {
  for (const method of Object.values(mockAgentDocumentModel)) {
    method.mockReset();
  }
  mockAgentDocumentModel.permanentlyDelete.mockResolvedValue([]);
  for (const method of Object.values(mockSkillMount)) {
    method.mockReset();
  }
  (AgentDocumentModel as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
    return mockAgentDocumentModel;
  });
  (createSkillMount as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSkillMount);
  mockAgentDocumentModel.listByParentAndFilename.mockImplementation(async (...args) => {
    const result = await mockAgentDocumentModel.findByParentAndFilename(...args);
    return result ? [result] : [];
  });
};
