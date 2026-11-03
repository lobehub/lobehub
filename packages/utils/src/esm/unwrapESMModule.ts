export const unwrapESMModule = <T>(mod: unknown): T => {
  if (!mod) return mod as T;
  if (typeof mod !== 'object') return mod as T;

  // In Vitest, mocked ESM modules are proxied and accessing a missing export can throw,
  // so we must check existence without reading `mod.default` first.
  const record = mod as Record<string, unknown>;
  if ('default' in record) return (record.default as T) ?? (mod as T);

  return mod as T;
};

