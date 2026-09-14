import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { eq } from 'drizzle-orm';

import {
  DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH,
  DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN,
  DocumentCollaborationStateModel,
} from '../../packages/database/src/models/documentCollaborationState';
import { documents } from '../../packages/database/src/schemas';
import type { LobeChatDatabase } from '../../packages/database/src/type';
import { installPageCollaborationYjsSingleton } from './start.ts';

export interface SeedSnapshotCliOptions {
  apply: boolean;
  documentId: string | null;
  help: boolean;
}

const usage = `Usage:
  bun run page-collaboration:seed -- --document-id <documentId>
  bun run page-collaboration:seed -- --apply --document-id <documentId>

The default is a read-only dry-run. --apply is required before any ledger write.
This command never changes documents.content, documents.editor_data, or history rows.`;

export const parseSeedSnapshotArgs = (args: string[]): SeedSnapshotCliOptions => {
  let apply = false;
  let documentId: string | null = null;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--document-id') {
      const value = args[index + 1]?.trim();
      if (!value || value.startsWith('--')) throw new Error('Missing value for --document-id.');
      documentId = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--document-id=')) {
      const value = argument.slice('--document-id='.length).trim();
      if (!value) throw new Error('Missing value for --document-id.');
      documentId = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!help && !documentId) throw new Error('--document-id is required.');
  return { apply, documentId, help };
};

const BASE64_PATTERN = /^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i;

const decodeBase64 = (value: string, label: string): Uint8Array => {
  if (value.length % 4 === 1 || !BASE64_PATTERN.test(value)) {
    throw new Error(`${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: invalid ${label}`);
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
};

const describeBytes = (value: Uint8Array): string =>
  `${value.byteLength} bytes sha256=${createHash('sha256').update(value).digest('hex')}`;

const describeVersion = (version: {
  roomId?: string;
  roomRevision: number;
  snapshotUpdate: string | null;
  stateVector: string;
  versionToken: string;
  documentUpdatedAt: Date;
  persistedDocumentUpdatedAt: Date | null;
}) => {
  const snapshot =
    version.snapshotUpdate === null
      ? 'missing'
      : describeBytes(decodeBase64(version.snapshotUpdate, 'ledger snapshot update'));
  const stateVector = describeBytes(decodeBase64(version.stateVector, 'ledger state vector'));
  return {
    documentUpdatedAt: version.documentUpdatedAt.toISOString(),
    ledgerDocumentUpdatedAt: version.persistedDocumentUpdatedAt?.toISOString() ?? null,
    roomId: version.roomId ?? null,
    roomRevision: version.roomRevision,
    snapshot,
    stateVector,
    versionToken:
      version.versionToken === DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN
        ? 'absent'
        : `${version.versionToken.slice(0, 8)}…`,
  };
};

export interface SeedSnapshotResult {
  action: 'already-durable' | 'dry-run' | 'seeded';
  candidateStateVector: Uint8Array | null;
  candidateUpdate: Uint8Array | null;
  documentId: string;
  ledger: ReturnType<typeof describeVersion>;
  seedStatus?: 'existing' | 'seeded';
}

export const seedDocumentCollaborationSnapshot = async (
  db: LobeChatDatabase,
  options: { apply: boolean; documentId: string },
): Promise<SeedSnapshotResult> => {
  const [document] = await db
    .select({
      content: documents.content,
      documentId: documents.id,
      editorData: documents.editorData,
      updatedAt: documents.updatedAt,
      userId: documents.userId,
      workspaceId: documents.workspaceId,
    })
    .from(documents)
    .where(eq(documents.id, options.documentId))
    .limit(1);
  if (!document) throw new Error(`Document not found: ${options.documentId}`);

  const model = new DocumentCollaborationStateModel(db, document.userId, document.workspaceId);
  const version = await model.readVersion(document.documentId);
  const ledger = describeVersion(version);

  if (version.versionToken !== DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN) {
    if (
      !version.persistedDocumentUpdatedAt ||
      version.persistedDocumentUpdatedAt.getTime() !== document.updatedAt.getTime()
    ) {
      throw new Error(
        `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: document projection is newer than the collaboration ledger`,
      );
    }
    if (version.snapshotUpdate !== null) {
      return {
        action: 'already-durable',
        candidateStateVector: null,
        candidateUpdate: null,
        documentId: document.documentId,
        ledger,
      };
    }
  }

  const { createImmutableRoomSnapshotFromEditorData } =
    await import('../../apps/server/src/services/documentCollaboration/headlessExporter');
  const candidate = await createImmutableRoomSnapshotFromEditorData({
    content: document.content,
    editorData: document.editorData,
    revision: version.roomRevision,
    roomId: document.documentId,
  });
  const candidateStateVector = new Uint8Array(candidate.stateVector);
  const candidateUpdate = new Uint8Array(candidate.update);
  if (!options.apply) {
    return {
      action: 'dry-run',
      candidateStateVector,
      candidateUpdate,
      documentId: document.documentId,
      ledger,
    };
  }

  const seeded = await model.seedSnapshot({
    documentId: document.documentId,
    expected: version,
    seed: {
      roomId: document.documentId,
      roomRevision: version.roomRevision,
      snapshotUpdate: Buffer.from(candidateUpdate).toString('base64'),
      stateVector: Buffer.from(candidateStateVector).toString('base64'),
    },
  });
  return {
    action: 'seeded',
    candidateStateVector,
    candidateUpdate,
    documentId: document.documentId,
    ledger,
    seedStatus: seeded.status,
  };
};

const printResult = (result: SeedSnapshotResult, options: SeedSnapshotCliOptions): void => {
  console.info(`[page-collaboration] document=${result.documentId}`);
  console.info(`[page-collaboration] ledger=${JSON.stringify(result.ledger)}`);
  if (result.action === 'already-durable') {
    console.info('[page-collaboration] durable snapshot already exists; no write performed');
    return;
  }
  console.info(
    `[page-collaboration] candidate stateVector=${describeBytes(result.candidateStateVector!)} update=${describeBytes(result.candidateUpdate!)}`,
  );
  if (result.action === 'dry-run') {
    console.info(
      '[page-collaboration] DRY-RUN: no database write. Re-run with --apply after backup and version review.',
    );
    return;
  }
  console.info(
    `[page-collaboration] seed completed status=${result.seedStatus}; apply=${options.apply}`,
  );
};

export const runSeedSnapshotCli = async (args: string[] = process.argv.slice(2)): Promise<void> => {
  const options = parseSeedSnapshotArgs(args);
  if (options.help) {
    console.info(usage);
    return;
  }
  await installPageCollaborationYjsSingleton();
  const { getServerDB } = await import('../../packages/database/src/core/db-adaptor');
  const db = await getServerDB();
  try {
    const result = await seedDocumentCollaborationSnapshot(db, {
      apply: options.apply,
      documentId: options.documentId!,
    });
    printResult(result, options);
  } finally {
    const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    await client?.end?.();
  }
};

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  runSeedSnapshotCli().catch((error) => {
    console.error('[page-collaboration] snapshot seed failed', error);
    process.exitCode = 1;
  });
}
