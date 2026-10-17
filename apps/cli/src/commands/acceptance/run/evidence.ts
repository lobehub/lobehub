import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { outputJson, printTable, truncate } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { assertReportLanguage, evidenceCaptionFields } from '../language';
import {
  evidenceDescriptionForFile,
  evidenceMetadataFromOptions,
  inlineTextEvidenceForFile,
} from '../utils';
import { uploadAcceptanceFile } from './evidenceUpload';

// ── evidence ──

export interface EvidenceUploadOptions {
  by?: string;
  chapters?: string;
  check: string;
  content?: string;
  desc?: string;
  file?: string;
  fileId?: string;
  json?: boolean | string;
  metadata?: string;
  type: string;
}

export async function evidenceUploadAction(options: EvidenceUploadOptions): Promise<void> {
  if ([options.file, options.content, options.fileId].filter(Boolean).length !== 1) {
    log.error('Provide exactly one of --file, --file-id or --content');
    process.exit(1);
  }
  const metadata = evidenceMetadataFromOptions(options);
  const client = await getTrpcClient();
  await assertReportLanguage(client, [
    { path: '--desc', text: options.desc },
    ...evidenceCaptionFields(options.chapters ? '--chapters' : '--metadata', metadata),
  ]);
  let fileId = options.fileId;
  let inlineContent = options.content;
  if (options.file) {
    inlineContent = inlineTextEvidenceForFile(options.file, options.type);
    if (inlineContent === undefined) {
      const uploaded = await uploadAcceptanceFile(client, options.file, options.json);
      if (!uploaded) return;
      fileId = uploaded.id;
    }
  }
  const ev = await client.verify.uploadEvidence.mutate({
    capturedBy: options.by as any,
    checkResultId: options.check,
    content: inlineContent,
    description: evidenceDescriptionForFile(options.desc, options.file),
    fileId,
    metadata,
    type: options.type as any,
  });
  if (options.json !== undefined) {
    outputJson(ev, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Evidence ${pc.bold(ev.id)}${fileId ? ` (file ${fileId})` : ''}`);
}

export async function evidenceListAction(
  checkResultId: string,
  options: { json?: boolean | string },
): Promise<void> {
  const client = await getTrpcClient();
  const rows = await client.verify.listEvidence.query({ checkResultId });
  if (options.json !== undefined) {
    outputJson(rows, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (rows.length === 0) return void console.log('No evidence.');
  printTable(
    rows.map((e: any) => [
      e.id,
      e.type,
      e.capturedBy ?? '',
      e.fileId ? 'file' : 'inline',
      truncate(e.description || '', 40),
    ]),
    ['ID', 'TYPE', 'BY', 'PAYLOAD', 'DESC'],
  );
}

export async function evidenceDeleteAction(
  evidenceId: string,
  options: { json?: boolean | string },
): Promise<void> {
  const client = await getTrpcClient();
  const result = await client.verify.deleteEvidence.mutate({ id: evidenceId });
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Deleted evidence ${pc.bold(result.id)}`);
}

export function withEvidenceUploadOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--check <checkResultId>', 'Target check result id')
    .requiredOption(
      '--type <type>',
      'screenshot|gif|video|audio|text|markdown|dom_snapshot|transcript',
    )
    .option('--file <path>', 'Local file to upload as the artifact')
    .option('--file-id <id>', 'Attach an already-uploaded file without uploading it again')
    .option('--content <text>', 'Inline text payload (instead of a file)')
    .option('--metadata <json>', 'Evidence metadata, preserved when retrying an attachment')
    .option('--chapters <file>', 'Video chapters JSON (steps, checks, flags on the timeline)')
    .option('--by <capturedBy>', 'agent-browser|cdp|cli|program|llm_judge', 'cli')
    .option('--desc <text>', 'Human-readable caption')
    .option('--json [fields]', 'Output JSON');
}
