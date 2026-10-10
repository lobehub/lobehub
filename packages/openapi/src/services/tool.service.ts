import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { builtinTools } from '@lobechat/builtin-tools';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { getServerRuntime } from '@/server/services/toolExecution/serverRuntimes';

/**
 * Builtin tool APIs callable through `/api/v1/tools`, keyed by tool identifier.
 *
 * Everything else stays agent-internal. An entry belongs here only if it is
 * safe for a caller with no LobeHub account: anonymous payers have no user,
 * agent or topic, so the API must work without them and must not touch anyone's
 * data. One request should also map to one bounded unit of work, because it is
 * sold at one price — which is why `crawlMultiPages` (an unbounded URL list) is
 * left out while `crawlSinglePage` is in.
 */
export const PUBLIC_TOOL_APIS: Record<string, readonly string[]> = {
  [WebBrowsingManifest.identifier]: [WebBrowsingApiName.search, WebBrowsingApiName.crawlSinglePage],
};

export interface PublicToolApi {
  description: string;
  name: string;
  /** JSON Schema of the request body, taken from the tool manifest. */
  parameters: unknown;
}

export interface PublicTool {
  apis: PublicToolApi[];
  description?: string;
  identifier: string;
  title?: string;
}

export interface InvokeToolParams {
  api: string;
  args: unknown;
  identifier: string;
  /** Present for authenticated callers only; anonymous payers have neither. */
  serverDB?: LobeChatDatabase;
  signal?: AbortSignal;
  userId?: string;
}

const namedError = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const manifestOf = (identifier: string) =>
  builtinTools.find((tool) => tool.identifier === identifier)?.manifest;

export class ToolService {
  /** The public catalog: every callable tool API with its parameter schema. */
  listTools(): PublicTool[] {
    return Object.entries(PUBLIC_TOOL_APIS).flatMap(([identifier, apiNames]) => {
      const manifest = manifestOf(identifier);
      if (!manifest) return [];

      return [
        {
          apis: manifest.api
            .filter((api) => apiNames.includes(api.name))
            .map((api) => ({
              description: api.description,
              name: api.name,
              parameters: api.parameters,
            })),
          description: manifest.meta?.description,
          identifier,
          title: manifest.meta?.title,
        },
      ];
    });
  }

  /** Whether `identifier/api` is exposed. Unlisted APIs must look like they do not exist. */
  isPublic(identifier: string, api: string): boolean {
    return PUBLIC_TOOL_APIS[identifier]?.includes(api) ?? false;
  }

  async invoke(params: InvokeToolParams): Promise<BuiltinServerRuntimeOutput> {
    const { api, args, identifier, serverDB, signal, userId } = params;

    if (!this.isPublic(identifier, api))
      throw namedError('NotFoundError', `Tool API ${identifier}/${api} not found`);

    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw namedError('ValidationError', 'Request body must be a JSON object of tool arguments');

    const schema = manifestOf(identifier)?.api.find((item) => item.name === api)?.parameters;
    const missing = ((schema?.required as string[] | undefined) ?? []).filter(
      (key) => (args as Record<string, unknown>)[key] === undefined,
    );
    if (missing.length > 0)
      throw namedError('ValidationError', `Missing required argument(s): ${missing.join(', ')}`);

    // No agent, topic or enabled-tool context: a gateway call is not part of a
    // conversation, so runtimes fall back to their stateless behaviour (web
    // browsing, for one, saves nothing without an agent).
    const runtime = await getServerRuntime(identifier, { serverDB, toolManifestMap: {}, userId });

    // The second argument doubles as the runtime's call options, which is where
    // `search` reads its abort signal from.
    return runtime[api](args, { serverDB, signal, toolManifestMap: {}, userId });
  }
}
