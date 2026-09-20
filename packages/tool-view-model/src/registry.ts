import { listDocumentsProjector, readDocumentProjector } from './projectors/agentDocuments';
import { grepContentProjector } from './projectors/grepContent';
import { runCommandProjector } from './projectors/localSystem';
import { readFileProjector } from './projectors/readFile';
import { searchUserMemoryProjector } from './projectors/userMemory';
import { crawlProjector } from './projectors/webBrowsing';
import type { ToolProjector } from './types';

/**
 * `identifier` → `apiName` → projector.
 *
 * Deliberately a static literal rather than the `register*()` pattern the
 * client-side render registry uses: this map is read from the server read path,
 * where there is no app bootstrap to guarantee registration ran first.
 *
 * A tool missing from here still has its BODY dropped — see
 * `BODY_ONLY_PROJECTION` — and keeps its `pluginState` whole. An entry here is
 * how a tool additionally sheds state, which needs per-tool knowledge of the
 * keys its collapsed row reads.
 */
const toolProjectors: Record<string, Record<string, ToolProjector>> = {
  // Every tool below renders through the SAME shared card,
  // `shared-tool-ui/Render/RunCommand` — it reads `stdout || output || content`
  // for the body and `success` / `exitCode` for the collapsed row. One shape,
  // so one projector; see `register.ts` for the render registrations that make
  // this true.
  'claude-code': {
    Bash: runCommandProjector,
  },
  'codex': {
    command_execution: runCommandProjector,
  },
  'lobe-agent-documents': {
    listDocuments: listDocumentsProjector,
    readDocument: readDocumentProjector,
  },
  // `grepContent` is the same tool on both hosts, down to the shared inspector.
  'lobe-cloud-sandbox': {
    grepContent: grepContentProjector,
  },
  'lobe-local-system': {
    grepContent: grepContentProjector,
    readFile: readFileProjector,
    runCommand: runCommandProjector,
  },
  'lobe-user-memory': {
    searchUserMemory: searchUserMemoryProjector,
  },
  'lobe-web-browsing': {
    crawlMultiPages: crawlProjector,
    crawlSinglePage: crawlProjector,
  },
  'opencode': {
    bash: runCommandProjector,
  },
  'pi': {
    bash: runCommandProjector,
  },
};

/**
 * Tools whose result BODY no `tool_end` consumer reads, so the gateway can drop
 * it from the event (the body still reaches the screen with the message).
 *
 * An allowlist, not a denylist, because getting this wrong is silent. Several
 * renderer-side `onAfterCall` hooks parse the body for side effects the user
 * never sees them do — every heterogeneous CLI's shell tool and its worktree
 * enter/exit feed `recordGitCommandEffects` / `recordWorktreeEnter`, and
 * `lobe-local-system/runCommand` does the same for native runs, which is how a
 * topic learns the branch it switched to and the PR it opened. Dropping the
 * body there would lose that binding with nothing on screen to show for it.
 *
 * So a tool earns a place here only after its hooks are checked. Anything
 * absent keeps shipping its body, exactly as before.
 */
const eventBodyUnused: ReadonlySet<string> = new Set([
  // `lobe-agent-documents`' hook only fires for list-mutating APIs and reads
  // `result.success`; a read is neither.
  'lobe-agent-documents/listDocuments',
  'lobe-agent-documents/readDocument',
  // `lobe-cloud-sandbox` registers no hook, and `lobe-local-system`'s is scoped
  // to `runCommand`.
  'lobe-cloud-sandbox/grepContent',
  'lobe-local-system/grepContent',
  'lobe-local-system/readFile',
  // `lobe-user-memory` and `lobe-web-browsing` register no hook at all.
  'lobe-user-memory/searchUserMemory',
  'lobe-web-browsing/crawlMultiPages',
  'lobe-web-browsing/crawlSinglePage',
]);

/** Whether a `tool_end` for this tool can travel without its result body. */
export const isToolEventBodyUnused = (
  identifier?: string | null,
  apiName?: string | null,
): boolean => !!identifier && !!apiName && eventBodyUnused.has(`${identifier}/${apiName}`);

export const getToolProjector = (
  identifier?: string | null,
  apiName?: string | null,
): ToolProjector | undefined => {
  if (!identifier || !apiName) return undefined;

  return toolProjectors[identifier]?.[apiName];
};

/** Every `identifier/apiName` pair that currently has a projector. */
export const listProjectedTools = (): string[] =>
  Object.entries(toolProjectors).flatMap(([identifier, apis]) =>
    Object.keys(apis).map((apiName) => `${identifier}/${apiName}`),
  );
