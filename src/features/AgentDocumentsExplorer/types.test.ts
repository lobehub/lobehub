import { describe, expect, it } from 'vitest';

import type { AgentDocumentItem } from './types';
import { hasSkillIndexChild, isOrphanSkillBundleItem, isProtectedManagedSkillItem } from './types';

const createDocument = (overrides: Partial<AgentDocumentItem>): AgentDocumentItem =>
  ({
    accessPublic: 0,
    accessSelf: 0,
    accessShared: 0,
    agentId: 'agent-1',
    category: 'document',
    content: '',
    createdAt: new Date('2026-05-09T00:00:00Z'),
    deletedAt: null,
    deletedByAgentId: null,
    deletedByUserId: null,
    deleteReason: null,
    description: null,
    documentId: 'doc-1',
    editorData: null,
    filename: 'document.md',
    fileType: 'custom/document',
    id: 'agent-doc-1',
    isFolder: false,
    isSkillBundle: false,
    isSkillIndex: false,
    loadRules: {},
    metadata: null,
    parentId: null,
    policy: null,
    policyLoad: 'disabled',
    policyLoadFormat: 'raw',
    policyLoadPosition: 'before-first-user',
    policyLoadRule: 'always',
    source: null,
    sourceType: 'file',
    templateId: null,
    title: 'Document',
    updatedAt: new Date('2026-05-09T00:00:00Z'),
    userId: 'user-1',
    ...overrides,
  }) as AgentDocumentItem;

const bundle = createDocument({
  category: 'skill',
  documentId: 'bundle-doc',
  isFolder: true,
  isSkillBundle: true,
  templateId: 'agent-skill',
});

const index = createDocument({
  category: 'skill',
  documentId: 'index-doc',
  isSkillIndex: true,
  parentId: 'bundle-doc',
  templateId: 'agent-skill',
});

describe('AgentDocumentsExplorer skill relationship helpers', () => {
  it('detects whether a skill bundle has a SKILL.md child', () => {
    expect(hasSkillIndexChild([bundle, index], bundle)).toBe(true);
    expect(hasSkillIndexChild([bundle], bundle)).toBe(false);
  });

  it('marks a skill bundle missing SKILL.md as orphan', () => {
    expect(isOrphanSkillBundleItem(bundle, [bundle, index])).toBe(false);
    expect(isOrphanSkillBundleItem(bundle, [bundle])).toBe(true);
  });

  it('protects managed skill items from rename/delete unless orphaned', () => {
    expect(isProtectedManagedSkillItem(bundle, [bundle, index])).toBe(true);
    expect(isProtectedManagedSkillItem(bundle, [bundle])).toBe(false);
    expect(isProtectedManagedSkillItem(createDocument({}), [])).toBe(false);
  });
});
