import { type IncomingMessage, type ServerResponse } from 'node:http';

import debug from 'debug';
import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';

const log = debug('lobe-oidc:http-adapter');

/**
 * Convert Next.js request headers to standard Node.js HTTP header format
 */
export const convertHeadersToNodeHeaders = (nextHeaders: Headers): Record<string, string> => {
  const headers: Record<string, string> = {};
  nextHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

/**
 * Create a Node.js HTTP request object for OIDC Provider
 * @param req Next.js request object
 */
export const createNodeRequest = async (req: NextRequest): Promise<IncomingMessage> => {
  // Build URL object
  const url = new URL(req.url);

  // Compute path relative to prefix
  let providerPath = url.pathname;

  // Ensure path always starts with /
  if (!providerPath.startsWith('/')) {
    providerPath = '/' + providerPath;
  }

  log('Creating Node.js request from Next.js request');
  log('Original path: %s, Provider path: %s', url.pathname, providerPath);

  // Attempt to parse and attach body for relevant methods
  let parsedBody: any = undefined;
  const methodsWithBody = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (methodsWithBody.includes(req.method)) {
    const contentType = req.headers.get('content-type')?.split(';')[0]; // Get content type without charset etc.
    log(`Attempting to parse body for ${req.method} with Content-Type: ${contentType}`);
    try {
      // Check if body exists and has size before attempting to parse
      if (req.body && req.headers.get('content-length') !== '0') {
        if (contentType === 'application/x-www-form-urlencoded') {
          const formData = await req.formData();
          parsedBody = {};
          formData.forEach((value, key) => {
            // If a key appears multiple times, keep the last one (standard form behavior)
            // Or convert to array if oidc-provider expects it:
            // if (parsedBody[key]) {
            //   if (!Array.isArray(parsedBody[key])) parsedBody[key] = [parsedBody[key]];
            //   parsedBody[key].push(value);
            // } else {
            //   parsedBody[key] = value;
            // }
            parsedBody[key] = value;
          });
          log('Parsed form data body: %O', parsedBody);
        } else if (contentType === 'application/json') {
          parsedBody = await req.json();
          log('Parsed JSON body: %O', parsedBody);
        } else {
          log(`Body parsing skipped for Content-Type: ${contentType}. Trying text() as fallback.`);
          // Fallback: try reading as text if content type is unknown but body exists
          parsedBody = await req.text();
          log('Parsed body as text fallback.');
        }
      } else {
        log('Request has no body or content-length is 0, skipping parsing.');
      }
    } catch (error) {
      log('Error parsing request body: %O', error);
      // Keep parsedBody as undefined, let oidc-provider handle the potential issue
    }
  }
  const nodeRequest = {
    // Basic properties
    headers: convertHeadersToNodeHeaders(req.headers),

    method: req.method,
    // Simulate readable stream behavior (oidc-provider might not rely on this if body is pre-parsed)
    // eslint-disable-next-line @typescript-eslint/ban-types
    on: (event: string, handler: Function) => {
      if (event === 'end') {
        // Simulate end immediately as body is already processed or will be attached
        handler();
      }
    },
    // Add extra properties expected by the Node.js server
    socket: {
      remoteAddress: req.headers.get('x-forwarded-for') || '127.0.0.1',
    },
    url: providerPath + url.search,
    ...(parsedBody !== undefined && { body: parsedBody }), // Attach body if it exists
  };

  log('Node.js request created with method %s and path %s', nodeRequest.method, nodeRequest.url);
  if (nodeRequest.body) {
    log('Attached parsed body to Node.js request.');
  }
  // Cast back to IncomingMessage for the function's return signature
  return nodeRequest as unknown as IncomingMessage;
};

/**
 * Response collector interface for capturing OIDC Provider responses
 */
export interface ResponseCollector {
  nodeResponse: ServerResponse;
  readonly responseBody: string | Buffer;
  readonly responseHeaders: Record<string, string | string[]>;
  readonly responseStatus: number;
}

/**
 * Create a Node.js HTTP response object for OIDC Provider
 * @param resolvePromise Resolution function called when the response completes
 */
export const createNodeResponse = (resolvePromise: () => void): ResponseCollector => {
  log('Creating Node.js response collector');

  // Object to store response state
  const state = {
    responseBody: '' as string | Buffer,
    responseHeaders: {} as Record<string, string | string[]>,
    responseStatus: 200,
  };

  let promiseResolved = false;

  const nodeResponse: any = {
    end: (chunk?: string | Buffer) => {
      log('NodeResponse.end called');
      if (chunk) {
        log('NodeResponse.end chunk: %s', typeof chunk === 'string' ? chunk : '(Buffer)');
        // @ts-ignore
        state.responseBody += chunk;
      }

      const locationHeader = state.responseHeaders['location'];
      if (locationHeader && state.responseStatus === 200) {
        log('Location header detected with status 200, overriding to 302');
        state.responseStatus = 302;
      }

      if (!promiseResolved) {
        log('Resolving response promise');
        promiseResolved = true;
        resolvePromise();
      }
    },

    getHeader: (name: string) => {
      const lowerName = name.toLowerCase();
      return state.responseHeaders[lowerName];
    },

    getHeaderNames: () => {
      return Object.keys(state.responseHeaders);
    },

    getHeaders: () => {
      return state.responseHeaders;
    },

    headersSent: false,

    removeHeader: (name: string) => {
      const lowerName = name.toLowerCase();
      log('Removing header: %s', lowerName);
      delete state.responseHeaders[lowerName];
    },

    setHeader: (name: string, value: string | string[]) => {
      const lowerName = name.toLowerCase();
      log('Setting header: %s = %s', lowerName, value);
      state.responseHeaders[lowerName] = value;
    },

    write: (chunk: string | Buffer) => {
      log('NodeResponse.write called with chunk');
      // @ts-ignore
      state.responseBody += chunk;
    },

    writeHead: (status: number, headers?: Record<string, string | string[]>) => {
      log('NodeResponse.writeHead called with status: %d', status);
      state.responseStatus = status;

      if (headers) {
        const lowerCaseHeaders = Object.entries(headers).reduce(
          (acc, [key, value]) => {
            acc[key.toLowerCase()] = value;
            return acc;
          },
          {} as Record<string, string | string[]>,
        );
        state.responseHeaders = { ...state.responseHeaders, ...lowerCaseHeaders };
      }

      (nodeResponse as any).headersSent = true;
    },
  } as unknown as ServerResponse;

  log('Node.js response collector created successfully');

  return {
    nodeResponse,
    get responseBody() {
      return state.responseBody;
    },
    get responseHeaders() {
      return state.responseHeaders;
    },
    get responseStatus() {
      return state.responseStatus;
    },
  };
};

/**
 * Create context (req, res) for calling provider.interactionDetails
 * @param uid Interaction ID
 */
export const createContextForInteractionDetails = async (
  uid: string,
): Promise<{ req: IncomingMessage; res: ServerResponse }> => {
  log('Creating context for interaction details for uid: %s', uid);
  const baseUrl = appEnv.APP_URL!;
  log('Using base URL: %s', baseUrl);

  // Extract hostname and protocol from baseUrl for headers
  const parsedUrl = new URL(baseUrl);
  const hostName = parsedUrl.host;
  const protocol = parsedUrl.protocol.replace(':', '');

  // 1. Get real cookies
  const cookieStore = await cookies();
  const realCookies: Record<string, string> = {};
  cookieStore.getAll().forEach((cookie) => {
    realCookies[cookie.name] = cookie.value;
  });
  log('Real cookies found: %o', Object.keys(realCookies));

  // Specifically check for interaction session cookie
  const interactionCookieName = `_interaction_${uid}`;
  if (realCookies[interactionCookieName]) {
    log('Found interaction session cookie: %s', interactionCookieName);
  } else {
    log('Warning: Interaction session cookie not found: %s', interactionCookieName);
  }

  // 2. Build headers containing real cookies
  const headers = new Headers({
    'host': hostName,
    'x-forwarded-host': hostName,
    'x-forwarded-proto': protocol,
  });
  const cookieString = Object.entries(realCookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  if (cookieString) {
    headers.set('cookie', cookieString);
    log('Setting cookie header');
  } else {
    log('No cookies found to set in header');
  }

  // 3. Create mock NextRequest
  // Note: IP, geo, ua and other fields here may be required by certain oidc-provider features.
  // If related issues arise, they may need to be extracted from real request headers (e.g., 'x-forwarded-for', 'user-agent')
  const interactionUrl = urlJoin(baseUrl, `/oauth/consent/${uid}`);
  log('Creating interaction URL: %s', interactionUrl);

  const mockNextRequest = {
    cookies: {
      // Simulate NextRequestCookies interface
      get: (name: string) => cookieStore.get(name)?.value,
      getAll: () => cookieStore.getAll(),
      has: (name: string) => cookieStore.has(name),
    },
    geo: {},
    headers: headers,
    ip: '127.0.0.1',
    method: 'GET',
    nextUrl: new URL(interactionUrl),
    page: { name: undefined, params: undefined },
    ua: undefined,
    url: new URL(interactionUrl),
  } as unknown as NextRequest;
  log('Mock NextRequest created for url: %s', mockNextRequest.url);

  // 4. Use createNodeRequest to create a mock Node.js IncomingMessage
  // pathPrefix is set to '/' because our URL is already in the path format expected by the Provider: /interaction/:uid
  const req: IncomingMessage = await createNodeRequest(mockNextRequest);
  // @ts-ignore - Attach parsed cookies to the mock Node.js request
  req.cookies = realCookies;
  log('Node.js IncomingMessage created, attached real cookies');

  // 5. Use createNodeResponse to create a mock Node.js ServerResponse
  let resolveFunc: () => void;
  new Promise<void>((resolve) => {
    resolveFunc = resolve;
  });

  const responseCollector: ResponseCollector = createNodeResponse(() => resolveFunc());
  const res: ServerResponse = responseCollector.nodeResponse;
  log('Node.js ServerResponse created');

  return { req, res };
};
