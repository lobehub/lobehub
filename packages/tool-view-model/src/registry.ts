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
const toolProjectors: Record<string, Record<string, ToolProjector>> = {};

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
