import { describe, expect, it } from 'vitest';

import type { FtsSearchDocumentEntity } from '../../ftsSearchDocument';
import { FTS_SEARCH_INDEX_DEFINITIONS } from '../../ftsSearchDocument';
import { FTS_SEARCH_BACKEND_ENTITIES } from '../types';
import {
  ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_DOCUMENT_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS,
  ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS,
  isElasticsearchFtsSearchEntity,
} from './query-fields';

/** Every query-field list paired with the index definition its field paths must resolve against. */
const QUERY_FIELDS_BY_INDEX: Array<[FtsSearchDocumentEntity, readonly string[]]> = [
  ...Object.entries(ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS),
  ...Object.entries(ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS),
  ...Object.entries(ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS),
  ...Object.values(ELASTICSEARCH_FTS_SEARCH_DOCUMENT_QUERY_FIELDS).map(
    (fields) => ['documents', fields] as const,
  ),
] as Array<[FtsSearchDocumentEntity, readonly string[]]>;

const resolveMappingPath = (entity: FtsSearchDocumentEntity, path: string) => {
  const [field, subfield, ...rest] = path.split('.');
  if (rest.length > 0) return;
  const property = FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.properties[
    field as keyof (typeof FTS_SEARCH_INDEX_DEFINITIONS)[typeof entity]['mappings']['properties']
  ] as { fields?: Record<string, { type: string }>; type: string } | undefined;
  if (!property) return;
  return subfield ? property.fields?.[subfield] : property;
};

describe('Elasticsearch query field coverage', () => {
  it('covers every full-text search backend entity', () => {
    expect(
      FTS_SEARCH_BACKEND_ENTITIES.filter((entity) => !isElasticsearchFtsSearchEntity(entity)),
    ).toEqual([]);
  });

  it.each(QUERY_FIELDS_BY_INDEX)(
    'binds every %s query field to a searchable field in its index mapping',
    (entity, fields) => {
      for (const weightedField of fields) {
        const [path, boost] = weightedField.split('^');
        const mapping = resolveMappingPath(entity, path);

        expect(
          mapping,
          `${entity} query field "${path}" does not exist in FTS_SEARCH_INDEX_DEFINITIONS.${entity}.mappings`,
        ).toBeDefined();
        expect(
          ['keyword', 'text'],
          `${entity} query field "${path}" is not searchable text`,
        ).toContain(mapping!.type);
        if (boost !== undefined) expect(Number(boost)).toBeGreaterThan(0);
      }
    },
  );
});
