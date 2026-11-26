import { LOADING_FLAT } from '@lobechat/const';
import { type SQL, sql } from 'drizzle-orm';

import { messagePlugins, messages } from '../../schemas';

/**
 * Tools whose result renders through the shared `RunCommand` card. Mirrors the
 * `runCommandProjector` entries in `@lobechat/tool-view-model`'s registry.
 */
const RUN_COMMAND_TOOLS: [identifier: string, apiName: string][] = [
  ['claude-code', 'Bash'],
  ['codex', 'command_execution'],
  ['lobe-local-system', 'runCommand'],
  ['opencode', 'bash'],
  ['pi', 'bash'],
];

/** Same tool on both hosts, see `grepContentProjector`. */
const GREP_CONTENT_IDENTIFIERS = ['lobe-cloud-sandbox', 'lobe-local-system'];

/** See `crawlProjector` (`CRAWL_PREVIEW_CHARS`). */
const CRAWL_PREVIEW_CHARS = 200;

/**
 * Every `identifier/apiName` this SQL reduces. Each one must also have a
 * projector in `@lobechat/tool-view-model`, which the equivalence test checks.
 */
export const VIEW_MODEL_REDUCED_TOOLS: string[] = [
  ...RUN_COMMAND_TOOLS.map(([identifier, apiName]) => `${identifier}/${apiName}`),
  ...GREP_CONTENT_IDENTIFIERS.map((identifier) => `${identifier}/grepContent`),
  'lobe-agent-documents/readDocument',
  'lobe-local-system/readFile',
  'lobe-web-browsing/crawlMultiPages',
  'lobe-web-browsing/crawlSinglePage',
];

const isTool = (identifier: string, apiName: string): SQL =>
  sql`(${messagePlugins.identifier} = ${identifier} AND ${messagePlugins.apiName} = ${apiName})`;

const anyTool = (tools: [string, string][]): SQL =>
  sql.join(
    tools.map(([identifier, apiName]) => isTool(identifier, apiName)),
    sql` OR `,
  );

const state = messagePlugins.state;

/**
 * `crawlProjector` shortens each page body to 200 UTF-16 units and pins the
 * original length. Postgres counts code points, not UTF-16 units, so it cannot
 * pin that length itself: only results whose `data.length` is already stored
 * are cut, and they are cut to 200 code points, which is never shorter than
 * the projector's 200 units. The projector then cuts the rest exactly as it
 * would have cut the whole body.
 */
const crawlResults = sql`(
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(r.value) = 'object'
        AND jsonb_typeof(r.value -> 'data') = 'object'
        AND NOT jsonb_exists(r.value -> 'data', 'errorType')
        AND jsonb_typeof(r.value -> 'data' -> 'content') = 'string'
        AND jsonb_typeof(r.value -> 'data' -> 'length') = 'number'
        AND length(r.value -> 'data' ->> 'content') > ${CRAWL_PREVIEW_CHARS}
      THEN jsonb_set(
        r.value,
        '{data,content}',
        to_jsonb(left(r.value -> 'data' ->> 'content', ${CRAWL_PREVIEW_CHARS}))
      )
      ELSE r.value
    END
    ORDER BY r.ordinality
  )
  FROM jsonb_array_elements(${state} -> 'results') WITH ORDINALITY AS r(value, ordinality)
)`;

/**
 * `message_plugins.state` with the keys the UI view-model projection
 * (`projectToolViewModels` in `@lobechat/tool-view-model`) would drop already
 * removed, so they never leave the database.
 *
 * Invariant: for every row, projecting this state gives exactly what projecting
 * the stored state gives. A row is reduced only when its projector provably
 * ignores what is removed:
 * - a settled, non-empty body: a running row (`LOADING_FLAT`) is never
 *   projected, and with an empty body `runCommandProjector` and
 *   `readFileProjector` decide from the state keys removed here;
 * - `readFile` only when `charCount` is stored, since the projector would
 *   otherwise count the removed `content` (in UTF-16 units Postgres cannot
 *   reproduce);
 * - crawl results as described on {@link crawlResults}.
 *
 * None of the removed keys is read by the model context or the runtime: those
 * use the message body and small state fields (`images`, `path`, `metadata`,
 * `todos`, activation state). Only readers whose every UI consumer projects
 * the rows may select this; an unprojected client renders the removed keys.
 */
export const viewModelPluginState = sql<unknown>`CASE
  WHEN jsonb_typeof(${state}) IS DISTINCT FROM 'object'
    OR ${messages.content} IS NULL
    OR ${messages.content} = ''
    OR ${messages.content} = ${LOADING_FLAT}
  THEN ${state}
  WHEN ${anyTool(RUN_COMMAND_TOOLS)} THEN ${state} - 'stdout' - 'output'
  WHEN ${isTool('lobe-agent-documents', 'readDocument')} THEN ${state} - 'content' - 'xml'
  WHEN ${messagePlugins.apiName} = 'grepContent'
    AND ${messagePlugins.identifier} IN (${sql.join(
      GREP_CONTENT_IDENTIFIERS.map((identifier) => sql`${identifier}`),
      sql`, `,
    )})
  THEN ${state} - 'matches'
  WHEN ${isTool('lobe-local-system', 'readFile')}
    AND jsonb_typeof(${state} -> 'content') = 'string'
    AND jsonb_typeof(${state} -> 'charCount') = 'number'
  THEN ${state} - 'content'
  WHEN ${messagePlugins.identifier} = 'lobe-web-browsing'
    AND ${messagePlugins.apiName} IN ('crawlSinglePage', 'crawlMultiPages')
    AND jsonb_typeof(${state} -> 'results') = 'array'
    AND jsonb_array_length(${state} -> 'results') > 0
  THEN jsonb_set(${state}, '{results}', ${crawlResults})
  ELSE ${state}
END`;
