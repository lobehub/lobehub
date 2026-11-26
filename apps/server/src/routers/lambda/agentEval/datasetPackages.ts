import type { AgentEvalDatasetPackagePreview } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import {
  AgentEvalDatasetPackageImportError,
  AgentEvalDatasetPackageRepo,
} from '@/database/repositories/agentEvalDatasetPackage';
import {
  getPackageConnectionRequirements,
  getReferencedPackageConnections,
  validatePackageConnectionSelections,
} from '@/database/repositories/agentEvalDatasetPackage/bindings';
import {
  DATASET_PACKAGE_MAX_COMPRESSED_BYTES,
  readDatasetPackageArchive,
} from '@/server/services/agentEvalDatasetPackage/archive';
import type { FileService } from '@/server/services/file';

import { validateEvalConnectorBindings } from './connectorBindings';
import { validateDatasetPackage } from './datasetPackageSchema';
import { agentEvalProcedureWrite } from './procedures';
import { evalConnectorBindingsSchema } from './schemas';

const log = debug('lobe-server:agentEvalDatasetPackage');

export const readDatasetPackageUpload = async (
  fileService: Pick<FileService, 'getFileMetadata' | 'getFileByteArray'>,
  pathname: string,
) => {
  const { contentLength } = await fileService.getFileMetadata(pathname);
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > DATASET_PACKAGE_MAX_COMPRESSED_BYTES
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Dataset ZIP exceeds the 10 MiB limit' });
  }
  return fileService.getFileByteArray(pathname);
};

export const parseDatasetPackage = (content: Uint8Array) => {
  const archive = readDatasetPackageArchive(content);
  return { package: validateDatasetPackage(archive.manifest), sha256: archive.sha256 };
};

export const previewDatasetPackage = (content: Uint8Array) => {
  const { package: pack } = parseDatasetPackage(content);
  const connectionRequirements = getPackageConnectionRequirements(pack);
  const datasetPackage: AgentEvalDatasetPackagePreview = {
    caseCount: pack.cases.length,
    connectionRequirements,
    description: pack.dataset.description,
    environmentCount: pack.environments.length,
    embeddedConnections: getReferencedPackageConnections(pack).map((key) => ({
      authConfigured: !!pack.connections?.[key]?.credentials,
      key,
      name: pack.connections![key].name,
    })),
    mockServices: [
      ...new Set(connectionRequirements.flatMap((requirement) => requirement.services)),
    ].sort(),
    name: pack.dataset.name,
    release: pack.dataset.metadata?.release,
    version: pack.version,
  };
  return {
    datasetPackage,
    format: 'zip' as const,
    headers: [] as string[],
    preview: pack.cases.slice(0, 50).map(({ content }) => ({
      category: content.category,
      expected: content.expected,
      input: content.input,
    })),
    totalCount: pack.cases.length,
  };
};

export const importDatasetPackageProcedure = agentEvalProcedureWrite
  .input(
    z
      .object({
        benchmarkId: z.string().min(1).optional(),
        caseBindings: z.record(z.string().min(1), evalConnectorBindingsSchema).optional(),
        datasetId: z.string().min(1).optional(),
        environmentBindings: z.record(z.string().min(1), evalConnectorBindingsSchema).optional(),
        filename: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        pathname: z.string().min(1),
      })
      .refine((value) => !value.datasetId || !value.benchmarkId, {
        message: 'Choose an existing dataset or a destination benchmark, not both',
      }),
  )
  .mutation(async ({ input, ctx }) => {
    const upload = await ctx.fileUploadService.assertActiveOrLegacy(input.pathname);
    const content = await readDatasetPackageUpload(ctx.fileService, input.pathname);
    let parsed: ReturnType<typeof parseDatasetPackage>;
    try {
      parsed = parseDatasetPackage(content);
    } catch (error) {
      log('Package validation rejected: %s', error instanceof Error ? error.name : 'unknown');
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid dataset package',
      });
    }
    try {
      const bindings = {
        caseBindings: input.caseBindings,
        environmentBindings: input.environmentBindings,
      };
      validatePackageConnectionSelections(parsed.package, bindings);
      for (const selection of [
        ...Object.values(bindings.environmentBindings ?? {}),
        ...Object.values(bindings.caseBindings ?? {}),
      ])
        await validateEvalConnectorBindings(
          ctx.evalConnectorServiceForDataset,
          selection,
          input.datasetId,
        );
      const repo = new AgentEvalDatasetPackageRepo(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
        ctx.evalConnectorGateKeeper,
      );
      const result = await repo.importPackage({
        benchmarkId: input.benchmarkId,
        bindings,
        datasetId: input.datasetId,
        name: input.name,
        ...parsed,
      });
      log(
        'Imported package %s: dataset=%s cases=%d environments=%d',
        parsed.sha256,
        result.datasetId,
        result.count,
        result.environmentCount,
      );
      // Keep a failed import retryable. Cleanup must never turn a committed import into an error.
      if (upload) await ctx.fileUploadService.releaseBestEffort(input.pathname);
      else
        await ctx.fileService.deleteFile(input.pathname).catch(() => {
          log('Legacy upload cleanup failed after import: dataset=%s', result.datasetId);
        });
      return result;
    } catch (error) {
      log(
        'Package import failed: sha256=%s type=%s',
        parsed.sha256,
        error instanceof Error ? error.name : 'unknown',
      );
      if (error instanceof AgentEvalDatasetWriteError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
      }
      if (error instanceof AgentEvalDatasetPackageImportError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }
  });
