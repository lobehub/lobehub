import { access } from 'node:fs/promises';
import path from 'node:path';

import type { TrpcClient } from '../api/client';
import { log } from '../utils/logger';
import { uploadLocalFile } from '../utils/uploadLocalFile';
import type { EvidenceType } from './verifyHelpers';
import {
  evidenceDescriptionForFile,
  evidenceTypeForFile,
  inlineTextEvidenceForFile,
  reportEvidence,
} from './verifyHelpers';

export interface FailedReportEvidence {
  checkResultId: string;
  error: string;
  fileId?: string;
  path: string;
  reason: 'file_missing' | 'storage_quota' | 'upload_failed';
  /** Arguments for lh via a process API with shell disabled, including subcommands. */
  retryArgs: string[];
  retryCommand: string;
  retryCommandShell: 'posix';
  type: EvidenceType;
}

/** Upload and attach independently: a failed artifact must not discard the report. */
export async function uploadReportEvidence(
  client: TrpcClient,
  params: { checkResultId: string; dir: string; evidence: unknown },
) {
  const failedEvidence: FailedReportEvidence[] = [];
  const types = new Set<EvidenceType>();
  let count = 0;
  let inlined = 0;
  for (const input of reportEvidence(params.evidence)) {
    const absolutePath = path.resolve(params.dir, input.path);
    const type = evidenceTypeForFile(absolutePath);
    const description = evidenceDescriptionForFile(input.description, absolutePath);
    const metadata = input.comparison ? { comparison: input.comparison } : undefined;
    let fileId: string | undefined;
    let missing = false;
    try {
      try {
        await access(absolutePath);
      } catch (error) {
        missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
        throw error;
      }
      const content = inlineTextEvidenceForFile(absolutePath, type);
      if (content === undefined) fileId = (await uploadLocalFile(client, absolutePath)).id;
      await client.verify.uploadEvidence.mutate({
        capturedBy: 'cli',
        checkResultId: params.checkResultId,
        content,
        description,
        fileId,
        metadata,
        type,
      });
      types.add(type);
      count += 1;
      if (content !== undefined) inlined += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = missing
        ? 'file_missing'
        : message.includes('storage_block:')
          ? 'storage_quota'
          : 'upload_failed';
      // Reuse an uploaded file if only attachment failed. Retrying must not
      // consume another logical file's worth of the user's storage quota.
      const args = [
        '--check',
        params.checkResultId,
        '--type',
        type,
        ...(fileId ? ['--file-id', fileId] : ['--file', absolutePath]),
        '--desc',
        description,
        ...(metadata ? ['--metadata', JSON.stringify(metadata)] : []),
      ];
      const retryCommand = `lh acceptance run evidence upload ${args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ')}`;
      failedEvidence.push({
        checkResultId: params.checkResultId,
        error: message,
        fileId,
        path: absolutePath,
        reason,
        retryArgs: ['acceptance', 'run', 'evidence', 'upload', ...args],
        retryCommand,
        retryCommandShell: 'posix',
        type,
      });
      log.warn(`evidence not published: ${path.basename(absolutePath)}: ${message}`);
    }
  }
  return { count, failedEvidence, inlined, types };
}
