import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainExpertiseRuleDistill,
  EXPERTISE_RULE_DISTILL_JSON_SCHEMA,
  EXPERTISE_RULE_DISTILL_PROMPT_VERSION,
  sliceHead,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { DocumentModel } from '@/database/models/document';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { DocumentService } from '@/server/services/document';

import { resolveExpertiseModelConfig } from './modelConfig';

/**
 * How much of a material the model reads. A guideline or a long conversation fits; past this the
 * tail is dropped and the result says so, rather than the request failing on the provider.
 */
const MATERIAL_MAX_CHARS = 60_000;
/** One message of a conversation, so a single pasted log cannot crowd out the reviewer's words. */
const MESSAGE_MAX_CHARS = 2000;
/** Messages read from a conversation, oldest first. */
const TOPIC_MAX_MESSAGES = 400;

export const DistillSourceSchema = z.discriminatedUnion('type', [
  z.object({
    text: z.string().min(1).max(200_000),
    title: z.string().max(200).optional(),
    type: z.literal('text'),
  }),
  z.object({ id: z.string().min(1), type: z.literal('document') }),
  z.object({ id: z.string().min(1), type: z.literal('file') }),
  z.object({ id: z.string().min(1), type: z.literal('topic') }),
]);

export type DistillSource = z.infer<typeof DistillSourceSchema>;

/**
 * How much of the prompt the reviewer's existing groups and rules may take, so a large part (or a
 * crafted request) cannot crowd out the material or run up the model bill. Groups go first, then
 * rules in the order sent (the page's order); whatever does not fit is left out of the comparison.
 */
const CATALOG_MAX_CHARS = 30_000;

export const DistillRulesInputSchema = z.object({
  /** The groups of the part the rules will be filed into, so candidates can be sorted there. */
  groups: z
    .array(
      z.object({
        gate: z.string().max(1000),
        id: z.string().max(128),
        title: z.string().max(200),
      }),
    )
    .max(200),
  /** The rules already in that part, so a restatement is flagged instead of filed twice. */
  rules: z.array(z.object({ id: z.string().max(128), title: z.string().max(500) })).max(2000),
  source: DistillSourceSchema,
});

/** The leading items whose rendered lines fit in `budget` characters. */
const fitCatalog = <T>(items: T[], size: (item: T) => number, budget: number) => {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    used += size(item);
    if (used > budget) break;
    kept.push(item);
  }
  return { kept, used };
};

export type DistillRulesInput = z.infer<typeof DistillRulesInputSchema>;

const nullableText = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null);

const DistillResultSchema = z.object({
  rules: z.array(
    z.object({
      compilability: z
        .enum(['compiled', 'compilable', 'not-compilable'])
        .transform((value) => (value === 'compiled' ? 'compilable' : value)),
      duplicateOf: z.string().nullable(),
      enforcement: z.enum(['block', 'remind']),
      groupId: z.string().nullable(),
      how: nullableText,
      limits: nullableText,
      newGroup: z.object({ gate: z.string().min(1), title: z.string().min(1).max(60) }).nullable(),
      quote: z.string().transform((value) => value.trim()),
      title: z.string().min(1).max(200),
      why: nullableText,
    }),
  ),
});

/** Which material a distillation read, as the commit step needs to record it. */
export interface DistillMaterial {
  /** What the commit records as the run's subject; a file is recorded as its parsed document. */
  subjectId: string | null;
  subjectType: 'document' | 'standalone' | 'topic';
  title: string;
  /** Whether the tail of the material was left unread. */
  truncated: boolean;
  type: DistillSource['type'];
}

/**
 * Reads a material the reviewer brought and proposes every rule it states, for them to tick.
 * Nothing is written here: the candidates come back with the material they were read from, and
 * only the commit step files the ones the reviewer kept.
 */
export class ExpertiseRuleDistillService {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /** The material's text and how its origin is recorded, read within the caller's scope. */
  resolveMaterial = async (
    source: DistillSource,
  ): Promise<{ material: Omit<DistillMaterial, 'truncated'>; text: string }> => {
    switch (source.type) {
      case 'text': {
        const text = source.text.trim();
        // The first line names it, without the Markdown heading marks a pasted guideline starts with.
        const firstLine = (text.split('\n')[0] ?? '').replace(/^#+\s*/, '');
        const title = source.title?.trim() || sliceHead(firstLine, 40);
        return {
          material: { subjectId: null, subjectType: 'standalone', title, type: 'text' },
          text,
        };
      }
      case 'document': {
        const doc = await new DocumentModel(this.db, this.userId, this.workspaceId).findById(
          source.id,
        );
        if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
        return {
          material: {
            subjectId: doc.id,
            subjectType: 'document',
            title: doc.title || doc.filename || '',
            type: 'document',
          },
          text: doc.content ?? '',
        };
      }
      case 'file': {
        // Parsing is idempotent: a file already read for chat or the library is not read again.
        const doc = await new DocumentService(this.db, this.userId, this.workspaceId).parseFile(
          source.id,
        );
        return {
          material: {
            subjectId: doc.id,
            subjectType: 'document',
            title: doc.filename,
            type: 'file',
          },
          text: doc.content ?? '',
        };
      }
      case 'topic': {
        const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(
          source.id,
        );
        if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
        const { items } = await new MessageModel(
          this.db,
          this.userId,
          this.workspaceId,
        ).queryTopicTranscript({ limit: TOPIC_MAX_MESSAGES, offset: 0, topicId: source.id });
        const text = items
          .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content)
          .map(
            (item) =>
              `${item.role === 'user' ? 'Reviewer' : 'Assistant'}: ${sliceHead(item.content!.trim(), MESSAGE_MAX_CHARS)}`,
          )
          .join('\n\n');
        return {
          material: {
            subjectId: topic.id,
            subjectType: 'topic',
            title: topic.title ?? '',
            type: 'topic',
          },
          text,
        };
      }
    }
  };

  distillRules = async (input: DistillRulesInput) => {
    const { material, text } = await this.resolveMaterial(input.source);
    if (!text.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'The material has no readable text' });
    }
    const read = sliceHead(text, MATERIAL_MAX_CHARS);
    const fittedGroups = fitCatalog(
      input.groups,
      (group) => group.id.length + group.title.length + group.gate.length + 10,
      CATALOG_MAX_CHARS,
    );
    const { kept: rules } = fitCatalog(
      input.rules,
      (rule) => rule.id.length + rule.title.length + 6,
      CATALOG_MAX_CHARS - fittedGroups.used,
    );
    const groups = fittedGroups.kept;

    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const result = DistillResultSchema.parse(
      await ai.generateObject(
        {
          ...chainExpertiseRuleDistill({
            groups,
            material: { kind: material.type, text: read, title: material.title },
            rules,
          }),
          ...modelConfig,
          schema: EXPERTISE_RULE_DISTILL_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.Expertise },
          tracing: {
            promptVersion: EXPERTISE_RULE_DISTILL_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.ExpertiseRuleDistill,
            schemaName: EXPERTISE_RULE_DISTILL_JSON_SCHEMA.name,
          },
        },
      ),
    );

    // Ids the model names but the reviewer does not have are slips, not requests.
    const groupIds = new Set(groups.map((group) => group.id));
    const ruleIds = new Set(rules.map((rule) => rule.id));
    return {
      candidates: result.rules.map((rule) => {
        const groupId = rule.groupId && groupIds.has(rule.groupId) ? rule.groupId : null;
        return {
          ...rule,
          duplicateOf: rule.duplicateOf && ruleIds.has(rule.duplicateOf) ? rule.duplicateOf : null,
          groupId,
          newGroup: groupId ? null : rule.newGroup,
        };
      }),
      material: { ...material, truncated: read.length < text.length } satisfies DistillMaterial,
    };
  };
}
