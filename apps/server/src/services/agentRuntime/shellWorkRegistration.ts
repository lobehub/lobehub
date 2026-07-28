import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import {
  CLAUDE_CODE_IDENTIFIER,
  CODEX_IDENTIFIER,
} from '@lobechat/heterogeneous-agents/transcript';
import type { WorkVersionCumulativeUsage } from '@lobechat/types';
import debug from 'debug';

import type { WorkModel } from '@/database/models/work';

import { SHELL_WORK_SCANNERS } from './shellWorkScanners';

const log = debug('lobe-server:shell-work-registration');

/**
 * Shell tool surfaces whose raw command text may carry Work-registerable CLI
 * runs (mirrors the hetero-shell sources of
 * `@lobechat/builtin-tools/fileEditScan`), keyed by plugin `identifier` →
 * shell `apiName`:
 *
 * - codex `command_execution` — stdout in `state.stdout` / `state.output`,
 *   `state.exitCode` on completion (`adapters/codex.ts`).
 * - claude-code `Bash` — stdout is the tool MESSAGE CONTENT (the adapter
 *   persists the tool_result text as content, no structured state); failures
 *   surface via the plugin `error` column (is_error), never an exit code.
 * - lobe-local-system `runCommand` — device-executed homogeneous tool; its
 *   `RunCommandState` carries `stdout` / `output` / `exitCode` / `success`.
 *
 * The github SKILL's surfaces (structured tools + sandbox `runCommand`) are
 * deliberately absent: they register at execution time through
 * `handleSkillToolResult` (server `toolExecution/builtin.ts` and the client
 * executor), so scanning them here would double-register.
 */
const SHELL_COMMAND_SOURCES: Record<string, string> = {
  [CLAUDE_CODE_IDENTIFIER]: 'Bash',
  [CODEX_IDENTIFIER]: 'command_execution',
  [LocalSystemIdentifier]: 'runCommand',
};

/** One tool-call row from the operation tree, as collected by the works scan. */
export interface ShellWorkScanRecord {
  apiName: string;
  arguments?: string | null;
  /** Tool message text body — claude-code Bash stdout lives here. */
  content?: string;
  error?: unknown;
  /** Owning tool message id — becomes the version's source message. */
  id: string;
  identifier?: string | null;
  state?: unknown;
  toolCallId: string;
}

export interface ShellWorksOutcome {
  /**
   * Tool MESSAGE id of the last successfully registered record. Lets the
   * caller derive a display-anchor fallback (the tool message's `parentId` is
   * its owning assistant) when the completion carries no final-assistant
   * pointer — hetero single-step runs persist neither `heteroCurrentMsgId`
   * nor `runningOperation.assistantMessageId` (see `heteroFinish`).
   */
  anchorCandidateMessageId: string | null;
  /** Records a scanner resolved into a registerable external entity. */
  attempted: number;
  /**
   * Failures counted against the completion backstop's idempotency marker:
   * registration throws from this scan, plus anchor-stamp failures the caller
   * (`registerWorksForOperation`) folds in after the fact.
   */
  failed: number;
  /** How many of `attempted` registered (or idempotently re-registered). */
  registered: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (record: Record<string, unknown> | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * Register external Works from the shell tool calls of a completed operation:
 * heterogeneous CLI agents (codex / claude-code) and the device
 * `lobe-local-system` tool run CLIs like `gh` through their OWN shell
 * surfaces, which never pass the skill-tool registration hook — so their
 * Work-worthy runs are recovered here, at completion time, from the persisted
 * command text + stdout (same completion-scan pattern as file-Work
 * registration). Each entry in {@link SHELL_WORK_SCANNERS} covers one CLI
 * family; github is the only one today.
 *
 * Best-effort per record: registration failures are counted, never thrown. A
 * retry is idempotent — the version write dedupes on `(workId, toolCallId)`
 * with the record's REAL tool call id.
 */
export const registerShellWorks = async (params: {
  agentId?: string | null;
  cumulativeCost: number | null;
  cumulativeUsage: WorkVersionCumulativeUsage | null;
  operationId: string;
  records: ShellWorkScanRecord[];
  threadId?: string | null;
  topicId: string;
  workModel: WorkModel;
}): Promise<ShellWorksOutcome> => {
  const outcome: ShellWorksOutcome = {
    anchorCandidateMessageId: null,
    attempted: 0,
    failed: 0,
    registered: 0,
  };

  for (const record of params.records) {
    if (!record.identifier || SHELL_COMMAND_SOURCES[record.identifier] !== record.apiName) continue;
    // A plugin-level error means the command never ran / failed (claude-code
    // is_error rides here); state-level failure signals mirror fileEditScan.
    if (record.error != null && record.error !== '') continue;
    const state = isRecord(record.state) ? record.state : undefined;
    if (state?.success === false) continue;
    if (state?.error != null && state.error !== '') continue;

    let command: unknown;
    try {
      command = JSON.parse(record.arguments ?? '')?.command;
    } catch {
      continue;
    }
    if (typeof command !== 'string') continue;

    const data = {
      command,
      // Absent for claude-code (no exit code is persisted); its failures were
      // already excluded via the plugin error above.
      exitCode: typeof state?.exitCode === 'number' ? state.exitCode : undefined,
      output: stringField(state, 'stdout') ?? stringField(state, 'output') ?? record.content,
    };

    for (const scanner of SHELL_WORK_SCANNERS) {
      if (!scanner.matches(command)) continue;

      try {
        const work = await scanner.register({
          agentId: params.agentId ?? null,
          cumulativeCost: params.cumulativeCost,
          cumulativeUsage: params.cumulativeUsage,
          data,
          messageId: record.id,
          rootOperationId: params.operationId,
          threadId: params.threadId ?? null,
          toolCallId: record.toolCallId || null,
          toolIdentifier: record.identifier,
          toolName: record.apiName,
          topicId: params.topicId,
          workModel: params.workModel,
        });
        if (!work) continue;
        outcome.attempted += 1;
        outcome.registered += 1;
        outcome.anchorCandidateMessageId = record.id;
      } catch (error) {
        // The normalizer runs before the write, so a throw here means a
        // resolved external entity failed to persist — count it so the
        // completion backstop withholds its idempotency marker and retries.
        outcome.attempted += 1;
        outcome.failed += 1;
        log(
          '[%s] Failed to register %s Work from %s:%s (non-fatal): %O',
          params.operationId,
          scanner.name,
          record.identifier,
          record.apiName,
          error,
        );
      }
    }
  }

  if (outcome.attempted > 0) {
    log(
      '[%s] Shell Work scan: attempted=%d registered=%d failed=%d',
      params.operationId,
      outcome.attempted,
      outcome.registered,
      outcome.failed,
    );
  }

  return outcome;
};
