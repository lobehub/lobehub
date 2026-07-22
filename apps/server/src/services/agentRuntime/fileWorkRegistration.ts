import { createHash } from 'node:crypto';

import { isParkedStatus } from '@lobechat/agent-runtime';
import {
  classifyEditedFile,
  CLOUD_SANDBOX_IDENTIFIER,
  type EditedFileEntry,
  type FileEditToolCallRecord,
  getBasename,
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

const log = debug('lobe-server:file-work-registration');

/** One tool call gathered from the operation tree, tagged for ordering + provenance. */
type ScannedRecord = FileEditToolCallRecord & { createdAt: Date; id: string };

/** The last-edit tool call for a file, used as the version's provenance. */
interface FileProvenance {
  apiName: string;
  identifier: string;
  messageId: string;
}

export interface RegisterFileWorksForOperationParams {
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
 * Predict from the in-memory runtime state whether this operation edited any
 * entity-format file (pptx / xlsx / docx / pdf, …) — i.e. whether completion
 * will register `file` Works and export them from the sandbox.
 *
 * Used per step when computing `allowEarlyFinalAnswerVisibleOutputEnd`: when
 * an entity edit is present, the early `visible_output_end` is suppressed so
 * the client's loading state honestly covers the export/registration window
 * and the file-Work card arrives together with `agent_runtime_end`'s terminal
 * snapshot instead of popping in after loading already ended.
 *
 * Deliberately a pure, best-effort scan over `state.messages`. TWO message
 * shapes must be handled (mirrors `messageSelectors.collectToolInvocations`):
 * raw in-memory assistant rows carrying OpenAI-style `tool_calls` (wire names
 * follow `identifier____apiName[____type]`, see ToolNameResolver;
 * `lobe-cloud-sandbox` and its apiNames survive normalization verbatim), and
 * conversation-flow grouped nodes — the runtime re-queries `state.messages`
 * with `flatten: true` after every tool batch (see `callToolsBatch`), which
 * folds this run's turn into `assistantGroup`/`supervisor` nodes whose tool
 * calls live on `children[].tools[]` (with the result re-attached as
 * `result.state`). At the final-answer step the sandbox edits are therefore
 * usually in the GROUPED shape; scanning `tool_calls` alone would miss them.
 *
 * Scoped to the CURRENT run: only messages after the LAST `user` row are
 * scanned — an operation always answers the latest user turn, and earlier
 * turns' entity edits registered on their own completion. Counting them would
 * permanently disable the early publish for every later run in the topic.
 *
 * Best-effort by design:
 * - Only sandbox calls are considered — hetero (codex / claude-code) edits
 *   need result state this scan doesn't have, and hetero runs don't go
 *   through this executor path anyway.
 * - For raw `tool_calls` no result exists yet, so a FAILED entity write still
 *   returns true: the only cost is a delayed loading end for that rare case,
 *   while a false `false` would resurrect the card-after-loading glitch.
 * - `moveFiles` renames are only classifiable from the tool RESULT
 *   (`state.results`); when it is absent, over-approximate from the requested
 *   `operations[].destination` arguments instead — same accepted cost.
 * - `exportFile` calls targeting an entity path count too — code-generated
 *   artifacts (python-pptx / reportlab / …) never appear as edits, and their
 *   export is exactly what completion will register as a file Work.
 * - Any malformed shape returns false → today's early-publish behavior.
 */
export const stateHasEntityFileEdits = (state: any): boolean => {
  const allMessages: any[] = Array.isArray(state?.messages) ? state.messages : [];
  const lastUserIndex = allMessages.findLastIndex((message: any) => message?.role === 'user');
  const messages = allMessages.slice(lastUserIndex + 1);

  const sandboxPrefix = `${CLOUD_SANDBOX_IDENTIFIER}____`;
  const records: FileEditToolCallRecord[] = [];

  for (const message of messages) {
    // Shape 1: raw assistant rows appended in-memory during the current step.
    if (message?.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const name: unknown = call?.function?.name;
        if (typeof name !== 'string' || !name.startsWith(sandboxPrefix)) continue;
        const apiName = name.split('____')[1] ?? '';
        const rawArguments =
          typeof call?.function?.arguments === 'string' ? call.function.arguments : '';
        if (apiName === 'moveFiles' && moveArgsTargetEntityFile(rawArguments)) return true;
        if (apiName === 'exportFile' && exportArgsTargetEntityFile(rawArguments)) return true;
        records.push({
          apiName,
          arguments: rawArguments,
          identifier: CLOUD_SANDBOX_IDENTIFIER,
          toolCallId: typeof call?.id === 'string' ? call.id : '',
        });
      }
    }

    // Shape 2: conversation-flow grouped nodes (assistantGroup / supervisor)
    // with parsed tool payloads on `children[].tools[]`.
    if (!Array.isArray(message?.children)) continue;
    for (const child of message.children) {
      if (!Array.isArray(child?.tools)) continue;
      for (const tool of child.tools) {
        if (tool?.identifier !== CLOUD_SANDBOX_IDENTIFIER) continue;
        const apiName = typeof tool.apiName === 'string' ? tool.apiName : '';
        const rawArguments = typeof tool.arguments === 'string' ? tool.arguments : '';
        const resultState = tool.result?.state;
        if (apiName === 'moveFiles' && !resultState && moveArgsTargetEntityFile(rawArguments))
          return true;
        if (apiName === 'exportFile' && exportArgsTargetEntityFile(rawArguments)) return true;
        records.push({
          apiName,
          arguments: rawArguments,
          error: tool.result?.error,
          identifier: CLOUD_SANDBOX_IDENTIFIER,
          state: resultState,
          toolCallId: typeof tool.id === 'string' ? tool.id : '',
        });
      }
    }
  }
  if (records.length === 0) return false;

  return scanOperationFileEdits(records).some(
    (entry) => classifyEditedFile(entry.path).category === 'entity',
  );
};

/** Whether a sandbox `exportFile` call's arguments target an entity file. */
const exportArgsTargetEntityFile = (rawArguments: string): boolean => {
  try {
    const path: unknown = JSON.parse(rawArguments)?.path;
    return typeof path === 'string' && classifyEditedFile(path).category === 'entity';
  } catch {
    return false;
  }
};

/** Whether a sandbox `moveFiles` call's arguments request an entity-file destination. */
const moveArgsTargetEntityFile = (rawArguments: string): boolean => {
  try {
    const operations: unknown = JSON.parse(rawArguments)?.operations;
    if (!Array.isArray(operations)) return false;
    return operations.some(
      (op: any) =>
        typeof op?.destination === 'string' &&
        classifyEditedFile(op.destination).category === 'entity',
    );
  } catch {
    return false;
  }
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
      byMessageId.set(row.id, {
        apiName: row.apiName ?? '',
        arguments: row.arguments,
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
 *   record carrying their path.
 * - `deleted` files are skipped (nothing to persist).
 * - One version per operation via the dedup key `op:${operationId}`; a retry of
 *   the same operation is idempotent — an existence probe short-circuits before
 *   re-exporting, and the `(workId, toolCallId)` unique guard backs it up.
 * - Best-effort per file: an export or registration failure for one file is
 *   logged and skipped, never aborting the others.
 *
 * Awaited (not fire-and-forget) by the completion lifecycle so a serverless
 * response freeze can't drop the background write; the caller still swallows any
 * rejection so file-Work registration can never affect operation completion.
 */
export const registerFileWorksForOperation = async (
  params: RegisterFileWorksForOperationParams,
): Promise<void> => {
  const { operationId, serverDB, userId, workspaceId } = params;

  const operationModel = new AgentOperationModel(serverDB, userId, workspaceId);
  const tree = await operationModel.listOperationTree(operationId);

  const completingOp = tree.find((op) => op.id === operationId);
  // The completing op supplies the sandbox session (userId + topicId) and the
  // resource identity's topic; without a topic there is nothing to register.
  if (!completingOp?.topicId) return;

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
    if (parentActive) return;
    scanTree = tree.filter((op) => op.id === operationId);
  }

  const topicId = completingOp.topicId;

  const messageModel = new MessageModel(serverDB, userId, workspaceId);
  const records = await collectOperationRecords(messageModel, scanTree);
  if (records.length === 0) return;

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

  const entities = scanOperationFileEdits(records).filter((entry) => {
    if (entry.kind === 'deleted') return false;
    if (classifyEditedFile(entry.path).category !== 'entity') return false;
    // Only sandbox-backed edits are exportable: the export below reads the file
    // from THIS topic's cloud sandbox, so a hetero (codex / claude-code) edit —
    // which lives on the executing device, not in the sandbox — would either
    // fail the export or, worse, pick up an unrelated stale sandbox file at the
    // same path. Mirrors `stateHasEntityFileEdits`, which also only considers
    // sandbox tool calls.
    return resolveProvenance(entry.sourceToolCallIds)?.identifier === CLOUD_SANDBOX_IDENTIFIER;
  });

  // Entity artifacts GENERATED inside the sandbox (executeCode / runCommand —
  // python-pptx decks, reportlab PDFs, openpyxl sheets, …) never surface
  // through the edit scanner: binary formats can't be written by the
  // text-based writeFile / editFile, so the only persisted record carrying
  // their path is the agent's `exportFile` call. Treat each successfully
  // exported entity path as a registerable input too. The file still lives in
  // the sandbox, so it rides the same probe → collision-proof export →
  // register pipeline below — the object `exportFile` itself uploaded is NOT
  // reused: its storage key derives from the basename alone, so a later
  // export of the same file would clobber it and break version immutability.
  // Last export per path wins; paths already covered by the edit scan keep
  // their richer (line-delta) entries.
  const editedPaths = new Set(entities.map((entry) => entry.path));
  const exportedByPath = new Map<string, EditedFileEntry>();
  for (const record of records) {
    if (record.identifier !== CLOUD_SANDBOX_IDENTIFIER || record.apiName !== 'exportFile') continue;
    if (record.error != null && record.error !== '') continue;
    // Unlike edits, an export carries no other success signal — require the
    // persisted result state (its `path` is the file's sandbox location).
    const state = record.state as { path?: unknown } | undefined;
    const path = typeof state?.path === 'string' ? state.path.trim() : '';
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
  if (entities.length === 0) return;

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

  // Register each entity file in parallel. Every file's own export → register →
  // redeploy chain stays sequential inside its task, and each task keeps its own
  // best-effort try/catch, so one file's failure never aborts the others.
  // Parallelism is safe: `registerFile` keys its version row by `workId` (derived
  // from the file path), so distinct files touch distinct `works` rows — no
  // shared row-lock contention within a single operation.
  // One-version-per-operation dedup key; also the object-key prefix below.
  const toolCallId = `op:${operationId}`;

  await Promise.allSettled(
    entities.map(async (entry) => {
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
          return;
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
          return;
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
      } catch (error) {
        log(
          '[%s] Failed to register file Work for %s (non-fatal): %O',
          operationId,
          entry.path,
          error,
        );
      }
    }),
  );
};
