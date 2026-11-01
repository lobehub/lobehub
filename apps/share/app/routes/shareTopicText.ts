import { TRPCClientError } from '@trpc/client';
import type { LoaderFunctionArgs } from 'react-router';

import { cloudflareContext } from '../lib/cloudflareContext';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;
  const client = createServerLambdaClient(request, apiBase);
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };

  try {
    const { text, title } = await client.share.getSharedTopicText.query({ shareId: params.id! });
    return new Response([title ? `# ${title}` : '', text].filter(Boolean).join('\n\n'), {
      headers,
    });
  } catch (error) {
    const status = error instanceof TRPCClientError ? (error.data?.httpStatus ?? 502) : 502;
    const message = status === 404 ? 'Share not found' : 'Unable to read this shared topic';
    return new Response(message, { headers, status });
  }
};
