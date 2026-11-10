import { describe, expect, it } from 'vitest';

import { RawGeneratedCriteriaSchema } from '../schema';
import offSchemaEnums from './fixtures/planGenOffSchemaEnums.json';

/**
 * DeepSeek does not enforce JSON-schema enums and writes evidence modalities
 * into `type`. In production that failed the whole parse for ~40% of Task
 * acceptances, which then fell back to the single holistic row.
 */
describe('RawGeneratedCriteriaSchema', () => {
  it('keeps criteria whose evidence type is a modality value', () => {
    const parsed = RawGeneratedCriteriaSchema.safeParse(offSchemaEnums);

    expect(parsed.success).toBe(true);
    const criteria = parsed.success ? parsed.data.criteria : [];
    expect(criteria.map((c) => c.title)).toEqual([
      'Report document is delivered',
      'Metrics are computed per group',
      'Charts render',
    ]);
    expect(criteria[0].requiredEvidence?.map((e) => e.type)).toEqual(['markdown']);
    expect(criteria[1].requiredEvidence?.map((e) => e.type)).toEqual(['text', 'text']);
  });

  it('drops an unmappable evidence spec without dropping its criterion', () => {
    const parsed = RawGeneratedCriteriaSchema.parse(offSchemaEnums);

    expect(parsed.criteria[2].requiredEvidence).toEqual([]);
  });

  it('drops only a criterion with an unknown verifier type', () => {
    const parsed = RawGeneratedCriteriaSchema.parse(offSchemaEnums);

    expect(parsed.criteria.some((c) => c.title === 'Unknown verifier')).toBe(false);
  });
});
