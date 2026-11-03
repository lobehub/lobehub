import { toRecord } from '@lobechat/utils/object';

import {
  type ComposioConnectorOptions,
  createComposioToolRunner,
  readComposioField,
} from '../composio';
import { ConnectorDataError } from '../errors';
import type { ConfluenceConnectorClient, ConfluencePage } from './types';

const LIST_PAGES_TOOL_SLUG = 'CONFLUENCE_GET_PAGES';
const DEFAULT_PAGES = 25;
const MAX_PAGE_SIZE = 50;
const MAX_TEXT_LENGTH = 1200;
const SPACE_KEY_IN_PATH = /\/spaces\/([^/]+)/;
const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const decodePathSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

/**
 * Plain text of a Confluence storage-format body: macro settings and tags dropped,
 * common entities decoded, whitespace collapsed, bounded.
 */
export const confluenceStorageToText = (storage: string): string | undefined => {
  const text = storage
    // Macro settings (panel colours, ids) are layout, not content.
    .replaceAll(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, ' ')
    .replaceAll(/<(?:br|\/p|\/h\d|\/li|\/tr)\s*\/?>/gi, '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&(#\d+|[a-z]+);/gi, (match, entity: string) =>
      entity.startsWith('#')
        ? String.fromCodePoint(Number(entity.slice(1)))
        : (ENTITIES[entity.toLowerCase()] ?? match),
    )
    .replaceAll(/[\t ]+/g, ' ')
    .replaceAll(/\s*\n\s*/g, '\n')
    .trim();
  return text ? text.slice(0, MAX_TEXT_LENGTH) : undefined;
};

/**
 * Creates a bounded, read-only Confluence client over Composio tools.
 *
 * Use when:
 * - Onboarding analysis should read the team pages an admin connected
 *
 * Expects:
 * - An ACTIVE Composio Confluence connected account owned by `userId`
 * - Only page reads are relied on: Composio-managed Confluence auth does not grant
 *   space or CQL search scopes, so a page's space comes from its link
 *
 * Returns:
 * - Recent current pages with absolute URLs, space keys and bounded plain text
 */
export const createConfluenceConnectorClient = (
  options: ComposioConnectorOptions,
): ConfluenceConnectorClient => {
  const run = createComposioToolRunner('confluence', options);

  return {
    listRecentPages: async ({ maxResults = DEFAULT_PAGES } = {}) => {
      const data = await run(LIST_PAGES_TOOL_SLUG, 'listRecentPages', {
        body_format: 'storage',
        limit: Math.min(Math.max(1, Math.trunc(maxResults) || DEFAULT_PAGES), MAX_PAGE_SIZE),
        sort: '-modified-date',
        status: 'current',
      });
      const base = str(toRecord(readComposioField(data, '_links'))?.base);
      const results = readComposioField(data, 'results');
      if (!base || !Array.isArray(results)) {
        throw new ConnectorDataError({
          cause: data,
          code: 'confluence_response_invalid',
          operation: 'listRecentPages',
          provider: 'confluence',
          retryable: false,
        });
      }

      return results.flatMap((value): ConfluencePage[] => {
        const page = toRecord(value);
        const id = str(page?.id);
        const title = str(page?.title);
        const webui = str(toRecord(page?._links)?.webui);
        if (!page || !id || !title || !webui) return [];
        const rawSpaceKey = SPACE_KEY_IN_PATH.exec(webui)?.[1];
        const spaceKey = rawSpaceKey ? decodePathSegment(rawSpaceKey) : undefined;
        const storage = str(toRecord(toRecord(page.body)?.storage)?.value);
        return [
          {
            id,
            // A page whose space can't be read counts as personal, so the default filter skips it.
            isPersonalSpace: !spaceKey || spaceKey.startsWith('~'),
            spaceKey,
            text: storage ? confluenceStorageToText(storage) : undefined,
            title,
            updatedAt: str(toRecord(page.version)?.createdAt) ?? str(page.createdAt),
            url: `${base}${webui}`,
          },
        ];
      });
    },
  };
};
