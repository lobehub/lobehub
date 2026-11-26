import { signInternalJWT } from '@/libs/trpc/utils/internalJwt';

/** Local queue fallback crosses HTTP instead of pulling the full agent executor into tools lambdas. */
export async function postLocalMcpCallback(endpoint: string, payload: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lobe-Mcp-Internal': await signInternalJWT() },
    body: JSON.stringify({ payload }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Local MCP callback failed: HTTP ${response.status}`);
}
