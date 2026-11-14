import type { z } from 'zod';

/** Repairs are applied in passes; each pass fixes every issue the previous parse reported. */
const MAX_PASSES = 20;

type Path = PropertyKey[];
type Container = Record<PropertyKey, unknown>;

const isRecord = (value: unknown): value is Container =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>((value, key) => (value as Container | undefined)?.[key], root);

/** The object schema behind wrappers (optional, nullable, default, preprocess…), if any. */
const objectShape = (schema: z.ZodType | undefined): Record<string, z.ZodType> | undefined => {
  const def = (schema as any)?._zod?.def;
  if (!def) return undefined;
  if (def.type === 'object') return def.shape;
  if (def.type === 'pipe') return objectShape(def.out) ?? objectShape(def.in);
  if (def.type === 'lazy') return objectShape(def.getter());
  if (def.innerType) return objectShape(def.innerType);
  return undefined;
};

/** The schema that validates the value at `path`, following object keys and array items. */
const schemaAt = (schema: z.ZodType | undefined, path: Path): z.ZodType | undefined => {
  let current = schema;
  for (const key of path) {
    const def = (current as any)?._zod?.def;
    if (!def) return undefined;
    if (typeof key === 'number') {
      let inner = current as any;
      while (inner?._zod?.def && inner._zod.def.type !== 'array') {
        const d = inner._zod.def;
        inner = d.type === 'pipe' ? d.out : d.type === 'lazy' ? d.getter() : d.innerType;
      }
      current = inner?._zod?.def?.element;
    } else {
      current = objectShape(current)?.[key as string];
    }
  }
  return current;
};

const coerce = (expected: string | undefined, value: unknown): { value: unknown } | undefined => {
  if (expected === 'number' && typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    if (Number.isFinite(number)) return { value: number };
  }
  if (expected === 'boolean' && typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === 'false') return { value: text === 'true' };
  }
  if (expected === 'string' && (typeof value === 'number' || typeof value === 'boolean'))
    return { value: String(value) };
  if (expected === 'array' && value !== null && value !== undefined && !Array.isArray(value))
    return { value: [value] };
  return undefined;
};

/**
 * Parses model output against a strict extraction schema, repairing the ways models drift
 * instead of rejecting the whole answer: keys outside the schema are dropped (or moved back
 * into the nested object they belong to), an off-list value goes under `other` when the list
 * has one, numbers that overshoot a bound are clamped, scalars spelled as strings are read as
 * such, and null counts as absent. An entry still invalid after that is dropped from its list,
 * so one bad memory does not cost the topic its others.
 *
 * Throws the original validation error when nothing can be repaired, e.g. the output is not
 * the expected object at all.
 */
export const parseLenient = <T>(
  schema: z.ZodType<T>,
  value: unknown,
): { data: T; repairs: string[] } => {
  const repairs: string[] = [];
  const current: unknown = structuredClone(value);
  let firstError: z.ZodError | undefined;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const result = schema.safeParse(current);
    if (result.success) return { data: result.data, repairs };
    firstError ??= result.error;

    let changed = false;
    /** Entries to drop, per list, applied after the other repairs so indexes stay valid. */
    const drops = new Map<unknown[], { indexes: Set<number>; path: Path }>();

    const drop = (path: Path) => {
      const index = path.findLastIndex((key) => typeof key === 'number');
      if (index < 0) return;
      const listPath = path.slice(0, index);
      const list = at(current, listPath);
      if (!Array.isArray(list)) return;
      const entry = drops.get(list) ?? { indexes: new Set<number>(), path: listPath };
      entry.indexes.add(path[index] as number);
      drops.set(list, entry);
    };

    const set = (path: Path, next: unknown, note: string) => {
      const parent = at(current, path.slice(0, -1));
      if (!isRecord(parent) && !Array.isArray(parent)) return drop(path);
      const key = path.at(-1)!;
      if (next === undefined && isRecord(parent)) delete parent[key];
      else (parent as Container)[key] = next;
      repairs.push(`${path.join('.')}: ${note}`);
      changed = true;
    };

    for (const issue of result.error.issues) {
      const path = issue.path as Path;
      const actual = at(current, path);

      if (issue.code === 'unrecognized_keys') {
        const target = at(current, path);
        if (!isRecord(target)) continue;
        const shape = objectShape(schemaAt(schema, path)) ?? {};
        for (const key of issue.keys) {
          // A field lifted out of its nested object goes back where the schema has it.
          const home = Object.keys(shape).find((name) => {
            const nested = objectShape(shape[name]);
            const child = target[name];
            return (
              nested &&
              key in nested &&
              (child === undefined || isRecord(child)) &&
              (child as Container | undefined)?.[key] === undefined
            );
          });
          if (home) {
            target[home] = { ...(target[home] as Container | undefined), [key]: target[key] };
            repairs.push(`${[...path, key].join('.')}: moved into ${home}`);
          } else {
            repairs.push(`${path.join('.') || '(root)'}: dropped key ${key}`);
          }
          delete target[key];
          changed = true;
        }
        continue;
      }

      if (path.length === 0) continue;

      if (issue.code === 'invalid_value' && issue.values.includes('other')) {
        set(path, 'other', 'other');
        continue;
      }

      if ((issue.code === 'too_big' || issue.code === 'too_small') && typeof actual === 'number') {
        const bound = Number(issue.code === 'too_big' ? issue.maximum : issue.minimum);
        if (Number.isFinite(bound)) {
          set(path, bound, `clamped to ${bound}`);
          continue;
        }
      }

      if (issue.code === 'invalid_type') {
        const coerced = coerce(issue.expected, actual);
        if (coerced) {
          set(path, coerced.value, `read as ${issue.expected}`);
          continue;
        }
        // Null for a field that does not take it: treat it as left out (a default may fill it).
        if (actual === null && isRecord(at(current, path.slice(0, -1)))) {
          set(path, undefined, 'null left out');
          continue;
        }
      }

      drop(path);
    }

    // A repair can settle issues reported next to it (a moved field fills the gap it left), so
    // entries are dropped only once a pass has nothing else to repair.
    if (changed) continue;
    for (const [list, { indexes, path }] of drops) {
      for (const index of [...indexes].sort((a, b) => b - a)) {
        list.splice(index, 1);
        repairs.push(`${[...path, index].join('.')}: dropped entry`);
      }
      changed = true;
    }

    if (!changed) break;
  }

  throw firstError ?? new Error('Output could not be repaired');
};
