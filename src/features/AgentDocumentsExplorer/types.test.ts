import { describe, expect, it } from 'vitest';

import type { AgentDocumentItem } from './types';
import {
  AGENT_SKILL_TEMPLATE_ID,
  FOLDER_FILE_TYPE,
  hasSkillIndexChild,
  isFolderItem,
  isManagedSkillItem,
  isOrphanSkillBundleItem,
  isProtectedManagedSkillItem,
  isSkillBundleItem,
  isSkillIndexItem,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
} from './types';

const createDocument = (overrides: Partial<AgentDocumentItem>): AgentDocumentItem =>
  ({
    accessPublic: 0,
    accessSelf: 0,
    accessShared: 0,
    agentId: 'agent-1',
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

describe('AgentDocumentsExplorer types', () => {
  it('treats managed skill bundles as folders', () => {
    const bundle = createDocument({
      fileType: SKILL_BUNDLE_FILE_TYPE,
      templateId: AGENT_SKILL_TEMPLATE_ID,
    });
    const index = createDocument({
      fileType: SKILL_INDEX_FILE_TYPE,
      templateId: AGENT_SKILL_TEMPLATE_ID,
    });
    const folder = createDocument({ fileType: FOLDER_FILE_TYPE });

    expect(isSkillBundleItem(bundle)).toBe(true);
    expect(isFolderItem(bundle)).toBe(true);
    expect(isSkillIndexItem(index)).toBe(true);
    expect(isFolderItem(index)).toBe(false);
    expect(isFolderItem(folder)).toBe(true);
  });

  it('detects managed skill items by template id or file type', () => {
    expect(isManagedSkillItem(createDocument({ templateId: AGENT_SKILL_TEMPLATE_ID }))).toBe(true);
    expect(isManagedSkillItem(createDocument({ fileType: SKILL_INDEX_FILE_TYPE }))).toBe(true);
    expect(isManagedSkillItem(createDocument({ fileType: 'custom/document' }))).toBe(false);
  });

  it('treats skill bundles without SKILL.md as recoverable orphan bundles', () => {
    const bundle = createDocument({
      documentId: 'bundle-doc',
      fileType: SKILL_BUNDLE_FILE_TYPE,
      templateId: AGENT_SKILL_TEMPLATE_ID,
    });
    const index = createDocument({
      documentId: 'index-doc',
      fileType: SKILL_INDEX_FILE_TYPE,
      parentId: 'bundle-doc',
      templateId: AGENT_SKILL_TEMPLATE_ID,
    });

    expect(hasSkillIndexChild([bundle, index], bundle)).toBe(true);
    expect(isOrphanSkillBundleItem(bundle, [bundle, index])).toBe(false);
    expect(isProtectedManagedSkillItem(bundle, [bundle, index])).toBe(true);

    expect(hasSkillIndexChild([bundle], bundle)).toBe(false);
    expect(isOrphanSkillBundleItem(bundle, [bundle])).toBe(true);
    expect(isProtectedManagedSkillItem(bundle, [bundle])).toBe(false);
  });
});
