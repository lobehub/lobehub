import { describe, expect, it } from 'vitest';

import {
  buildGenerateObjectSchema,
  CheckResponseSchema,
  dropNulls,
  ProposalResponseSchema,
} from '../schema';

/** Every subschema that declares `properties`, wherever it sits in the tree. */
const collectObjects = (node: any, acc: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectObjects(item, acc);
    return acc;
  }

  if (node.properties) {
    acc.push(node);
    for (const property of Object.values<any>(node.properties)) collectObjects(property, acc);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    for (const branch of node[key] ?? []) collectObjects(branch, acc);
  }
  if (node.items) collectObjects(node.items, acc);
  return acc;
};

describe('buildGenerateObjectSchema (OpenAI strict structured output)', () => {
  it('requires every property and forbids extra keys on every object node', () => {
    const built = buildGenerateObjectSchema(ProposalResponseSchema, { name: 'ReviewProposal' });
    const objects = collectObjects((built as any).schema);

    // the envelope plus the draft and the source hint
    expect(objects.length).toBeGreaterThanOrEqual(3);
    for (const node of objects) {
      expect(node.required).toEqual(Object.keys(node.properties));
      expect(node.additionalProperties).toBe(false);
    }
  });

  it('turns an optional property into a nullable one instead of leaving it out', () => {
    const built = buildGenerateObjectSchema(CheckResponseSchema, {
      name: 'ReviewCheckVerdicts',
    });
    const verdict = (built as any).schema.properties.results.items;

    // `uncertainReason` is `.optional()` in Zod: strict mode needs it present as null.
    expect(verdict.required).toContain('uncertainReason');
    expect(verdict.properties.uncertainReason.type).toEqual(['string', 'null']);
    // the evidence item keeps its optional clause label the same way
    expect(verdict.properties.evidence.items.required).toContain('clauseLabel');
  });

  it('leaves an already nullable branch alone', () => {
    const built = buildGenerateObjectSchema(ProposalResponseSchema, { name: 'ReviewProposal' });
    const sourceHint = (built as any).schema.properties.drafts.items.properties.sourceHint;

    const nullBranches = sourceHint.anyOf.filter((branch: any) => branch.type === 'null');
    expect(nullBranches).toHaveLength(1);
  });

  it('does not widen anything when strict is off', () => {
    const built = buildGenerateObjectSchema(CheckResponseSchema, {
      name: 'ReviewCheckVerdicts',
      strict: false,
    });
    const verdict = (built as any).schema.properties.results.items;

    expect(built.strict).toBe(false);
    // Zod's own output is left untouched: the optional field stays optional.
    expect(verdict.required).not.toContain('uncertainReason');
    expect(verdict.properties.uncertainReason.type).toBe('string');
  });
});

describe('dropNulls', () => {
  it('drops null optionals so Zod `.optional()` still sees undefined', () => {
    const raw = {
      results: [
        {
          confidence: 0.9,
          evidence: [{ clauseLabel: null, kind: 'supporting', quote: '验收合格' }],
          explanation: '文档已写明分阶段验收。',
          ruleId: 'rule-1',
          uncertainReason: null,
          verdict: 'passed',
        },
      ],
    };

    // the strict-mode shape is rejected as-is, which is what the normalizer fixes
    expect(CheckResponseSchema.safeParse(raw).success).toBe(false);

    const parsed = CheckResponseSchema.safeParse(dropNulls(raw));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.results[0].uncertainReason).toBeUndefined();
    expect(parsed.data.results[0].evidence[0].clauseLabel).toBeUndefined();
  });

  it('keeps nested arrays and non-null values intact', () => {
    expect(dropNulls({ a: [{ b: null, c: 1 }], d: null, e: 'x' })).toEqual({
      a: [{ c: 1 }],
      e: 'x',
    });
  });
});
