import { SkillManifest, skillManifestSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import {
  SkillImportError,
  SkillImporter,
  SkillResourceError,
  SkillResourceService,
} from '@/server/services/skill';

// ===== Error Handling =====

const skillImportErrorToTRPCCode = (
  code: SkillImportError['code'],
): 'CONFLICT' | 'BAD_REQUEST' | 'NOT_FOUND' | 'BAD_GATEWAY' => {
  switch (code) {
    case 'CONFLICT': {
      return 'CONFLICT';
    }

    case 'NOT_FOUND':
    case 'FILE_NOT_FOUND': {
      return 'NOT_FOUND';
    }

    case 'DOWNLOAD_FAILED': {
      return 'BAD_GATEWAY';
    }

    default: {
      return 'BAD_REQUEST';
    }
  }
};

const handleSkillImportError = (error: unknown): never => {
  if (error instanceof SkillImportError) {
    throw new TRPCError({
      code: skillImportErrorToTRPCCode(error.code),
      message: error.message,
    });
  }
  throw error;
};

// ===== Procedure with Context =====

const skillProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      skillImporter: new SkillImporter(ctx.serverDB, ctx.userId),
      skillModel: new AgentSkillModel(ctx.serverDB, ctx.userId),
      skillResourceService: new SkillResourceService(ctx.serverDB, ctx.userId),
    },
  });
});

// ===== Input Schemas =====

const createSkillSchema = z.object({
  content: z.string(),
  description: z.string().min(1),
  identifier: z.string().optional(),
  name: z.string().min(1),
});

const updateSkillSchema = z.object({
  content: z.string().optional(),
  id: z.string(),
  // All metadata should be passed through manifest
  manifest: skillManifestSchema.partial().optional(),
});

// ===== Router =====

export const agentSkillsRouter = router({
  // ===== Create =====

  create: skillProcedure.input(createSkillSchema).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.skillImporter.createUserSkill(input);
    } catch (error) {
      handleSkillImportError(error);
    }
  }),

  // ===== Delete =====

  delete: skillProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    return ctx.skillModel.delete(input.id);
  }),

  // ===== Query =====

  getById: skillProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findById(input.id);
  }),

  getByIdWithZipUrl: skillProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.zipFileHash) {
        return { name: skill.name, url: null };
      }

      const fileInfo = await ctx.fileModel.checkHash(skill.zipFileHash);
      if (!fileInfo.isExist || !fileInfo.url) {
        return { name: skill.name, url: null };
      }

      const fullUrl = await ctx.fileService.getFullFileUrl(fileInfo.url);
      return { name: skill.name, url: fullUrl || null };
    }),

  getByIdentifier: skillProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.skillModel.findByIdentifier(input.identifier);
    }),

  getByName: skillProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findByName(input.name);
  }),

  importFromGitHub: skillProcedure
    .input(
      z.object({
        branch: z.string().optional(),
        gitUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromGitHub(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromUrl: skillProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromUrl(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromZip: skillProcedure
    .input(z.object({ zipFileId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromZip(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  list: skillProcedure
    .input(
      z
        .object({
          source: z.enum(['builtin', 'market', 'user']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.source) {
        return ctx.skillModel.listBySource(input.source);
      }

      return ctx.skillModel.findAll();
    }),

  listResources: skillProcedure
    .input(z.object({ id: z.string(), includeContent: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources) {
        return [];
      }

      return ctx.skillResourceService.listResources(skill.resources, input.includeContent);
    }),

  readResource: skillProcedure
    .input(
      z.object({
        id: z.string(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources || Object.keys(skill.resources).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Skill has no resources' });
      }

      try {
        return await ctx.skillResourceService.readResource(skill.resources, input.path);
      } catch (error) {
        if (error instanceof SkillResourceError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }

        throw error;
      }
    }),

  search: skillProcedure.input(z.object({ query: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.search(input.query);
  }),

  // ===== Update =====

  update: skillProcedure.input(updateSkillSchema).mutation(async ({ ctx, input }) => {
    const { id, content, manifest } = input;
    return ctx.skillModel.update(id, {
      content,
      // Sync name/description from manifest to top-level fields
      description: manifest?.description,
      manifest: manifest as SkillManifest | undefined,
      name: manifest?.name,
    });
  }),
});

export type AgentSkillsRouter = typeof agentSkillsRouter;
