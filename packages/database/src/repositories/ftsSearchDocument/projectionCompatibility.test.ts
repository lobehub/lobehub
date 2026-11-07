import { describe, expect, it } from 'vitest';

import {
  findFtsSearchProjectionIncompatibilities,
  type FtsSearchTargetMappingProperties,
  getFtsSearchProjectionCompatibilityForProperties,
  pruneFtsSearchDocumentForMapping,
} from './projectionCompatibility';

describe('findFtsSearchProjectionIncompatibilities', () => {
  it('rejects fields required by an older target after they are removed or renamed', () => {
    expect(
      findFtsSearchProjectionIncompatibilities('agents', {
        legacy_title: { type: 'text' },
        title: { type: 'text' },
      }),
    ).toEqual([
      {
        field: 'legacy_title',
        kind: 'missing_current_field',
        targetType: 'text',
      },
    ]);
  });

  it('rejects incompatible value type changes', () => {
    expect(
      findFtsSearchProjectionIncompatibilities('agents', {
        virtual: { type: 'keyword' },
      }),
    ).toEqual([
      {
        currentType: 'boolean',
        field: 'virtual',
        kind: 'incompatible_type',
        targetType: 'keyword',
      },
    ]);
  });

  it('rejects a target field without a concrete value type', () => {
    expect(
      findFtsSearchProjectionIncompatibilities('agents', {
        virtual: {},
      }),
    ).toEqual([
      {
        currentType: 'boolean',
        field: 'virtual',
        kind: 'incompatible_type',
        targetType: undefined,
      },
    ]);
  });

  it('allows fields added only to the current mapping', () => {
    expect(
      findFtsSearchProjectionIncompatibilities('agents', {
        id: { type: 'keyword' },
      }),
    ).toEqual([]);
  });

  it.each([
    ['text target for keyword source', { id: { analyzer: 'other', type: 'text' } }],
    [
      'keyword target for text source',
      {
        title: {
          fields: { raw: { ignore_above: 64, type: 'keyword' } },
          type: 'keyword',
        },
      },
    ],
  ] satisfies [string, FtsSearchTargetMappingProperties][])('allows %s', (_name, properties) => {
    expect(findFtsSearchProjectionIncompatibilities('agents', properties)).toEqual([]);
  });

  it('allows a removed field when the current source retains a compatible bridge property', () => {
    expect(
      getFtsSearchProjectionCompatibilityForProperties(
        { id: { type: 'keyword' }, legacy_title: { type: 'text' } },
        { id: { type: 'keyword' }, legacy_title: { type: 'keyword' } },
      ),
    ).toEqual({ compatible: true, incompatibleFields: [], missingFields: [] });
  });

  it('prunes source-only fields before writing the current mapping', () => {
    expect(
      pruneFtsSearchDocumentForMapping('agents', {
        id: 'agent-1',
        legacy_title: 'legacy',
        title: 'current',
      }),
    ).toEqual({ id: 'agent-1', title: 'current' });
  });
});
