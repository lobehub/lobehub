import { readDocumentProjector } from './projectors/agentDocuments';
import { runCommandProjector } from './projectors/localSystem';
import { crawlProjector } from './projectors/webBrowsing';
import type { ToolProjector } from './types';

/**
 * `identifier` → `apiName` → projector.
 *
 * Deliberately a static literal rather than the `register*()` pattern the
 * client-side render registry uses: this map is read from the server read path,
 * where there is no app bootstrap to guarantee registration ran first. A tool
 * missing from here keeps today's behaviour (raw payload passes through), so
 * the map can be filled one tool at a time.
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
    readDocument: readDocumentProjector,
  },
  'lobe-local-system': {
    runCommand: runCommandProjector,
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
