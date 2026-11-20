// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, documents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { AgentDocument } from '../types';
import {
  AgentDocumentModel,
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '.';
import type { AgentDocumentContext } from './context';
import { buildBackingDocumentUpdate, buildBindingSettingsUpdate } from './edits';

const userId = 'agent-document-edits-user';
const agentId = 'agent-document-edits-agent';
/** A well-formed binding id that no row uses (`agent_documents.id` is a uuid column). */
const missingBindingId = '00000000-0000-4000-8000-000000000000';

const serverDB: LobeChatDatabase = await getTestDB();

/** The builders under test read no scope column, so the ctx is a typed stand-in. */
const ctx = { db: serverDB, userId } as unknown as AgentDocumentContext;

const binding = (policy: AgentDocument['policy'], policyLoad?: PolicyLoad) =>
  ({ policy, policyLoad }) as AgentDocument;

let agentDocumentModel: AgentDocumentModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
  agentDocumentModel = new AgentDocumentModel(serverDB, userId);
});

/** Creates a backing document plus its binding and returns the binding id. */
const seedBinding = async () => {
  const [doc] = await serverDB
    .insert(documents)
    .values({
      content: 'seeded content',
      fileType: 'article',
      filename: 'seeded.html',
      source: 'https://example.com',
      sourceType: 'web',
      title: 'Seeded Page',
      totalCharCount: 14,
      totalLineCount: 1,
      userId,
    })
    .returning();

  const associated = await agentDocumentModel.associate({ agentId, documentId: doc!.id });

  return associated.id;
};

describe('agent document edit helpers', () => {
  describe('buildBindingSettingsUpdate', () => {
    it('falls back to the raw/always defaults when the binding has no policy', () => {
      const result = buildBindingSettingsUpdate(binding(null));

      expect(result.policyLoadFormat).toBe(DocumentLoadFormat.RAW);
      expect(result.policyLoadPosition).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
      expect(result.policyLoadRule).toBe(DocumentLoadRule.ALWAYS);
      expect(result).not.toHaveProperty('policyLoad');
      expect(result.policy?.context?.position).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
      expect(result.policy?.context?.rule).toBe(DocumentLoadRule.ALWAYS);
    });

    it('carries the stored context and an explicit policyLoad', () => {
      const result = buildBindingSettingsUpdate(
        binding(
          {
            context: {
              policyLoadFormat: DocumentLoadFormat.FILE,
              position: DocumentLoadPosition.BEFORE_SYSTEM,
              rule: DocumentLoadRule.BY_KEYWORDS,
            },
          },
          PolicyLoad.PROGRESSIVE,
        ),
        { policyLoad: PolicyLoad.FULL },
      );

      expect(result.policyLoadFormat).toBe(DocumentLoadFormat.FILE);
      expect(result.policyLoadPosition).toBe(DocumentLoadPosition.BEFORE_SYSTEM);
      expect(result.policyLoadRule).toBe(DocumentLoadRule.BY_KEYWORDS);
      expect(result.policyLoad).toBe(PolicyLoad.FULL);
    });

    it('applies the requested load rules when the stored policy has no context', () => {
      const result = buildBindingSettingsUpdate(binding({}), {
        loadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: {
          keywordMatchMode: 'any',
          keywords: ['alpha', 'beta'],
          maxTokens: 99,
          priority: 5,
          regexp: '^alpha',
          rule: DocumentLoadRule.BY_REGEXP,
          timeRange: { from: '2026-01-01' },
        },
        policy: {},
      });

      expect(result.policy?.context?.keywordMatchMode).toBe('any');
      expect(result.policy?.context?.keywords).toEqual(['alpha', 'beta']);
      expect(result.policy?.context?.maxTokens).toBe(99);
      expect(result.policy?.context?.priority).toBe(5);
      expect(result.policy?.context?.regexp).toBe('^alpha');
      expect(result.policy?.context?.rule).toBe(DocumentLoadRule.BY_REGEXP);
      expect(result.policy?.context?.timeRange).toEqual({ from: '2026-01-01' });
      expect(result.policy?.context?.position).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
      expect(result.policyLoadRule).toBe(DocumentLoadRule.BY_REGEXP);
    });

    it('keeps the stored context when the request carries no matching rule', () => {
      const result = buildBindingSettingsUpdate(
        binding({ context: { maxTokens: 7, rule: DocumentLoadRule.BY_KEYWORDS } }),
        { loadRules: { maxTokens: 99, rule: DocumentLoadRule.ALWAYS } },
      );

      expect(result.policy?.context?.maxTokens).toBe(7);
      expect(result.policy?.context?.rule).toBe(DocumentLoadRule.BY_KEYWORDS);
    });
  });

  describe('buildBackingDocumentUpdate', () => {
    it('skips the write when the update touches no document field', () => {
      expect(buildBackingDocumentUpdate(ctx, {})).toBeUndefined();
      expect(buildBackingDocumentUpdate(ctx, undefined)).toBeUndefined();
    });

    it('recomputes the stats when only the content changes', () => {
      const update = buildBackingDocumentUpdate(ctx, { content: 'line one\nline two' });

      expect(update).toEqual({
        content: 'line one\nline two',
        totalCharCount: 17,
        totalLineCount: 2,
      });
    });

    it('writes the editor snapshot alone', () => {
      const update = buildBackingDocumentUpdate(ctx, { editorData: { root: {} } });

      expect(update).toEqual({ editorData: { root: {} } });
    });

    it('writes the file type alone', () => {
      const update = buildBackingDocumentUpdate(ctx, { fileType: 'article' });

      expect(update).toEqual({ fileType: 'article' });
    });
  });

  describe('binding guards', () => {
    it('returns undefined for a binding outside the scope', async () => {
      await expect(
        agentDocumentModel.updateDocumentIdentity(missingBindingId, { title: 'Renamed' }),
      ).resolves.toBeUndefined();
      await expect(agentDocumentModel.rename(missingBindingId, 'Renamed')).resolves.toBeUndefined();
      await expect(
        agentDocumentModel.movePath(missingBindingId, { filename: 'moved.md', parentId: null }),
      ).resolves.toBeUndefined();
      await expect(
        agentDocumentModel.updateToolLoadRule(missingBindingId, { mode: 'manual' }),
      ).resolves.toBeUndefined();
      await expect(
        agentDocumentModel.updateEditorSnapshotIfUnchanged(
          missingBindingId,
          { content: 'a', editorData: null },
          { content: 'b', editorData: { root: {} } },
        ),
      ).resolves.toBe(false);
    });

    it('writes the repaired snapshot when the read values still match', async () => {
      const bindingId = await seedBinding();

      const written = await agentDocumentModel.updateEditorSnapshotIfUnchanged(
        bindingId,
        { content: 'seeded content', editorData: null },
        { content: 'seeded content\nline two', editorData: { root: {} } },
      );

      expect(written).toBe(true);
    });

    it('refuses to overwrite a snapshot that moved on since it was read', async () => {
      const bindingId = await seedBinding();

      const written = await agentDocumentModel.updateEditorSnapshotIfUnchanged(
        bindingId,
        { content: 'seeded content', editorData: { root: {} } },
        { content: 'rewritten content', editorData: { root: {} } },
      );

      expect(written).toBe(false);
    });

    it('leaves the binding untouched when the new title or filename is blank', async () => {
      const bindingId = await seedBinding();

      const renamed = await agentDocumentModel.rename(bindingId, '   ');
      expect(renamed?.id).toBe(bindingId);
      expect(renamed?.documentId).toBeDefined();

      const moved = await agentDocumentModel.movePath(bindingId, {
        filename: '   ',
        parentId: null,
      });
      expect(moved?.id).toBe(bindingId);
    });
  });
});
