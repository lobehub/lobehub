/**
 * File / GitHub Work registration at the end of a run.
 */
import debug from 'debug';

import { WorkModel } from '@/database/models/work';
import {
  registerWorksForOperation,
  resolveRunWorkAccessScope,
} from '@/server/services/workRegistration';

import type { CompletionLifecycleDeps } from './types';

const log = debug('lobe-server:completion-lifecycle');

/**
 * Register the operation's Works: entity files edited this round
 * (pptx/xlsx/docx/pdf, …) as `file` Works — one version per operation,
 * exported from the sandbox — plus github issue/PR Works recovered from
 * hetero / device shell records (codex / claude-code / lobe-local-system
 * `gh` runs), which never pass the skill-tool registration hook.
 *
 * Idempotent per state object: only when EVERY candidate registered (the
 * returned outcome reports `failed === 0`) is a `_fileWorksRegistered` marker
 * stamped onto `state.metadata` so the dispatchHooks backstop (which receives
 * the same state later in the request) skips the duplicate scan. A PARTIAL
 * failure leaves the marker unset so the backstop re-runs and retries just the
 * failed candidates — file registration is idempotent per (operation, file)
 * via a DB existence probe, github registration per (work, toolCallId) via
 * the version write's unique guard, so a QStash retry that lost the marker is
 * safe.
 *
 * The gateway/queue executor calls this BEFORE the terminal
 * `coordinator.saveStepResult`: that save publishes `agent_runtime_end`,
 * whose `uiMessages` snapshot the client adopts as the settled message list —
 * Work rows must exist by then or the file-Work card stays absent until a
 * manual refresh. When entity edits are present, the executor suppresses the
 * early `visible_output_end`, so perceived loading covers export and
 * registration until the terminal snapshot is published.
 *
 * Awaited, NOT fire-and-forget: on serverless the runtime can freeze the
 * moment the response is sent, silently dropping any still-pending background
 * write. Fully self-guarded — a failure only logs, never throws. Both a thrown
 * whole-function failure AND a partial per-file failure (outcome `failed > 0`)
 * leave the marker unset so a later call retries the outstanding files.
 */
export async function registerFileWorks(
  deps: CompletionLifecycleDeps,
  operationId: string,
  state: any,
): Promise<void> {
  if (state?.metadata?._fileWorksRegistered) return;
  try {
    // Share visitor runs register under the share scope of their visitor
    // topic (both the file scan below and the anchor lookup that follows).
    const shareVisitor = state?.principal?.actor?.shareVisitor ?? null;
    const accessScope = resolveRunWorkAccessScope({
      shareVisitor,
      topicId: state?.origin?.topicId,
    });
    if (accessScope === null) {
      log('[%s] Skipping Work registration: share visitor run has no topic', operationId);
      return;
    }

    const outcome = await registerWorksForOperation({
      agentShareVisitor: shareVisitor,
      // The round's final assistant message — the shell github scan stamps the
      // Work display anchor onto it for hetero runs (see registerWorksForOperation).
      assistantMessageId:
        state?.metadata?.workAssistantMessageId ?? state?.metadata?.assistantMessageId ?? null,
      // Live terminal totals: on the pre-snapshot path the op row's cost/usage
      // columns are not persisted yet (recordCompletion runs later), so the
      // registration must not rely on reading them back from the DB.
      finalCost: state?.cost ?? null,
      finalUsage: state?.usage ?? null,
      operationId,
      serverDB: deps.serverDB,
      userId: state?.origin?.userId || deps.userId,
      workspaceId: deps.workspaceId,
    });
    // Skill tools may have registered Works before the terminal file scan.
    // Query the registry instead of inferring output from display messages.
    const works = await new WorkModel(
      deps.serverDB,
      state?.origin?.userId || deps.userId,
      deps.workspaceId,
      accessScope,
    ).listByRootOperation({ includeFileWorks: true, limit: 1, rootOperationId: operationId });
    if (works.length > 0) {
      const assistantMessageId =
        state?.metadata?.workAssistantMessageId ??
        state?.metadata?.assistantMessageId ??
        outcome.anchorMessageId;
      if (!assistantMessageId) {
        log('[%s] No assistant message available for registered Works', operationId);
        return;
      }
      const result = await deps.messageModel.update(assistantMessageId, {
        metadata: {
          work: {
            rootOperationId: operationId,
            userMessageId: state?.origin?.sourceMessageId,
          },
        },
      });
      if (!result.success) {
        log('[%s] Failed to stamp Work anchor on %s', operationId, assistantMessageId);
        return;
      }
    }
    // Stamp the idempotency marker ONLY when nothing failed. A partial failure
    // (some files exported/registered, others did not) must NOT be recorded as
    // a completed registration, or the dispatchHooks backstop would skip the
    // retry and the user gets neither a Work nor the edited-files fallback.
    if (state?.metadata && outcome.failed === 0) state.metadata._fileWorksRegistered = true;
  } catch (error) {
    log('[%s] registerWorksForOperation failed (non-fatal): %O', operationId, error);
  }
}
