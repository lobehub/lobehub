import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  classifyEditedFile,
  CLOUD_SANDBOX_IDENTIFIER,
  type FileEditToolCallRecord,
  scanOperationFileEdits,
} from '@lobechat/builtin-tools/fileEditScan';

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
 *   export is exactly what completion will register as a file Work. This
 *   includes the skills tool's export surface (`lobe-skills` exportFile),
 *   which skill-driven flows (e.g. the pptx skill) use instead of the sandbox
 *   tool's.
 * - Any malformed shape returns false → today's early-publish behavior.
 */
export const stateHasEntityFileEdits = (state: any): boolean => {
  const allMessages: any[] = Array.isArray(state?.messages) ? state.messages : [];
  const lastUserIndex = allMessages.findLastIndex((message: any) => message?.role === 'user');
  const messages = allMessages.slice(lastUserIndex + 1);

  const sandboxPrefix = `${CLOUD_SANDBOX_IDENTIFIER}____`;
  const skillsExportPrefix = `${SkillsIdentifier}____exportFile`;
  const records: FileEditToolCallRecord[] = [];

  for (const message of messages) {
    // Shape 1: raw assistant rows appended in-memory during the current step.
    if (message?.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const name: unknown = call?.function?.name;
        if (typeof name !== 'string') continue;
        const rawArguments =
          typeof call?.function?.arguments === 'string' ? call.function.arguments : '';
        // Skills export surface: only exportFile is relevant (its runCommand /
        // execScript never carry an output path), and args-only entity checks
        // over-approximate success just like the sandbox exportFile below.
        if (name.startsWith(skillsExportPrefix) && exportArgsTargetEntityFile(rawArguments))
          return true;
        if (!name.startsWith(sandboxPrefix)) continue;
        const apiName = name.split('____')[1] ?? '';
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
        if (
          tool?.identifier === SkillsIdentifier &&
          tool.apiName === 'exportFile' &&
          exportArgsTargetEntityFile(typeof tool.arguments === 'string' ? tool.arguments : '')
        )
          return true;
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
