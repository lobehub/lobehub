import { isPlainRecord } from '@lobechat/utils/object';
import { z } from 'zod';

import type {
  NativeUIDocument,
  NativeUIExpression,
  NativeUINode,
  NativeUIOperation,
  NativeUIStateDefinition,
} from './types';

export const NATIVE_UI_LIMITS = {
  chartPoints: 4096,
  derived: 64,
  expressionDepth: 16,
  expressions: 2048,
  nodeDepth: 8,
  nodes: 128,
  number: 1_000_000_000_000,
  samples: 128,
  series: 8,
  state: 64,
  text: 4000,
  totalBytes: 96_000,
} as const;

const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype']);
const identifier = z
  .string()
  .regex(/^[A-Z][\w-]{0,63}$/i)
  .refine((value) => !forbiddenIds.has(value), 'Reserved identifier.');
const text = z.string().max(NATIVE_UI_LIMITS.text);
const label = z.string().trim().min(1).max(160);
const number = z.number().min(-NATIVE_UI_LIMITS.number).max(NATIVE_UI_LIMITS.number);
const scalar = z.union([number, text, z.boolean()]);

/** Both schema arity and evaluator use a closed operator list; no property traversal is allowed. */
const arity: Record<NativeUIOperation, [number, number]> = {
  add: [2, 16],
  concat: [1, 16],
  divide: [2, 2],
  equal: [2, 2],
  format: [1, 2],
  greater: [2, 2],
  if: [3, 3],
  less: [2, 2],
  max: [2, 16],
  min: [2, 16],
  multiply: [2, 16],
  round: [1, 2],
  subtract: [2, 2],
};
const expression: z.ZodType<NativeUIExpression> = z.lazy(() =>
  z.union([
    scalar,
    z.strictObject({ ref: z.string().max(80) }),
    z
      .strictObject({
        args: z.array(expression).min(1).max(16),
        op: z.enum(Object.keys(arity) as [NativeUIOperation, ...NativeUIOperation[]]),
      })
      .refine(
        (value) =>
          value.args.length >= arity[value.op][0] && value.args.length <= arity[value.op][1],
        'Invalid number of operator arguments.',
      ),
  ]),
);
const stateDefinition: z.ZodType<NativeUIStateDefinition> = z.discriminatedUnion('type', [
  z
    .strictObject({
      initial: number,
      max: number,
      min: number,
      step: number.min(0.000001).optional(),
      type: z.literal('number'),
    })
    .refine(
      (value) => value.min < value.max && value.initial >= value.min && value.initial <= value.max,
      'Invalid number range or initial value.',
    )
    .refine(
      (value) => value.step === undefined || value.step <= value.max - value.min,
      'Step exceeds the number range.',
    )
    .refine(
      (value) =>
        value.step === undefined ||
        Math.abs(
          (value.initial - value.min) / value.step -
            Math.round((value.initial - value.min) / value.step),
        ) < 0.0000001,
      'Initial value must align to the numeric step.',
    ),
  z
    .strictObject({
      initial: text,
      options: z.array(text).min(1).max(32).optional(),
      type: z.literal('string'),
    })
    .refine(
      (value) =>
        !value.options ||
        (value.options.includes(value.initial) &&
          new Set(value.options).size === value.options.length),
      'String options must be unique and include the initial value.',
    ),
  z.strictObject({ initial: z.boolean(), type: z.literal('boolean') }),
]);
const base = { id: identifier, visible: expression.optional() };
const gap = z.enum(['small', 'medium', 'large']).optional();
const option = z.strictObject({
  badge: expression.optional(),
  description: expression.optional(),
  label,
  value: scalar,
  valueLabel: expression.optional(),
});
const input = { ...base, bind: identifier, description: text.optional(), label };
const node: z.ZodType<NativeUINode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      ...base,
      children: z.array(node).min(1).max(NATIVE_UI_LIMITS.nodes),
      gap,
      type: z.literal('stack'),
    }),
    z.strictObject({
      ...base,
      children: z.array(node).min(1).max(NATIVE_UI_LIMITS.nodes),
      columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      gap,
      type: z.literal('grid'),
    }),
    z.strictObject({
      ...base,
      content: expression,
      tone: z.enum(['default', 'secondary']).optional(),
      type: z.literal('text'),
      variant: z.enum(['heading', 'body', 'caption']).optional(),
    }),
    z.strictObject({
      ...base,
      detail: expression.optional(),
      label,
      type: z.literal('metric'),
      value: expression,
    }),
    z.strictObject({ ...input, type: z.literal('slider'), unit: label.optional() }),
    z.strictObject({ ...input, type: z.literal('number'), unit: label.optional() }),
    z.strictObject({
      ...input,
      options: z.array(option).min(1).max(32),
      type: z.literal('select'),
    }),
    z.strictObject({
      ...input,
      options: z.array(option).min(1).max(32),
      type: z.literal('choices'),
    }),
    z.strictObject({
      ...base,
      chartType: z.enum(['line', 'bar', 'area']),
      currentX: expression.optional(),
      description: text.optional(),
      series: z
        .array(
          z.strictObject({
            color: z.enum(['blue', 'green', 'purple', 'orange', 'red', 'cyan']).optional(),
            id: identifier.refine((id) => id !== 'x', 'Series identifier x is reserved.'),
            label,
            y: expression,
          }),
        )
        .min(1)
        .max(NATIVE_UI_LIMITS.series),
      title: label.optional(),
      type: z.literal('chart'),
      x: z
        .strictObject({
          label: label.optional(),
          max: number,
          min: number,
          samples: z.number().int().min(2).max(NATIVE_UI_LIMITS.samples),
        })
        .refine((value) => value.min < value.max, 'Invalid chart range.'),
      yLabel: label.optional(),
    }),
    z.strictObject({
      ...base,
      action: z.literal('propose'),
      label,
      text: expression,
      type: z.literal('action'),
    }),
  ]),
);

/** Bounded iterative preflight runs BEFORE recursive schemas or JSON.stringify. */
const boundedInput = z.unknown().superRefine((input, ctx) => {
  const pending = [{ depth: 0, value: input }];
  const seen = new Set<unknown>();
  let entries = 0;
  while (pending.length > 0) {
    const { depth, value } = pending.pop()!;
    if (++entries > 12_000 || depth > 48) {
      ctx.addIssue({
        code: 'custom',
        message: 'The native UI exceeds the structural complexity limit.',
      });
      return;
    }
    if (typeof value === 'string' && value.length > NATIVE_UI_LIMITS.text) {
      ctx.addIssue({ code: 'custom', message: 'The native UI exceeds the text length limit.' });
      return;
    }
    if (Array.isArray(value) || isPlainRecord(value)) {
      if (seen.has(value)) {
        ctx.addIssue({ code: 'custom', message: 'The native UI must be an acyclic JSON tree.' });
        return;
      }
      seen.add(value);
      for (const child of Object.values(value)) pending.push({ depth: depth + 1, value: child });
    } else if (value !== null && typeof value === 'object') {
      ctx.addIssue({ code: 'custom', message: 'Only plain JSON values are supported.' });
      return;
    } else if (
      typeof value === 'function' ||
      typeof value === 'bigint' ||
      typeof value === 'symbol'
    ) {
      ctx.addIssue({ code: 'custom', message: 'Only plain JSON values are supported.' });
      return;
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(input) ?? '').byteLength > NATIVE_UI_LIMITS.totalBytes
  ) {
    ctx.addIssue({ code: 'custom', message: 'The native UI exceeds the total size limit.' });
  }
});

const document = z
  .strictObject({
    body: z.array(node).min(1).max(NATIVE_UI_LIMITS.nodes),
    derived: z.record(identifier, expression),
    fallback: z.string().trim().min(1).max(2000),
    state: z.record(identifier, stateDefinition),
    title: z.string().trim().min(1).max(120),
    version: z.literal(2),
  })
  .superRefine((doc, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      Object.keys(doc.state).length > NATIVE_UI_LIMITS.state ||
      Object.keys(doc.derived).length > NATIVE_UI_LIMITS.derived
    ) {
      issue('Too many state or derived values.');
      return;
    }
    let expressionCount = 0;
    const dependencies = new Map<string, Set<string>>();
    const contextual = new Set<string>();
    const checkExpression = (
      value: NativeUIExpression,
      allowX: boolean,
      owner?: string,
      depth = 0,
    ) => {
      if (
        ++expressionCount > NATIVE_UI_LIMITS.expressions ||
        depth > NATIVE_UI_LIMITS.expressionDepth
      ) {
        issue('The native UI exceeds the expression complexity limit.');
        return;
      }
      if (typeof value !== 'object') return;
      if ('args' in value) {
        for (const arg of value.args) checkExpression(arg, allowX, owner, depth + 1);
        return;
      }
      if (value.ref === 'x') {
        if (!allowX) issue('The x reference is only available in chart series.');
        if (owner) contextual.add(owner);
        return;
      }
      const ref = /^(state|derived)\.([A-Za-z][\w-]{0,63})$/.exec(value.ref);
      if (!ref || !Object.hasOwn(doc[ref[1] as 'state' | 'derived'], ref[2])) {
        issue(`Unknown reference: ${value.ref}`);
        return;
      }
      if (ref[1] === 'derived' && owner) dependencies.get(owner)!.add(ref[2]);
    };
    for (const key of Object.keys(doc.derived)) dependencies.set(key, new Set());
    for (const [key, value] of Object.entries(doc.derived)) checkExpression(value, true, key);
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string): boolean => {
      if (visiting.has(key)) return false;
      if (visited.has(key)) return true;
      visiting.add(key);
      for (const dependency of dependencies.get(key) ?? []) {
        if (!visit(dependency)) return false;
        if (contextual.has(dependency)) contextual.add(key);
      }
      visiting.delete(key);
      visited.add(key);
      return true;
    };
    for (const key of dependencies.keys()) {
      if (!visit(key)) {
        issue('Derived values cannot contain dependency cycles.');
        return;
      }
    }
    const checkDisplayExpression = (value: NativeUIExpression, allowX = false) => {
      checkExpression(value, allowX);
      const pending = [value];
      while (pending.length) {
        const current = pending.pop()!;
        if (typeof current !== 'object') continue;
        if ('args' in current) pending.push(...current.args);
        else if (
          !allowX &&
          current.ref.startsWith('derived.') &&
          contextual.has(current.ref.slice(8))
        )
          issue('Contextual derived values may only be used in chart series.');
      }
    };
    const ids = new Set<string>();
    let nodeCount = 0;
    let chartPoints = 0;
    const checkNode = (item: NativeUINode, depth: number) => {
      if (++nodeCount > NATIVE_UI_LIMITS.nodes || depth > NATIVE_UI_LIMITS.nodeDepth) {
        issue('The native UI exceeds the node complexity limit.');
        return;
      }
      if (ids.has(item.id)) issue(`Duplicate node identifier: ${item.id}`);
      ids.add(item.id);
      if (item.visible !== undefined) checkDisplayExpression(item.visible);
      if ('children' in item) for (const child of item.children) checkNode(child, depth + 1);
      if ('bind' in item) {
        const definition = doc.state[item.bind];
        if (!Object.hasOwn(doc.state, item.bind)) issue(`Unknown state binding: ${item.bind}`);
        else if (item.type === 'slider' || item.type === 'number') {
          if (definition.type !== 'number') issue('Number controls require numeric state.');
        } else if ('options' in item) {
          if (new Set(item.options.map(({ value }) => value)).size !== item.options.length)
            issue('Choice values must be unique.');
          if (!item.options.some(({ value }) => value === definition.initial))
            issue('Choices must include their initial state value.');
          for (const option of item.options) {
            if (
              typeof option.value !== typeof definition.initial ||
              (definition.type === 'string' &&
                definition.options &&
                !definition.options.includes(String(option.value))) ||
              (definition.type === 'number' &&
                (Number(option.value) < definition.min ||
                  Number(option.value) > definition.max ||
                  (definition.step !== undefined &&
                    Math.abs(
                      (Number(option.value) - definition.min) / definition.step -
                        Math.round((Number(option.value) - definition.min) / definition.step),
                    ) >= 0.0000001)))
            )
              issue('Choice value does not match its state definition.');
            if (option.description !== undefined) checkDisplayExpression(option.description);
            if (option.valueLabel !== undefined) checkDisplayExpression(option.valueLabel);
            if (option.badge !== undefined) checkDisplayExpression(option.badge);
          }
        }
      }
      if (item.type === 'text') checkDisplayExpression(item.content);
      if (item.type === 'metric') {
        checkDisplayExpression(item.value);
        if (item.detail !== undefined) checkDisplayExpression(item.detail);
      }
      if (item.type === 'action') checkDisplayExpression(item.text);
      if (item.type === 'chart') {
        chartPoints += item.x.samples * item.series.length;
        if (chartPoints > NATIVE_UI_LIMITS.chartPoints)
          issue('The native UI exceeds the chart sampling limit.');
        if (new Set(item.series.map(({ id }) => id)).size !== item.series.length)
          issue('Chart series identifiers must be unique.');
        for (const series of item.series) checkDisplayExpression(series.y, true);
        if (item.currentX !== undefined) checkDisplayExpression(item.currentX);
      }
    };
    for (const item of doc.body) checkNode(item, 0);
  });

export const NativeUIDocumentSchema: z.ZodType<NativeUIDocument> = boundedInput.pipe(document);

/** Provider-portable entry schema. Descriptions define recursive JSON; runtime validation is strict. */
export const NativeUIParameters = {
  additionalProperties: false,
  properties: {
    body: {
      description:
        'Host-native nodes, each with a unique id and type. stack:{children,gap?}; grid:{children,columns:1|2|3|4,gap?}; text:{content:expression,variant?:heading|body|caption,tone?:default|secondary}; metric:{label,value:expression,detail?:expression}; slider|number:{bind:stateKey,label,description?,unit?}; select|choices:{bind,label,description?,options:[{value:scalar,label,description?:expression,valueLabel?:expression,badge?:expression}]}; chart:{chartType:line|bar|area,x:{min,max,samples:2..128,label?},series:[{id,label,y:expression,color?:blue|green|purple|orange|red|cyan}],currentX?:expression,title?,description?,yLabel?}; action:{action:propose,label,text:expression}. Every node may have visible:expression. Container gap is small|medium|large. Chart series may reference x. No HTML, JavaScript, CSS, URLs, arbitrary props, or event handlers.',
      items: { type: 'object' },
      maxItems: NATIVE_UI_LIMITS.nodes,
      minItems: 1,
      type: 'array',
    },
    derived: {
      additionalProperties: {},
      description:
        'Named pure expressions. Expression = number|string|boolean, {ref:"state.key"|"derived.key"|"x"}, or {op,args:[expressions]}. Ops: add,multiply,min,max (2..16 args); subtract,divide,equal,less,greater (2 args); if (boolean,then,else); concat (1..16); round,format (number, optional decimal places 0..6). format returns fixed-point text. No cycles, function calls, property traversal, or JavaScript. x is available only in chart series, including derived values used by a series.',
      maxProperties: NATIVE_UI_LIMITS.derived,
      type: 'object',
    },
    fallback: {
      description: 'Useful plain-text alternative if rendering is unavailable.',
      maxLength: 2000,
      minLength: 1,
      type: 'string',
    },
    state: {
      additionalProperties: {
        oneOf: [
          {
            additionalProperties: false,
            properties: {
              initial: { type: 'number' },
              max: { type: 'number' },
              min: { type: 'number' },
              step: { minimum: 0.000001, type: 'number' },
              type: { enum: ['number'], type: 'string' },
            },
            required: ['type', 'initial', 'min', 'max'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              initial: { maxLength: NATIVE_UI_LIMITS.text, type: 'string' },
              options: {
                items: { type: 'string' },
                maxItems: 32,
                minItems: 1,
                type: 'array',
                uniqueItems: true,
              },
              type: { enum: ['string'], type: 'string' },
            },
            required: ['type', 'initial'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              initial: { type: 'boolean' },
              type: { enum: ['boolean'], type: 'string' },
            },
            required: ['type', 'initial'],
            type: 'object',
          },
        ],
      },
      description:
        'Shared scalar state keyed by identifiers. Every number has min < max and initial within range; optional step is at least 0.000001 and initial must align to it. String options, if provided, must include initial. All identifiers start with a letter, contain only letters/digits/_/-, and have at most 64 characters.',
      maxProperties: NATIVE_UI_LIMITS.state,
      type: 'object',
    },
    title: { maxLength: 120, minLength: 1, type: 'string' },
    version: { enum: [2], type: 'number' },
  },
  required: ['version', 'title', 'fallback', 'state', 'derived', 'body'],
  type: 'object',
};
