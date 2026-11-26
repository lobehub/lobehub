import { createLobeHub, type LobeHubOptions } from '@lobehub/sdk';

/** Shared setup: `LOBEHUB_API_KEY` (required), `LOBEHUB_BASE_URL` (optional). */
export const options = (): LobeHubOptions => {
  const apiKey = process.env.LOBEHUB_API_KEY;
  if (!apiKey) throw new Error('Set LOBEHUB_API_KEY to an API key (sk-lh-...)');
  return { apiKey, baseURL: process.env.LOBEHUB_BASE_URL };
};

export const lobehub = () => createLobeHub(options());
