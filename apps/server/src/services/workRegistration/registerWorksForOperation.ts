import { createHash } from 'node:crypto';

import { isParkedStatus } from '@lobechat/agent-runtime';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  classifyEditedFile,
  CLOUD_SANDBOX_IDENTIFIER,
  type EditedFileEntry,
  type FileEditToolCallRecord,
  getBasename,
  normalizeScanPath,
  scanOperationFileEdits,
} from '@lobechat/builtin-tools/fileEditScan';
import type { WorkVersionCumulativeUsage, WorkVersionMetadata } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import { type LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { createSandboxService } from '@/server/services/sandbox';

import { UNEXECUTED_INTERVENTION_STATUSES } from './constants';
import { registerShellWorks } from './shellWorkRegistration';

const log = debug('lobe-server:file-work-registration');

/** One tool call gathered from the operation tree, tagged for ordering + provenance. */
type ScannedRecord = FileEditToolCallRecord & { content?: string; createdAt: Date; id: string };

/** The last-edit tool call for a file, used as the version's provenance. */
interface FileProvenance {
  apiName: string;
  identifier: string;
  messageId: string;
}

export interface RegisterWorksForOperationParams {
  /**
   * The round's final assistant message. When the shell Work scan registers a
   * Work, the anchor stamp (`metadata.work.rootOperationId`) is merged onto this
   * message so the Works chip renders — heterogeneous runs never pass
   * `callLlmFinalizer`, which stamps the anchor for in-process runs.
   */
  assistantMessageId?: string | null;
  /**
   * Terminal in-memory cost blob of the completing operation (`state.cost`).
   *
   * Pass it when available: on the pre-snapshot registration path the
   * `agent_operations` row's cost/usage columns are NOT persisted yet
   * (`recordCompletion` runs later in dispatchHooks), so reading the op row
   * alone would attach null (first completion) or stale (park/resume)
   * cumulative figures to the registered version.
   */
  finalCost?: { total?: number | null } | null;
  /** Terminal in-memory usage blob of the completing operation (`state.usage`). */
  finalUsage?: Record<string, unknown> | null;
  operationId: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Per-operation outcome of {@link registerWorksForOperation}. Lets the caller
 * decide whether the idempotency marker may be stamped: only a run with
 * `failed === 0` is complete. Files that were already registered (probe
 * short-circuit) or newly registered count as attempted successes; a failed
 * sandbox export or a thrown per-file chain counts as `failed`. Both counts
 * also fold in the shell Work scan (see `registerShellWorks`).
 */
export interface WorksRegistrationOutcome {
  /** Entity files + shell-scanned external entities this completion tried to register. */
  attempted: number;
  /** How many of `attempted` did not end up registered this round. */
  failed: number;
}

/**
 * Cap the per-entity export fanout. Each entity task fires a sandbox export + a
 * storage upload + DB writes, and the WHOLE batch is awaited before the terminal
 * snapshot is published, so unbounded parallelism on an operation touching
 * hundreds of files would hammer the sandbox / storage / DB and delay the
 * terminal snapshot (and thus perceived loading end). Keep a small ceiling.
 */
const FILE_WORK_EXPORT_CONCURRENCY = 5;

/**
 * Run `task` over `items` with at most `limit` tasks in flight, collecting
 * results in input order (a bounded `Promise.allSettled`). `task` is expected to
 * be self-guarded and never reject; a stray rejection is still captured as a
 * settled result so one item can never abort the batch. No `p-limit` dependency
 * exists in this workspace, so this tiny helper stands in for it.
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  // Index-assigned in worker order, so results stay aligned with `items`.
  const results: PromiseSettledResult<R>[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (error) {
        results[index] = { reason: error, status: 'rejected' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
};

/**
 * Integration seam for file-source deployment (artifact hosting).
 *
 * Called once per registered `file` Work version. The implementation — pushing
 * the exported entity file to a hosted, shareable location — is filled in by a
 * later change; today this is intentionally a no-op so the registration flow
 * and its call site are already in place.
 */
export const redeployFileWork = async (_params: {
  fileId?: string;
  fileUrl?: string;
  filePath: string;
  versionId: string | null;
  workId: string;
}): Promise<void> => {
  // No-op: file-source deployment is implemented in a follow-up.
};

/**
 * Sandbox location of a successful `exportFile` call, across both export
 * surfaces:
 * - `lobe-cloud-sandbox` exportFile — `state.path` IS the sandbox location.
 *   Unlike edits, an export carries no other success signal, so the persisted
 *   result state is required.
 * - `lobe-skills` exportFile — a skill flow (e.g. the pptx skill) routes ALL
 *   its tool calls through the skills tool, so its export is the only record
 *   carrying the artifact's path. Its state has NO `path` field (only
 *   fileId/filename/url…) and a FAILED export persists no state at all
 *   (`SkillsExecutionRuntime.exportFile` returns `success: false` without one),
 *   so state presence is the success signal and the path comes from the call
 *   arguments. A device-routed skills exportFile throws before producing a
 *   state, so a stateful row proves the file lives in THIS topic's cloud
 *   sandbox. (Skills runCommand/execScript rows enter the shell-command scan
 *   only when `state.executionEnv === 'device'` — those edits live on the
 *   device, never register as Works, and are surfaced by the client's
 *   edited-files card instead.)
 */
const resolveExportedSandboxPath = (
  record: Pick<ScannedRecord, 'arguments' | 'identifier' | 'state'>,
): string | undefined => {
  // Normalize the resolved path (same lexical rule the scanner applies to edit
  // paths) so an exported `/work/./deck.pptx` keys against an edited
  // `/work/deck.pptx` in the dedup below instead of registering a duplicate.
  if (record.identifier === CLOUD_SANDBOX_IDENTIFIER) {
    const state = record.state as { path?: unknown } | undefined;
    const path = typeof state?.path === 'string' ? state.path.trim() : '';
    return path ? normalizeScanPath(path) : undefined;
  }
  if (record.identifier === SkillsIdentifier) {
    if (typeof record.state !== 'object' || record.state === null) return undefined;
    try {
      const path: unknown = JSON.parse(record.arguments ?? '')?.path;
      const trimmed = typeof path === 'string' ? path.trim() : '';
      return trimmed ? normalizeScanPath(trimmed) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

/**
 * Collect every tool call of the operation tree, de-duplicated by message id and
 * ordered by the owning message's `createdAt` so the scanner's order-sensitive
 * folding resolves correctly across sub-operations.
 */
const collectOperationRecords = async (
  messageModel: MessageModel,
  tree: Awaited<ReturnType<AgentOperationModel['listOperationTree']>>,
): Promise<ScannedRecord[]> => {
  // Fetch every operation's plugin rows in parallel; `Promise.all` preserves the
  // tree order, so the first-seen-wins dedup below is identical to the previous
  // sequential loop (and the final sort makes ordering fully deterministic).
  const rowsPerOp = await Promise.all(
    tree.map((op) =>
      // A window needs at least the topic + start bound; ops missing either can't
      // be located (completedAt falls back to "now" inside the model method).
      op.topicId && op.startedAt
        ? messageModel.listMessagePluginsForOperation({
            completedAt: op.completedAt,
            operationId: op.id,
            startedAt: op.startedAt,
            threadId: op.threadId,
            topicId: op.topicId,
          })
        : Promise.resolve([]),
    ),
  );

  const byMessageId = new Map<string, ScannedRecord>();
  for (const rows of rowsPerOp) {
    for (const row of rows) {
      if (byMessageId.has(row.id)) continue;
      const interventionStatus = (row.intervention as { status?: string } | undefined)?.status;
      if (interventionStatus && UNEXECUTED_INTERVENTION_STATUSES.has(interventionStatus)) continue;
      byMessageId.set(row.id, {
        apiName: row.apiName ?? '',
        arguments: row.arguments,
        // Tool message text — claude-code Bash stdout for the github scan.
        content: row.content,
        createdAt: row.createdAt,
        // A plugin-level error means the edit never landed — the scanner skips
        // such records (mirrors the client's `tool.result?.error`).
        error: row.error,
        id: row.id,
        identifier: row.identifier,
        state: row.state,
        toolCallId: row.toolCallId ?? '',
      });
    }
  }

  return [...byMessageId.values()].sort((a, b) => {
    const delta = a.createdAt.getTime() - b.createdAt.getTime();
    return delta === 0 ? a.id.localeCompare(b.id) : delta;
  });
};

/**
 * On operation completion, scan every file edited during the operation (and its
 * sub-operations), and register each ENTITY-format file (pptx/xlsx/docx/pdf, …)
 * as a `file` Work — exactly one new version per operation, its content exported
 * from the sandbox and persisted so the version has a durable, fetchable URL.
 *
 * Contract:
 * - A ROOT operation scans the whole operation tree so a sub-agent's edits are
 *   captured, registering the tree exactly once. A SUB-op normally returns early
 *   (the root already covers it), EXCEPT an auto-repair op whose parent is
 *   already terminal — the parent will never re-scan, so the repair registers
 *   just its OWN edits (a new version). See the scan-scope block below.
 * - HTML / other files are skipped: HTML rides the artifact-hosting path and the
 *   rest fold into the frontend's aggregate "edited N files" card.
 * - Besides scanned EDITS, successfully `exportFile`-d entity paths register
 *   too: binary entity formats are produced by sandbox code execution (not by
 *   the text-based write/edit tools), so the export call is the only persisted
 *   record carrying their path. Both export surfaces count — the sandbox
 *   tool's `exportFile` and the skills tool's (`lobe-skills`) `exportFile`.
 * - `deleted` files are skipped (nothing to persist).
 * - One version per operation via the dedup key `op:${operationId}`; a retry of
 *   the same operation is idempotent — an existence probe short-circuits before
 *   re-exporting, and the `(workId, toolCallId)` unique guard backs it up.
 * - Best-effort per file: an export or registration failure for one file is
 *   logged and skipped, never aborting the others.
 *
 * Besides file Works, the SAME collected records feed the shell github Work
 * scan (`registerShellWorks`): heterogeneous CLI shells (codex /
 * claude-code) and the device `lobe-local-system` tool run `gh issue|pr
 * create/edit` outside the skill-tool registration hook, so their github
 * entities are recovered here at completion time and — for hetero runs, which
 * never pass `callLlmFinalizer` — the Work display anchor is stamped onto the
 * round's final assistant message.
 *
 * Returns a {@link WorksRegistrationOutcome} summary (`attempted` / `failed`)
 * so the caller can gate its idempotency marker: because each file is wrapped in
 * its own try/catch and folded through `mapWithConcurrency` (a bounded
 * allSettled), this function NEVER rejects on a per-file failure — the counts are
 * the only signal a caller has that some files did not register. A run with
 * `failed > 0` must leave the marker unset so a later call retries (the per-file
 * DB probe short-circuits the ones that already succeeded). The early no-op paths
 * (no topic / no records / no candidates) return `attempted: 0, failed: 0`.
 *
 * Awaited (not fire-and-forget) by the completion lifecycle so a serverless
 * response freeze can't drop the background write; the caller still swallows any
 * whole-function rejection so Work registration can never affect operation
 * completion.
 */
export const registerWorksForOperation = async (
  params: RegisterWorksForOperationParams,
): Promise<WorksRegistrationOutcome> => {
  const { operationId, serverDB, userId, workspaceId } = params;

  const operationModel = new AgentOperationModel(serverDB, userId, workspaceId);
  const tree = await operationModel.listOperationTree(operationId);

  const completingOp = tree.find((op) => op.id === operationId);
  // The completing op supplies the sandbox session (userId + topicId) and the
  // resource identity's topic; without a topic there is nothing to register.
  if (!completingOp?.topicId) {
    log('[%s] Skipping file Work registration: completing operation has no topic', operationId);
    return { attempted: 0, failed: 0 };
  }

  // Which tool calls this completion is responsible for registering.
  //
  // ROOT op (no parent): scan the WHOLE operation tree, so a sub-agent's edits
  // register too. A sub-op always completes before its root (persistCompletion
  // writes each child row before dispatching the hook that unparks the parent),
  // so the root registers the whole tree exactly once.
  //
  // SUB-op (has a parent): its edits are normally already covered by the root's
  // tree scan, so re-scanning here under a DIFFERENT `op:${opId}` key would
  // produce a duplicate version — hence the historical "sub-op is a no-op" rule.
  // The ONE exception is an auto-repair operation (see repairService): it is
  // spawned AFTER its parent already reached a terminal state and ran its tree
  // scan, so the parent will never scan again and the repair's edits would be
  // lost. Distinguish by the parent's status:
  //   - parent still active (idle / running / parked — waiting_for_human or
  //     waiting_for_async_tool, per isParkedStatus) → it will scan the whole
  //     subtree on its own completion, so no-op here to avoid the duplicate.
  //   - parent already terminal (done / error / interrupted) → register this
  //     op's OWN edits (a legitimately new version for the repair), scanning
  //     ONLY this op's records — tree scanning stays reserved for the root.
  let scanTree = tree;
  if (completingOp.parentOperationId) {
    const parentOp = await operationModel.findById(completingOp.parentOperationId);
    const parentStatus = parentOp?.status;
    const parentActive =
      !parentStatus ||
      parentStatus === 'idle' ||
      parentStatus === 'running' ||
      isParkedStatus(parentStatus);
    if (parentActive) {
      log(
        '[%s] Skipping file Work registration: parent operation is still active (%s)',
        operationId,
        parentStatus ?? 'missing',
      );
      return { attempted: 0, failed: 0 };
    }
    scanTree = tree.filter((op) => op.id === operationId);
  }

  const topicId = completingOp.topicId;

  const messageModel = new MessageModel(serverDB, userId, workspaceId);
  const records = await collectOperationRecords(messageModel, scanTree);
  if (records.length === 0) {
    log(
      '[%s] Skipping file Work registration: no plugin records across %d operation(s)',
      operationId,
      scanTree.length,
    );
    return { attempted: 0, failed: 0 };
  }

  // Map each tool call to its provenance so a file's version can point at the
  // message/tool that last edited it.
  const provenanceByToolCall = new Map<string, FileProvenance>();
  for (const record of records) {
    if (!record.toolCallId) continue;
    provenanceByToolCall.set(record.toolCallId, {
      apiName: record.apiName,
      identifier: record.identifier ?? '',
      messageId: record.id,
    });
  }

  const resolveProvenance = (sourceToolCallIds: string[]): FileProvenance | undefined => {
    // Walk the file's edits newest-first: the last edit that has a persisted
    // provenance row wins.
    for (let i = sourceToolCallIds.length - 1; i >= 0; i -= 1) {
      const found = provenanceByToolCall.get(sourceToolCallIds[i]);
      if (found) return found;
    }
    return undefined;
  };

  const workModel = new WorkModel(serverDB, userId, workspaceId);

  // The whole operation's spend/usage is attached to each version registered
  // this round (an operation-level, not per-file, figure — the scanner can't
  // attribute cost to individual files). Prefer the terminal state's live blobs
  // over the op row: on the pre-snapshot path the row's cost/usage columns are
  // written only later by `recordCompletion`, so the row reads null/stale here.
  // The op row's `totalCost` also rolls up terminal child ops; replicate that
  // from the already-loaded tree (children complete before their root, so their
  // rows carry final totals) to keep the state-sourced figure equivalent.
  const childCost = tree
    .filter((op) => op.id !== operationId)
    .reduce((sum, op) => sum + (op.totalCost ?? 0), 0);
  const ownCost = params.finalCost?.total;
  const cumulativeCost =
    typeof ownCost === 'number' ? ownCost + childCost : (completingOp.totalCost ?? null);
  const usageBlob = params.finalUsage ?? completingOp.usage;
  const cumulativeUsage: WorkVersionCumulativeUsage | null = usageBlob
    ? {
        capturedAt: new Date().toISOString(),
        cost: params.finalCost ?? completingOp.cost ?? undefined,
        usage: usageBlob,
      }
    : null;

  // Recover external Works (github issue/PR today) from hetero / device shell
  // records (codex, claude-code, lobe-local-system) — these surfaces never pass
  // the skill-tool registration hook. Self-guarded: per-record failures are
  // counted, never thrown. Unlike file Works there is no device-provenance
  // objection: the registered entities are REMOTE resources whose identity/url
  // is independent of where the CLI ran.
  const shellOutcome = await registerShellWorks({
    agentId: completingOp.agentId,
    cumulativeCost,
    cumulativeUsage,
    operationId,
    records,
    threadId: completingOp.threadId,
    topicId,
    workModel,
  });

  // Heterogeneous runs never pass `callLlmFinalizer`, the executor that stamps
  // the Work display anchor (`metadata.work.rootOperationId`) for in-process
  // runs — without the stamp a registered Work never renders below the message.
  // `messageModel.update` deep-merges metadata, so re-stamping an anchor the
  // finalizer already wrote (same rootOperationId) is a no-op.
  if (shellOutcome.registered > 0) {
    let anchorMessageId = params.assistantMessageId ?? null;
    if (!anchorMessageId && shellOutcome.anchorCandidateMessageId) {
      // Hetero SINGLE-STEP runs can finish without a final-assistant pointer
      // (`heteroFinish` finds neither `heteroCurrentMsgId` nor
      // `runningOperation.assistantMessageId`). Fall back to the assistant
      // that OWNS the last registered shell tool call — every tool message
      // keeps `parentId` = its owning assistant — so the Work still renders
      // in the round instead of being persisted invisibly.
      try {
        const toolMessage = await messageModel.findById(shellOutcome.anchorCandidateMessageId);
        anchorMessageId = toolMessage?.parentId ?? null;
      } catch (error) {
        log('[%s] Failed to resolve fallback work anchor (non-fatal): %O', operationId, error);
      }
    }

    if (anchorMessageId) {
      // `messageModel.update` reports DB errors / no-matched-row as
      // `{ success: false }` instead of throwing — a failed stamp must count as
      // a failure so the completion backstop withholds its idempotency marker
      // and retries the (idempotent) scan + stamp next round.
      const stamp = await messageModel.update(anchorMessageId, {
        metadata: { work: { rootOperationId: operationId } },
      });
      if (!stamp.success) {
        shellOutcome.failed += 1;
        log('[%s] Failed to stamp work anchor on %s', operationId, anchorMessageId);
      }
    } else {
      // No resolvable anchor at all: the Work row exists but nothing would
      // ever render it. Withhold the completion marker so a later completion
      // retries the (idempotent) scan + stamp.
      shellOutcome.failed += 1;
      log('[%s] No anchor message available for registered shell Works', operationId);
    }
  }

  const scannedEntities = scanOperationFileEdits(records).filter(
    (entry) => entry.kind !== 'deleted' && classifyEditedFile(entry.path).category === 'entity',
  );
  const entities = scannedEntities.filter((entry) => {
    // Only sandbox-backed edits are exportable: the export below reads the file
    // from THIS topic's cloud sandbox, so a hetero edit (codex / claude-code /
    // lobe-local-system, including entities detected from shell command text) —
    // which lives on the executing device, not in the sandbox — would either
    // fail the export or, worse, pick up an unrelated stale sandbox file at the
    // same path. Mirrors `stateHasEntityFileEdits`, which also only considers
    // sandbox tool calls.
    return resolveProvenance(entry.sourceToolCallIds)?.identifier === CLOUD_SANDBOX_IDENTIFIER;
  });

  // Entity artifacts GENERATED inside the sandbox (executeCode / runCommand /
  // a skill's execScript — python-pptx or pptxgenjs decks, reportlab PDFs,
  // openpyxl sheets, …) never surface through the edit scanner: binary formats
  // can't be written by the text-based writeFile / editFile, so the only
  // persisted record carrying their path is the agent's `exportFile` call —
  // the sandbox tool's, or the skills tool's when a skill drives the flow
  // (see `resolveExportedSandboxPath`). Treat each successfully exported
  // entity path as a registerable input too. The file still lives in the
  // sandbox, so it rides the same probe → collision-proof export → register
  // pipeline below — the object `exportFile` itself uploaded is NOT reused:
  // its storage key derives from the basename alone, so a later export of the
  // same file would clobber it and break version immutability. Last export
  // per path wins; paths already covered by the edit scan keep their richer
  // (line-delta) entries.
  const editedPaths = new Set(entities.map((entry) => entry.path));
  const exportedByPath = new Map<string, EditedFileEntry>();
  for (const record of records) {
    if (record.apiName !== 'exportFile') continue;
    if (record.error != null && record.error !== '') continue;
    const path = resolveExportedSandboxPath(record);
    if (!path || editedPaths.has(path)) continue;
    if (classifyEditedFile(path).category !== 'entity') continue;
    exportedByPath.set(path, {
      diffTexts: [],
      kind: 'modified',
      linesAdded: 0,
      linesDeleted: 0,
      path,
      sourceToolCallIds: [record.toolCallId],
    });
  }
  entities.push(...exportedByPath.values());
  log(
    '[%s] File Work scan: operations=%d records=%d entityEdits=%d sandboxCandidates=%d exportCandidates=%d',
    operationId,
    scanTree.length,
    records.length,
    scannedEntities.length,
    entities.length - exportedByPath.size,
    exportedByPath.size,
  );
  if (entities.length === 0) {
    log('[%s] Skipping file Work registration: no sandbox-backed entity candidates', operationId);
    return { attempted: shellOutcome.attempted, failed: shellOutcome.failed };
  }

  // The sandbox is derived from userId + topicId and outlives the operation, so
  // it is safe to build once here for every export.
  const marketService = new MarketService({ userInfo: { userId } });
  const fileService = new FileService(serverDB, userId, workspaceId);
  const sandboxService = createSandboxService({
    fileService,
    marketService,
    serverDB,
    topicId,
    userId,
  });

  // Register each entity file with bounded parallelism. Every file's own
  // export → register → redeploy chain stays sequential inside its task, and each
  // task keeps its own best-effort try/catch (returning 'ok' | 'failed' instead
  // of throwing), so one file's failure never aborts the others. Parallelism is
  // safe: `registerFile` keys its version row by `workId` (derived from the file
  // path), so distinct files touch distinct `works` rows — no shared row-lock
  // contention within a single operation. The concurrency cap bounds the
  // sandbox/storage/DB fanout (see FILE_WORK_EXPORT_CONCURRENCY).
  // One-version-per-operation dedup key; also the object-key prefix below.
  const toolCallId = `op:${operationId}`;

  const settled = await mapWithConcurrency(
    entities,
    FILE_WORK_EXPORT_CONCURRENCY,
    async (entry): Promise<'failed' | 'ok'> => {
      const basename = getBasename(entry.path);

      try {
        // Retry idempotency: if this (op, file) version already exists, the file
        // was exported + registered on a previous attempt. Skip re-exporting —
        // a re-export would overwrite the immutable object AND, if registration
        // then no-op'd on the dedup guard, leave an orphan file record. The probe
        // is a single joined query (resolve Work + check version by toolCallId).
        const alreadyRegistered = await workModel.findFileVersionByToolCall({
          filePath: entry.path,
          toolCallId,
          topicId,
          userId,
        });
        if (alreadyRegistered) {
          log('[%s] Skipping file %s: version already registered (retry)', operationId, entry.path);
          // Idempotent skip: the file registered on a previous attempt, so it is
          // a SUCCESS for marker purposes (not a failure to retry).
          return 'ok';
        }

        // Object-key uniqueness: the sandbox export key is `date/topicId/storageName`
        // (see SandboxMiddlewareService.exportAndUploadFile), so same-name files in
        // different directories — and successive versions of one file — would
        // clobber each other's uploaded object. Hash the FULL operationId + path
        // (16 hex ≈ 64-bit) into the storage name so every (operation, path) maps
        // to a distinct, immutable object. A prefix of `operationId` alone is NOT
        // enough: real ids are `op_${Date.now()}_…`, whose first 8 chars only
        // change every ~27.8h, so two ops editing the same path on the same day
        // would collide. The Work title/metadata and the file record's display
        // name still use the original basename; only the storage key differs.
        const storageName = `${createHash('sha1')
          .update(`${operationId}:${entry.path}`)
          .digest('hex')
          .slice(0, 16)}-${basename}`;

        // Export must succeed before we register: the version carries the file's
        // durable identity (fileId / url), so a failed export means we skip this
        // file entirely rather than register a version pointing at nothing.
        // Display name = basename (clean download filename); storage key uses the
        // unique `storageName` so the object is never clobbered.
        const exported = await sandboxService.exportAndUploadFile(entry.path, basename, {
          storageName,
        });
        if (!exported.success) {
          log(
            '[%s] Skipping file %s: sandbox export failed: %s',
            operationId,
            entry.path,
            exported.error?.message ?? 'unknown error',
          );
          // A failed export leaves nothing to register — count it so the caller
          // withholds the marker and a later call retries this file.
          return 'failed';
        }

        const provenance = resolveProvenance(entry.sourceToolCallIds);

        const metadata: WorkVersionMetadata = {
          fileId: exported.fileId,
          filePath: entry.path,
          fileSize: exported.size,
          fileUrl: exported.url,
          linesAdded: entry.linesAdded,
          linesDeleted: entry.linesDeleted,
          mimeType: exported.mimeType,
        };

        const work = await workModel.registerFile({
          agentId: completingOp.agentId,
          cumulativeCost,
          cumulativeUsage,
          filePath: entry.path,
          messageId: provenance?.messageId,
          metadata,
          rootOperationId: operationId,
          threadId: completingOp.threadId,
          title: basename,
          // One version per operation for this file; a retry is short-circuited
          // by the probe above, and any residual race hits the
          // (workId, toolCallId) unique guard and is a no-op.
          toolCallId,
          toolIdentifier: provenance?.identifier ?? '',
          toolName: provenance?.apiName ?? '',
          topicId,
          userId,
        });

        await redeployFileWork({
          fileId: exported.fileId,
          fileUrl: exported.url,
          filePath: entry.path,
          versionId: work.currentVersionId,
          workId: work.id,
        });
        return 'ok';
      } catch (error) {
        log(
          '[%s] Failed to register file Work for %s (non-fatal): %O',
          operationId,
          entry.path,
          error,
        );
        return 'failed';
      }
    },
  );

  // `mapWithConcurrency` never rejects (each task is self-guarded), but a stray
  // rejection would surface as a settled 'rejected' — treat it as a failure too.
  const failed = settled.filter(
    (result) => result.status === 'rejected' || result.value === 'failed',
  ).length;
  return {
    attempted: entities.length + shellOutcome.attempted,
    failed: failed + shellOutcome.failed,
  };
};
