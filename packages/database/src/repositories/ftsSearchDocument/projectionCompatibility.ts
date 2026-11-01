import type {
  ElasticsearchFtsSearchFieldType,
  ElasticsearchFtsSearchMappingProperty,
} from './mappings';
import { FTS_SEARCH_INDEX_DEFINITIONS } from './mappings';
import { FTS_SEARCH_RETAINED_SOURCE_PROPERTIES } from './policy';
import type { FtsSearchDocumentEntity } from './zodSchema';

export type FtsSearchTargetMappingProperties = Record<
  string,
  {
    analyzer?: string;
    fields?: Record<string, unknown>;
    type?: string;
  }
>;

export type FtsSearchProjectionIncompatibility =
  | {
      field: string;
      kind: 'missing_current_field';
      targetType: string | undefined;
    }
  | {
      currentType: ElasticsearchFtsSearchFieldType;
      field: string;
      kind: 'incompatible_type';
      targetType: string | undefined;
    };

export interface FtsSearchProjectionCompatibility {
  compatible: boolean;
  incompatibleFields: {
    currentType: ElasticsearchFtsSearchFieldType;
    field: string;
    targetType: string | undefined;
  }[];
  missingFields: string[];
}

const isStringMappingType = (type: string | undefined) => type === 'keyword' || type === 'text';

const findIncompatibilitiesForProperties = (
  currentProperties: Record<string, ElasticsearchFtsSearchMappingProperty>,
  targetProperties: FtsSearchTargetMappingProperties,
): FtsSearchProjectionIncompatibility[] => {
  const incompatibilities: FtsSearchProjectionIncompatibility[] = [];

  for (const field of Object.keys(targetProperties).sort()) {
    const targetType = targetProperties[field].type;
    const currentProperty = currentProperties[field];
    if (!currentProperty) {
      incompatibilities.push({ field, kind: 'missing_current_field', targetType });
      continue;
    }

    const currentType = currentProperty.type;
    if (currentType === targetType) continue;
    if (isStringMappingType(currentType) && isStringMappingType(targetType)) continue;

    incompatibilities.push({
      currentType,
      field,
      kind: 'incompatible_type',
      targetType,
    });
  }

  return incompatibilities;
};

const summarizeIncompatibilities = (
  issues: FtsSearchProjectionIncompatibility[],
): FtsSearchProjectionCompatibility => {
  const missingFields = issues
    .filter((issue) => issue.kind === 'missing_current_field')
    .map((issue) => issue.field);
  const incompatibleFields = issues
    .filter((issue) => issue.kind === 'incompatible_type')
    .map(({ currentType, field, targetType }) => ({ currentType, field, targetType }));

  return {
    compatible: issues.length === 0,
    incompatibleFields,
    missingFields,
  };
};

/**
 * Finds target fields that the current document projection cannot preserve during multi-generation
 * sync. A target may omit newly added fields, while every field it still maps must exist in the
 * current source shape with a compatible JSON value type.
 */
export const findFtsSearchProjectionIncompatibilities = (
  entity: FtsSearchDocumentEntity,
  targetProperties: FtsSearchTargetMappingProperties,
): FtsSearchProjectionIncompatibility[] => {
  const currentProperties: Record<string, ElasticsearchFtsSearchMappingProperty> = {
    ...FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.properties,
    ...FTS_SEARCH_RETAINED_SOURCE_PROPERTIES[entity],
  };
  return findIncompatibilitiesForProperties(currentProperties, targetProperties);
};

/** Pure compatibility check used to validate retained-source bridge definitions in isolation. */
export const getFtsSearchProjectionCompatibilityForProperties = (
  currentProperties: Record<string, ElasticsearchFtsSearchMappingProperty>,
  targetProperties: FtsSearchTargetMappingProperties,
): FtsSearchProjectionCompatibility =>
  summarizeIncompatibilities(
    findIncompatibilitiesForProperties(currentProperties, targetProperties),
  );

/** Summarizes whether the current source projection can populate every target mapping field. */
export const getFtsSearchProjectionCompatibility = (
  entity: FtsSearchDocumentEntity,
  targetProperties: FtsSearchTargetMappingProperties,
): FtsSearchProjectionCompatibility => {
  const issues = findFtsSearchProjectionIncompatibilities(entity, targetProperties);
  return summarizeIncompatibilities(issues);
};

/** Removes source-only compatibility fields before writing the current physical generation. */
export const pruneFtsSearchDocumentForMapping = (
  entity: FtsSearchDocumentEntity,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const mappedFields = new Set(
    Object.keys(FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.properties),
  );
  return Object.fromEntries(Object.entries(source).filter(([field]) => mappedFields.has(field)));
};
