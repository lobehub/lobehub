import type { WidgetLayoutNode } from '@lobechat/types';
import {
  WIDGET_LAYOUT_COLORS,
  WIDGET_LAYOUT_FORMATS,
  WIDGET_LAYOUT_ICONS,
  WIDGET_LAYOUT_LIMITS,
  WIDGET_LAYOUT_SURFACES,
} from '@lobechat/types';
import { z } from 'zod';

/**
 * Validation of `WidgetView.layout` — the declarative card template. Values
 * bound to data are checked by the renderer at display time; here only the
 * tree's shape and size are fixed, so a stored layout always renders.
 */

const path = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w$-]+(?:\.[\w$-]+)*$/, 'paths are dot-separated keys, e.g. data.hourly.0.temp');

const literal = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);

const binding = z.strictObject({
  bind: path,
  digits: z.number().int().min(0).max(6).optional(),
  fallback: literal.optional(),
  format: z.enum(WIDGET_LAYOUT_FORMATS).optional(),
  map: z.record(z.string().max(100), literal).optional(),
  pattern: z.string().max(50).optional(),
});

const template = z.strictObject({ template: z.string().max(500) });

const value = z.union([literal, binding, template]);

const condition = z.strictObject({
  bind: path,
  eq: literal.optional(),
  exists: z.boolean().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  in: z.array(literal).max(50).optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  ne: literal.optional(),
});

const gap = z.number().min(0).max(48);
const base = {
  flex: z.number().min(0).max(12).optional(),
  hideWhen: z.enum(['narrow', 'short']).optional(),
  visible: condition.optional(),
};
const justify = z.enum(['start', 'center', 'end', 'between', 'around']);

const node: z.ZodType<WidgetLayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      ...base,
      align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']).optional(),
      children: z.array(node).max(WIDGET_LAYOUT_LIMITS.nodes),
      direction: z.enum(['row', 'column']).optional(),
      gap: gap.optional(),
      justify: justify.optional(),
      padding: z.number().min(0).max(48).optional(),
      type: z.literal('stack'),
      wrap: z.boolean().optional(),
    }),
    z.strictObject({
      ...base,
      children: z.array(node).max(WIDGET_LAYOUT_LIMITS.nodes),
      columns: z.number().int().min(1).max(12),
      gap: gap.optional(),
      type: z.literal('grid'),
    }),
    z.strictObject({
      ...base,
      align: z.enum(['start', 'center', 'end']).optional(),
      lines: z.number().int().min(1).max(10).optional(),
      size: z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'display']).optional(),
      tone: z.enum(['default', 'secondary', 'tertiary', 'success', 'warning', 'error']).optional(),
      type: z.literal('text'),
      value,
      weight: z.enum(['regular', 'medium', 'semibold', 'bold']).optional(),
    }),
    z.strictObject({
      ...base,
      color: value.optional(),
      name: value,
      size: z.number().min(8).max(160).optional(),
      type: z.literal('icon'),
    }),
    z.strictObject({
      ...base,
      fit: z.enum(['cover', 'contain']).optional(),
      height: z.number().min(8).max(800).optional(),
      radius: z.number().min(0).max(400).optional(),
      src: value,
      type: z.literal('image'),
      width: z.number().min(8).max(1600).optional(),
    }),
    z.strictObject({
      ...base,
      color: value.optional(),
      max: value.optional(),
      min: value.optional(),
      type: z.literal('progress'),
      value,
    }),
    z.strictObject({
      ...base,
      children: z.array(node).max(WIDGET_LAYOUT_LIMITS.nodes).optional(),
      color: value.optional(),
      max: value.optional(),
      size: z.number().min(24).max(400).optional(),
      type: z.literal('ring'),
      value,
    }),
    z.strictObject({
      ...base,
      color: value.optional(),
      columns: z.number().int().min(1).max(60).optional(),
      total: value,
      type: z.literal('dots'),
      value,
    }),
    z.strictObject({
      ...base,
      color: value.optional(),
      height: z.number().min(8).max(400).optional(),
      key: z.string().max(100).optional(),
      kind: z.enum(['line', 'area', 'bar']).optional(),
      type: z.literal('sparkline'),
      values: path,
    }),
    z.strictObject({ ...base, color: value.optional(), type: z.literal('badge'), value }),
    z.strictObject({ ...base, type: z.literal('divider') }),
    z.strictObject({ ...base, type: z.literal('spacer') }),
    z.strictObject({
      ...base,
      direction: z.enum(['row', 'column']).optional(),
      gap: gap.optional(),
      items: path,
      justify: justify.optional(),
      limit: z.number().int().min(1).max(WIDGET_LAYOUT_LIMITS.repeat).optional(),
      template: node,
      type: z.literal('repeat'),
    }),
  ]),
);

const childrenOf = (n: WidgetLayoutNode): WidgetLayoutNode[] => {
  if (n.type === 'stack' || n.type === 'grid') return n.children;
  if (n.type === 'ring') return n.children ?? [];
  if (n.type === 'repeat') return [n.template];
  return [];
};

/** Literal colors and icon names are checked here; bound ones fall back at render time. */
const literalIssues = (n: WidgetLayoutNode): string | undefined => {
  if (
    'color' in n &&
    typeof n.color === 'string' &&
    !(WIDGET_LAYOUT_COLORS as readonly string[]).includes(n.color)
  ) {
    return `unknown color "${n.color}"; use one of ${WIDGET_LAYOUT_COLORS.join(', ')}`;
  }
  if (
    n.type === 'icon' &&
    typeof n.name === 'string' &&
    !(WIDGET_LAYOUT_ICONS as readonly string[]).includes(n.name)
  ) {
    return `unknown icon "${n.name}"`;
  }
  if (n.type === 'image' && typeof n.src === 'string' && !n.src.startsWith('https://')) {
    return 'image src must be an https URL';
  }
};

/**
 * Beyond its shape, a layout must stay small once drawn: a repeat multiplies
 * its template by its item count, so templates are weighed by `limit` (the
 * renderer's cap when unset), and a repeat may not sit inside another — nested
 * caps would multiply into millions of nodes from a small tree.
 */
export const widgetLayoutSchema = node.superRefine((root, ctx) => {
  let count = 0;
  let expanded = 0;
  const walk = (
    n: WidgetLayoutNode,
    depth: number,
    at: (string | number)[],
    weight = 1,
    inRepeat = false,
  ) => {
    count += 1;
    expanded += weight;
    if (n.type === 'repeat' && inRepeat) {
      ctx.addIssue({
        code: 'custom',
        message: 'a repeat cannot be nested in another repeat',
        path: at,
      });
      return;
    }
    if (depth > WIDGET_LAYOUT_LIMITS.depth) {
      ctx.addIssue({
        code: 'custom',
        message: `layout is nested deeper than ${WIDGET_LAYOUT_LIMITS.depth}`,
        path: at,
      });
      return;
    }
    const issue = literalIssues(n);
    if (issue) ctx.addIssue({ code: 'custom', message: issue, path: at });
    const repeat = n.type === 'repeat';
    childrenOf(n).forEach((child, index) =>
      walk(
        child,
        depth + 1,
        repeat ? [...at, 'template'] : [...at, 'children', index],
        repeat ? weight * (n.limit ?? WIDGET_LAYOUT_LIMITS.repeat) : weight,
        inRepeat || repeat,
      ),
    );
  };
  walk(root, 1, []);
  if (expanded > WIDGET_LAYOUT_LIMITS.expandedNodes) {
    ctx.addIssue({
      code: 'custom',
      message: `layout draws up to ${expanded} nodes once repeats expand; the limit is ${WIDGET_LAYOUT_LIMITS.expandedNodes} — lower repeat limits or simplify their templates`,
    });
  }
  if (count > WIDGET_LAYOUT_LIMITS.nodes) {
    ctx.addIssue({
      code: 'custom',
      message: `layout has ${count} nodes; the limit is ${WIDGET_LAYOUT_LIMITS.nodes}`,
    });
  }
});

export const widgetSurfaceSchema = z.union([z.enum(WIDGET_LAYOUT_SURFACES), binding]);
