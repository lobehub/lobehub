import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { DataImporterRepos } from '@/database/repositories/dataImporter';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { type ImportPgDataStructure } from '@/types/export';
import { type ImporterEntryData, type ImportResultData } from '@/types/importer';

const importProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      dataImporterService: new DataImporterRepos(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
    },
  });
});

export const importerRouter = router({
  importByFile: importProcedure
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      let data: ImporterEntryData | undefined;

      try {
        const dataStr = await ctx.fileService.getFileContent(input.pathname);
        data = JSON.parse(dataStr);
      } catch {
        data = undefined;
      }

      if (!data) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to read file at ${input.pathname}`,
        });
      }

      let result: ImportResultData;
      if ('schemaHash' in data) {
        result = await ctx.dataImporterService.importPgData(
          data as unknown as ImportPgDataStructure,
        );
      } else {
        result = await ctx.dataImporterService.importData(data);
      }

      // clean file after upload
      await ctx.fileService.deleteFile(input.pathname);

      return result;
    }),

  importByPost: importProcedure
    .input(
      z.object({
        data: z.object({
          messages: z.array(z.any()).optional(),
          sessionGroups: z.array(z.any()).optional(),
          sessions: z.array(z.any()).optional(),
          topics: z.array(z.any()).optional(),
          version: z.number(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      return ctx.dataImporterService.importData(input.data);
    }),
  importPgByPost: importProcedure
    .input(
      z.object({
        data: z.record(z.string(), z.array(z.any())),
        mode: z.enum(['pglite', 'postgres']),
        schemaHash: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      return ctx.dataImporterService.importPgData(input);
    }),
});
