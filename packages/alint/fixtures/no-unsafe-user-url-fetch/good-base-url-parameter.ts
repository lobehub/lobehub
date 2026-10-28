// A helper fetches from its own `baseUrl` parameter. Nothing in this file says that
// URL comes from a request or a user; its caller passes deployment config.
import { z } from 'zod';

const manifestSchema = (major: number) =>
  z.object({ major: z.literal(major), revision: z.string().regex(/^[\da-f]{64}$/) });

export const resolveRuntimeUrl = async (
  major: number,
  baseUrl?: string,
): Promise<string | undefined> => {
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) return;
  const base = `${baseUrl.replace(/\/+$/, '')}/v${major}`;

  const response = await fetch(`${base}/manifest.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Runtime v${major} has not been published`);

  const manifest = manifestSchema(major).parse(await response.json());
  return `${base}/${manifest.revision}/runtime.js`;
};
