import { AGENT_DOCUMENT_CATEGORY } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import matter from 'gray-matter';
import { z } from 'zod';

import { deriveAgentDocumentFields } from '@/database/models/agentDocuments';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import { getUnifiedSkillNamespaceRootPath } from '@/server/services/agentDocumentVfs/mounts/skills/path';

import { agentDocumentProcedureWrite, handleAgentDocumentVfsError } from './procedures';

const mountedSkillNamespaceSchema = z.literal('agent');

const createMountedSkillSchema = z.object({
  agentId: z.string(),
  content: z.string(),
  skillName: z.string().min(1),
  targetNamespace: mountedSkillNamespaceSchema,
});

const deleteMountedSkillSchema = z.object({
  agentId: z.string(),
  path: z.string(),
});

const updateMountedSkillSchema = z.object({
  agentId: z.string(),
  content: z.string(),
  path: z.string(),
});

/**
 * Strips a leading YAML frontmatter block from Markdown so it can be re-fed as
 * `bodyMarkdown` to the skill-management service (which renders its own
 * frontmatter and rejects bodies that already contain one).
 */
const stripLeadingFrontmatter = (content: string): string => {
  try {
    const parsed = matter(content);
    return parsed.matter ? parsed.content.trimStart() : content;
  } catch {
    return content;
  }
};

const convertSkillErrorToTRPC = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;

  if (error instanceof Error) {
    if (/already exists/i.test(error.message)) {
      throw new TRPCError({ cause: error, code: 'CONFLICT', message: error.message });
    }
    if (/invalid skill name|required|frontmatter/i.test(error.message)) {
      throw new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message });
    }
  }

  throw error;
};

/**
 * Resolve the markdown body of a document that is eligible to become a skill.
 *
 * Shared by `convertDocumentToSkill` and `generateSkillMeta`. Rejects missing
 * documents, and — same as the convert path — folders, web sources, and
 * managed skill bundle/index rows. `createSkill` reparents the source row under
 * a new bundle, so converting an existing skill index would strip its original
 * bundle of its SKILL.md and corrupt it. The UI hides the action for these, but
 * a stale/scripted client could still call through, so enforce it server-side.
 */
const resolveConvertibleDocumentBody = async (
  service: AgentDocumentsService,
  agentId: string,
  sourceAgentDocumentId: string,
): Promise<string> => {
  const source = await service.getDocumentById(sourceAgentDocumentId, agentId);

  if (!source) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Source document not found' });
  }

  const { category, isFolder } = deriveAgentDocumentFields(source);
  if (category !== AGENT_DOCUMENT_CATEGORY || isFolder) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only a plain agent document can be converted into a skill',
    });
  }

  const bodyMarkdown = stripLeadingFrontmatter(source.content ?? '').trim();

  if (!bodyMarkdown) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Cannot convert an empty document into a skill',
    });
  }

  return bodyMarkdown;
};

export const skillsProcedures = {
  createSkillByPath: agentDocumentProcedureWrite
    .input(createMountedSkillSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const path = `${getUnifiedSkillNamespaceRootPath(input.targetNamespace)}/${input.skillName}`;

        return await ctx.agentDocumentVfsService.write(
          path,
          input.content,
          {
            agentId: input.agentId,
          },
          { createMode: 'always-new' },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Converts an existing agent document into a managed skill (direct migration).
   *
   * The source document row is reused as the skill's `SKILL.md` index (its
   * `documents.id` / `agent_documents.id` are preserved), and a new
   * `skills/bundle` parent is created to hold it. After this call the original
   * document no longer appears at its previous location in the tree.
   */
  convertDocumentToSkill: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        description: z.string().trim().min(1),
        name: z.string().trim().min(1),
        sourceAgentDocumentId: z.string(),
        title: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bodyMarkdown = await resolveConvertibleDocumentBody(
        ctx.agentDocumentService,
        input.agentId,
        input.sourceAgentDocumentId,
      );

      try {
        return await ctx.skillManagementService.createSkill({
          agentId: input.agentId,
          bodyMarkdown,
          description: input.description,
          name: input.name,
          sourceAgentDocumentId: input.sourceAgentDocumentId,
          title: input.title,
        });
      } catch (error) {
        return convertSkillErrorToTRPC(error);
      }
    }),
  /**
   * Generates skill metadata (name / title / description) from a document's
   * content, used to prefill the convert-to-skill form. Does not mutate the
   * document; returns `null` when generation fails so the caller can fall back
   * to its own defaults.
   */
  generateSkillMeta: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        sourceAgentDocumentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bodyMarkdown = await resolveConvertibleDocumentBody(
        ctx.agentDocumentService,
        input.agentId,
        input.sourceAgentDocumentId,
      );

      return ctx.systemAgentService.generateSkillMeta({
        agentId: input.agentId,
        content: bodyMarkdown,
      });
    }),
  updateSkillByPath: agentDocumentProcedureWrite
    .input(updateMountedSkillSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.write(
          input.path,
          input.content,
          {
            agentId: input.agentId,
          },
          { createMode: 'must-exist' },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  deleteSkillByPath: agentDocumentProcedureWrite
    .input(deleteMountedSkillSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.agentDocumentVfsService.delete(input.path, {
          agentId: input.agentId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
};
