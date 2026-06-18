import { DocumentLoadFormat, DocumentLoadRule, PolicyLoad } from '@lobechat/agent-templates';
import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_SOURCE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  WEB_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import type { AgentDocumentWithRules } from '@/database/models/agentDocuments';
import {
  normalizeAgentDocumentPosition,
  toAgentContextDocument,
  toAgentContextDocuments,
} from '@/utils/agentDocumentContextMapping';

const buildDoc = (overrides: Partial<AgentDocumentWithRules> = {}): AgentDocumentWithRules =>
  ({
    accessPublic: 0,
    accessSelf: 31,
    accessShared: 0,
    agentId: 'agent-1',
    category: AGENT_DOCUMENT_CATEGORY,
    content: 'body',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    deleteReason: null,
    deletedAt: null,
    deletedByAgentId: null,
    deletedByUserId: null,
    description: 'a description',
    documentId: 'doc-row-1',
    editorData: null,
    fileType: 'article',
    filename: 'doc.md',
    id: 'agent-doc-1',
    isFolder: false,
    isSkillBundle: false,
    isSkillIndex: false,
    loadRules: {},
    metadata: null,
    parentId: null,
    policy: null,
    policyLoad: PolicyLoad.PROGRESSIVE,
    policyLoadFormat: DocumentLoadFormat.RAW,
    policyLoadPosition: 'before-first-user',
    policyLoadRule: 'always',
    source: 'https://example.com/post',
    sourceType: WEB_DOCUMENT_SOURCE_TYPE,
    templateId: null,
    title: 'Doc title',
    updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    userId: 'user-1',
    ...overrides,
  }) as AgentDocumentWithRules;

describe('toAgentContextDocument', () => {
  // Regression: — server-side mapper used to drop sourceType, which
  // disabled the "hide web-crawled docs from the progressive index" filter for
  // every chat that went through RuntimeExecutors. Keep this lock tight so any
  // future field addition that forgets one side trips here.
  it('propagates sourceType so the progressive web-doc filter can fire', () => {
    expect(
      toAgentContextDocument(buildDoc({ sourceType: WEB_DOCUMENT_SOURCE_TYPE })).sourceType,
    ).toBe(WEB_DOCUMENT_SOURCE_TYPE);
    expect(
      toAgentContextDocument(buildDoc({ sourceType: AGENT_DOCUMENT_SOURCE_TYPE })).sourceType,
    ).toBe(AGENT_DOCUMENT_SOURCE_TYPE);
    expect(toAgentContextDocument(buildDoc({ sourceType: 'file' })).sourceType).toBe('file');
  });

  it('propagates updatedAt so sortByRecency has a real timestamp', () => {
    const ts = new Date('2026-05-21T12:34:56.000Z');
    expect(toAgentContextDocument(buildDoc({ updatedAt: ts })).updatedAt).toBe(ts);
  });

  it('maps a fully populated row into the AgentContextDocument shape', () => {
    const doc = buildDoc({
      description: 'web-crawled article',
      filename: 'crawl.md',
      id: 'agent-doc-2',
      loadRules: { priority: 3, rule: DocumentLoadRule.ALWAYS },
      policyLoad: PolicyLoad.PROGRESSIVE,
      policyLoadFormat: DocumentLoadFormat.RAW,
      policyLoadPosition: 'before-first-user',
      sourceType: 'web',
      templateId: 'claw',
      title: 'Crawled',
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    });

    expect(toAgentContextDocument(doc)).toEqual({
      content: 'body',
      contentCharCount: 4,
      description: 'web-crawled article',
      filename: 'crawl.md',
      id: 'agent-doc-2',
      loadPosition: 'before-first-user',
      loadRules: { priority: 3, rule: DocumentLoadRule.ALWAYS },
      policyId: 'claw',
      policyLoad: PolicyLoad.PROGRESSIVE,
      policyLoadFormat: DocumentLoadFormat.RAW,
      sourceType: 'web',
      title: 'Crawled',
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    });
  });

  it('prefers policy.context overrides over the indexed projection fields', () => {
    const doc = buildDoc({
      policy: {
        context: { policyLoadFormat: 'file', position: 'system-append' },
      } as AgentDocumentWithRules['policy'],
      policyLoadFormat: DocumentLoadFormat.RAW,
      policyLoadPosition: 'before-first-user',
    });

    const mapped = toAgentContextDocument(doc);
    expect(mapped.loadPosition).toBe('system-append');
    expect(mapped.policyLoadFormat).toBe('file');
  });

  it('coerces null description / sourceType / updatedAt into undefined', () => {
    const mapped = toAgentContextDocument(
      buildDoc({
        description: null,
        sourceType: null as unknown as AgentDocumentWithRules['sourceType'],
        updatedAt: null as unknown as Date,
      }),
    );

    expect(mapped.description).toBeUndefined();
    expect(mapped.sourceType).toBeUndefined();
    expect(mapped.updatedAt).toBeUndefined();
  });

  it('drops unknown loadPosition values rather than smuggling them through', () => {
    const mapped = toAgentContextDocument(
      buildDoc({ policyLoadPosition: 'definitely-not-a-real-position' }),
    );
    expect(mapped.loadPosition).toBeUndefined();
  });
});

describe('toAgentContextDocuments', () => {
  it('preserves order and maps each row through toAgentContextDocument', () => {
    const rows = [
      buildDoc({ id: 'a', sourceType: WEB_DOCUMENT_SOURCE_TYPE }),
      buildDoc({ id: 'b', sourceType: AGENT_DOCUMENT_SOURCE_TYPE }),
      buildDoc({ id: 'c', sourceType: 'file' }),
    ];

    const result = toAgentContextDocuments(rows);

    expect(result.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(result.map((d) => d.sourceType)).toEqual([
      WEB_DOCUMENT_SOURCE_TYPE,
      AGENT_DOCUMENT_SOURCE_TYPE,
      'file',
    ]);
  });

  // Regression: — folder VFS nodes (plain folders + skill bundles)
  // carry empty content but inherit loadRules/loadPosition, so they used to
  // leak into the injection candidate pool as empty slots. They must never
  // become context documents.
  it('drops folder rows (plain folders and skill bundles) from context', () => {
    const rows = [
      buildDoc({ id: 'doc', isFolder: false }),
      buildDoc({ id: 'folder', isFolder: true, fileType: CUSTOM_FOLDER_FILE_TYPE }),
      buildDoc({ id: 'bundle', isFolder: true, isSkillBundle: true, fileType: 'skills/bundle' }),
    ];

    const result = toAgentContextDocuments(rows);

    expect(result.map((d) => d.id)).toEqual(['doc']);
  });

  it('keeps non-folder skill rows such as the SKILL.md index', () => {
    const rows = [
      buildDoc({
        id: 'skill-index',
        isFolder: false,
        isSkillIndex: true,
        fileType: 'skills/index',
      }),
    ];

    const result = toAgentContextDocuments(rows);

    expect(result.map((d) => d.id)).toEqual(['skill-index']);
  });
});

describe('normalizeAgentDocumentPosition', () => {
  it('accepts every position in AGENT_DOCUMENT_INJECTION_POSITIONS', () => {
    for (const position of [
      'after-first-user',
      'before-first-user',
      'before-system',
      'context-end',
      'manual',
      'on-demand',
      'system-append',
      'system-replace',
    ] as const) {
      expect(normalizeAgentDocumentPosition(position)).toBe(position);
    }
  });

  it('returns undefined for nullish or unknown positions', () => {
    expect(normalizeAgentDocumentPosition(null)).toBeUndefined();
    expect(normalizeAgentDocumentPosition(undefined)).toBeUndefined();
    expect(normalizeAgentDocumentPosition('')).toBeUndefined();
    expect(normalizeAgentDocumentPosition('not-a-position')).toBeUndefined();
  });
});
