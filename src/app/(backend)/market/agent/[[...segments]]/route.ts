import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { MarketService } from '@/server/services/market';

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};

const methodNotAllowed = (methods: string[]) =>
  NextResponse.json(
    {
      error: 'method_not_allowed',
      message: `Allowed methods: ${methods.join(', ')}`,
      status: 'error',
    },
    {
      headers: { Allow: methods.join(', ') },
      status: 405,
    },
  );

const badRequest = (error: string, message: string) =>
  NextResponse.json(
    {
      error,
      message,
      status: 'error',
    },
    { status: 400 },
  );

const notFound = (reason: string) =>
  NextResponse.json(
    {
      error: 'not_found',
      message: reason,
      status: 'error',
    },
    { status: 404 },
  );

const handleAgent = async (req: NextRequest, segments: string[]) => {
  const marketService = await MarketService.createFromRequest(req);
  const market = marketService.market;

  if (segments.length === 0) {
    return notFound('Missing agent action.');
  }

  const [action, ...rest] = segments;

  if (action === 'create') {
    if (req.method !== 'POST') return methodNotAllowed(['POST']);

    try {
      const payload = await req.json();
      const response = await market.agents.createAgent(payload);
      return NextResponse.json(response);
    } catch (error) {
      console.error('[Market] Failed to create agent:', error);
      return NextResponse.json(
        {
          error: 'create_agent_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  // Get own agents (requires authentication)
  if (action === 'own') {
    if (req.method !== 'GET') return methodNotAllowed(['GET']);

    try {
      // Parse query parameters from the request URL
      const url = new URL(req.url);
      const page = url.searchParams.get('page');
      const pageSize = url.searchParams.get('pageSize');

      const response = await market.agents.getOwnAgents({
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      });

      return NextResponse.json(response);
    } catch (error) {
      console.error('[Market] Failed to get own agents:', error);
      return NextResponse.json(
        {
          error: 'get_own_agents_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  if (action === 'versions') {
    if (rest.length !== 1 || rest[0] !== 'create') {
      return notFound('Requested agent version endpoint is not available.');
    }

    if (req.method !== 'POST') return methodNotAllowed(['POST']);

    try {
      const payload = await req.json();
      if (typeof payload !== 'object' || payload === null) {
        return badRequest('invalid_payload', 'Request body must be a JSON object.');
      }

      const identifier = (payload as { identifier?: string }).identifier;
      if (!identifier) {
        return badRequest('missing_identifier', 'Identifier is required to create agent version.');
      }

      const response = await market.agents.createAgentVersion(payload);
      return NextResponse.json(response);
    } catch (error) {
      console.error('[Market] Failed to create agent version:', error);
      return NextResponse.json(
        {
          error: 'create_agent_version_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  // Handle agent status actions: /agent/{identifier}/{action}
  // Actions: publish, unpublish, deprecate
  if (segments.length === 2) {
    const [identifier, statusAction] = segments;

    if (!['publish', 'unpublish', 'deprecate'].includes(statusAction)) {
      return notFound(`Unknown agent action: ${statusAction}`);
    }

    if (req.method !== 'POST') return methodNotAllowed(['POST']);

    try {
      let response;
      switch (statusAction) {
        case 'publish': {
          response = await market.agents.publish(identifier);
          break;
        }
        case 'unpublish': {
          response = await market.agents.unpublish(identifier);
          break;
        }
        case 'deprecate': {
          response = await market.agents.deprecate(identifier);
          break;
        }
      }
      return NextResponse.json(response ?? { success: true });
    } catch (error) {
      console.error(`[Market] Failed to ${statusAction} agent:`, error);
      return NextResponse.json(
        {
          error: `${statusAction}_agent_failed`,
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  if (segments.length === 1) {
    if (req.method !== 'GET') return methodNotAllowed(['GET']);

    try {
      const response = await market.agents.getAgentDetail(action);
      return NextResponse.json(response);
    } catch (error) {
      console.error('[Market] Failed to get agent detail:', error);
      return NextResponse.json(
        {
          error: 'get_agent_detail_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  return notFound('Requested agent endpoint is not available.');
};

const handleProxy = async (req: NextRequest, context: RouteContext) => {
  const { segments } = await context.params;
  const normalizedSegments = segments?.map((segment) => decodeURIComponent(segment)) ?? [];

  return handleAgent(req, normalizedSegments);
};

export const GET = (req: NextRequest, context: RouteContext) => handleProxy(req, context);
export const POST = (req: NextRequest, context: RouteContext) => handleProxy(req, context);

export const dynamic = 'force-dynamic';
