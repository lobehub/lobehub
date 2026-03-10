import type { CredentialItem } from '../../ExecutionRuntime';

const MASK_MIN_PREFIX = 2;
const MASK_MIN_SUFFIX = 2;

const pathPattern = /^[\w-]+(?:\.[\w-]+)*$/;

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

export const normalizePath = (rawPath: string) =>
  rawPath
    .trim()
    .replaceAll(/\.+/g, '.')
    .replaceAll(/^\.|\.$/g, '');

const pathSegments = (path: string) => normalizePath(path).split('.').filter(Boolean);

export const isValidPath = (path: string) => pathPattern.test(path);

export const maskValue = (value: string) => {
  if (!value) return '';
  if (value.length <= MASK_MIN_PREFIX + MASK_MIN_SUFFIX) return '*'.repeat(value.length);

  const prefix = value.slice(0, MASK_MIN_PREFIX);
  const suffix = value.slice(-MASK_MIN_SUFFIX);
  const middle = '*'.repeat(Math.max(4, value.length - MASK_MIN_PREFIX - MASK_MIN_SUFFIX));

  return `${prefix}${middle}${suffix}`;
};

export const setValueAtPath = (obj: Record<string, any>, path: string, value: string) => {
  const segments = pathSegments(path);
  if (segments.length === 0) return;

  let cursor = obj;

  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }

  cursor[segments.at(-1)!] = value;
};

export const deleteAtPath = (obj: Record<string, any>, path: string): boolean => {
  const segments = pathSegments(path);
  if (segments.length === 0) return false;

  const stack: Array<{ key: string; parent: Record<string, any> }> = [];
  let cursor = obj;

  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(cursor[segment])) return false;

    stack.push({ key: segment, parent: cursor });
    cursor = cursor[segment];
  }

  const finalKey = segments.at(-1)!;
  if (!(finalKey in cursor)) return false;

  delete cursor[finalKey];

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index];
    const node = item.parent[item.key];

    if (!isPlainObject(node)) continue;
    if (Object.keys(node).length > 0) break;

    delete item.parent[item.key];
  }

  return true;
};

export const flattenStringLeaves = (
  obj: Record<string, any>,
  prefix: string[] = [],
): CredentialItem[] => {
  const items: CredentialItem[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];

    if (typeof value === 'string') {
      items.push({ path: path.join('.'), value });
      continue;
    }

    if (isPlainObject(value)) {
      items.push(...flattenStringLeaves(value, path));
    }
  }

  return items;
};

export const filterCredentialItems = (items: CredentialItem[], prefix?: string) => {
  if (!prefix) return items;

  const normalizedPrefix = normalizePath(prefix);
  if (!normalizedPrefix) return items;

  return items.filter(
    (item) => item.path === normalizedPrefix || item.path.startsWith(`${normalizedPrefix}.`),
  );
};

export const cloneKeyVaults = (input: Record<string, any>) => {
  return structuredClone(input) as Record<string, any>;
};
