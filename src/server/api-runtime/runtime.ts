export type APIRouteId =
  | 'api-agent-stream'
  | 'api-auth-all'
  | 'api-auth-check-user'
  | 'api-auth-resolve-username'
  | 'api-dev-agent-tracing'
  | 'api-dev-memory-user-memory-benchmark-locomo'
  | 'api-v1'
  | 'api-version'
  | 'api-webhooks-casdoor'
  | 'api-webhooks-logto'
  | 'api-webhooks-memory-extract-chat-topic-cancel'
  | 'api-webhooks-memory-extraction-benchmark-locomo'
  | 'api-webhooks-memory-extraction'
  | 'api-webhooks-memory-user-persona-update-writing'
  | 'api-webhooks-video'
  | 'api-workflows-agent-eval-run-execute-test-case'
  | 'api-workflows-agent-eval-run-finalize-run'
  | 'api-workflows-agent-eval-run-on-thread-complete'
  | 'api-workflows-agent-eval-run-on-trajectory-complete'
  | 'api-workflows-agent-eval-run-paginate-test-cases'
  | 'api-workflows-agent-eval-run-resume-agent-trajectory'
  | 'api-workflows-agent-eval-run-resume-thread-trajectory'
  | 'api-workflows-agent-eval-run-run-agent-trajectory'
  | 'api-workflows-agent-eval-run-run-benchmark'
  | 'api-workflows-agent-eval-run-run-thread-trajectory'
  | 'file-proxy'
  | 'market-agent'
  | 'market-oidc'
  | 'market-social'
  | 'market-user-me'
  | 'market-user-profile'
  | 'oidc-callback-desktop'
  | 'oidc-clear-session'
  | 'oidc-consent'
  | 'oidc-handoff'
  | 'oidc-provider'
  | 'webapi-chat'
  | 'webapi-create-image-comfyui'
  | 'webapi-models'
  | 'webapi-models-pull'
  | 'webapi-stt-openai'
  | 'webapi-trace'
  | 'webapi-tts-edge'
  | 'webapi-tts-microsoft'
  | 'webapi-tts-openai'
  | 'webapi-user-avatar';
export type APIRuntime = 'hono' | 'next';

type APIRuntimeMode = APIRuntime | 'gray';

interface RuntimeSelection {
  percent: number;
  reason: string;
  runtime: APIRuntime;
}

const DEFAULT_GRAY_PERCENT = 0;
const MAX_PERCENT = 100;
const MIN_PERCENT = 0;

export const API_RUNTIME_HEADER = 'x-lobe-api-runtime';
export const API_RUNTIME_REASON_HEADER = 'x-lobe-api-runtime-reason';

const ROUTE_RUNTIME_ENV = {
  'api-agent-stream': 'LOBE_API_AGENT_STREAM_RUNTIME',
  'api-auth-all': 'LOBE_API_AUTH_RUNTIME',
  'api-auth-check-user': 'LOBE_API_AUTH_CHECK_USER_RUNTIME',
  'api-auth-resolve-username': 'LOBE_API_AUTH_RESOLVE_USERNAME_RUNTIME',
  'api-dev-agent-tracing': 'LOBE_API_DEV_AGENT_TRACING_RUNTIME',
  'api-dev-memory-user-memory-benchmark-locomo':
    'LOBE_API_DEV_MEMORY_USER_MEMORY_BENCHMARK_LOCOMO_RUNTIME',
  'api-v1': 'LOBE_API_V1_RUNTIME',
  'api-version': 'LOBE_API_VERSION_RUNTIME',
  'api-webhooks-casdoor': 'LOBE_API_WEBHOOKS_CASDOOR_RUNTIME',
  'api-webhooks-logto': 'LOBE_API_WEBHOOKS_LOGTO_RUNTIME',
  'api-webhooks-memory-extract-chat-topic-cancel':
    'LOBE_API_WEBHOOKS_MEMORY_EXTRACT_CHAT_TOPIC_CANCEL_RUNTIME',
  'api-webhooks-memory-extraction-benchmark-locomo':
    'LOBE_API_WEBHOOKS_MEMORY_EXTRACTION_BENCHMARK_LOCOMO_RUNTIME',
  'api-webhooks-memory-extraction': 'LOBE_API_WEBHOOKS_MEMORY_EXTRACTION_RUNTIME',
  'api-webhooks-memory-user-persona-update-writing':
    'LOBE_API_WEBHOOKS_MEMORY_USER_PERSONA_UPDATE_WRITING_RUNTIME',
  'api-webhooks-video': 'LOBE_API_WEBHOOKS_VIDEO_RUNTIME',
  'api-workflows-agent-eval-run-execute-test-case':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_EXECUTE_TEST_CASE_RUNTIME',
  'api-workflows-agent-eval-run-finalize-run':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_FINALIZE_RUN_RUNTIME',
  'api-workflows-agent-eval-run-on-thread-complete':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_ON_THREAD_COMPLETE_RUNTIME',
  'api-workflows-agent-eval-run-on-trajectory-complete':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_ON_TRAJECTORY_COMPLETE_RUNTIME',
  'api-workflows-agent-eval-run-paginate-test-cases':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_PAGINATE_TEST_CASES_RUNTIME',
  'api-workflows-agent-eval-run-resume-agent-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RESUME_AGENT_TRAJECTORY_RUNTIME',
  'api-workflows-agent-eval-run-resume-thread-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RESUME_THREAD_TRAJECTORY_RUNTIME',
  'api-workflows-agent-eval-run-run-agent-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RUN_AGENT_TRAJECTORY_RUNTIME',
  'api-workflows-agent-eval-run-run-benchmark':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RUN_BENCHMARK_RUNTIME',
  'api-workflows-agent-eval-run-run-thread-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RUN_THREAD_TRAJECTORY_RUNTIME',
  'file-proxy': 'LOBE_FILE_PROXY_RUNTIME',
  'market-agent': 'LOBE_MARKET_AGENT_RUNTIME',
  'market-oidc': 'LOBE_MARKET_OIDC_RUNTIME',
  'market-social': 'LOBE_MARKET_SOCIAL_RUNTIME',
  'market-user-me': 'LOBE_MARKET_USER_ME_RUNTIME',
  'market-user-profile': 'LOBE_MARKET_USER_PROFILE_RUNTIME',
  'oidc-callback-desktop': 'LOBE_OIDC_CALLBACK_DESKTOP_RUNTIME',
  'oidc-clear-session': 'LOBE_OIDC_CLEAR_SESSION_RUNTIME',
  'oidc-consent': 'LOBE_OIDC_CONSENT_RUNTIME',
  'oidc-handoff': 'LOBE_OIDC_HANDOFF_RUNTIME',
  'oidc-provider': 'LOBE_OIDC_PROVIDER_RUNTIME',
  'webapi-chat': 'LOBE_WEBAPI_CHAT_RUNTIME',
  'webapi-create-image-comfyui': 'LOBE_WEBAPI_CREATE_IMAGE_COMFYUI_RUNTIME',
  'webapi-models': 'LOBE_WEBAPI_MODELS_RUNTIME',
  'webapi-models-pull': 'LOBE_WEBAPI_MODELS_PULL_RUNTIME',
  'webapi-stt-openai': 'LOBE_WEBAPI_STT_OPENAI_RUNTIME',
  'webapi-trace': 'LOBE_WEBAPI_TRACE_RUNTIME',
  'webapi-tts-edge': 'LOBE_WEBAPI_TTS_EDGE_RUNTIME',
  'webapi-tts-microsoft': 'LOBE_WEBAPI_TTS_MICROSOFT_RUNTIME',
  'webapi-tts-openai': 'LOBE_WEBAPI_TTS_OPENAI_RUNTIME',
  'webapi-user-avatar': 'LOBE_WEBAPI_USER_AVATAR_RUNTIME',
} as const satisfies Record<APIRouteId, string>;

const ROUTE_PERCENT_ENV = {
  'api-agent-stream': 'LOBE_API_AGENT_STREAM_HONO_PERCENT',
  'api-auth-all': 'LOBE_API_AUTH_HONO_PERCENT',
  'api-auth-check-user': 'LOBE_API_AUTH_CHECK_USER_HONO_PERCENT',
  'api-auth-resolve-username': 'LOBE_API_AUTH_RESOLVE_USERNAME_HONO_PERCENT',
  'api-dev-agent-tracing': 'LOBE_API_DEV_AGENT_TRACING_HONO_PERCENT',
  'api-dev-memory-user-memory-benchmark-locomo':
    'LOBE_API_DEV_MEMORY_USER_MEMORY_BENCHMARK_LOCOMO_HONO_PERCENT',
  'api-v1': 'LOBE_API_V1_HONO_PERCENT',
  'api-version': 'LOBE_API_VERSION_HONO_PERCENT',
  'api-webhooks-casdoor': 'LOBE_API_WEBHOOKS_CASDOOR_HONO_PERCENT',
  'api-webhooks-logto': 'LOBE_API_WEBHOOKS_LOGTO_HONO_PERCENT',
  'api-webhooks-memory-extract-chat-topic-cancel':
    'LOBE_API_WEBHOOKS_MEMORY_EXTRACT_CHAT_TOPIC_CANCEL_HONO_PERCENT',
  'api-webhooks-memory-extraction-benchmark-locomo':
    'LOBE_API_WEBHOOKS_MEMORY_EXTRACTION_BENCHMARK_LOCOMO_HONO_PERCENT',
  'api-webhooks-memory-extraction': 'LOBE_API_WEBHOOKS_MEMORY_EXTRACTION_HONO_PERCENT',
  'api-webhooks-memory-user-persona-update-writing':
    'LOBE_API_WEBHOOKS_MEMORY_USER_PERSONA_UPDATE_WRITING_HONO_PERCENT',
  'api-webhooks-video': 'LOBE_API_WEBHOOKS_VIDEO_HONO_PERCENT',
  'api-workflows-agent-eval-run-execute-test-case':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_EXECUTE_TEST_CASE_HONO_PERCENT',
  'api-workflows-agent-eval-run-finalize-run':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_FINALIZE_RUN_HONO_PERCENT',
  'api-workflows-agent-eval-run-on-thread-complete':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_ON_THREAD_COMPLETE_HONO_PERCENT',
  'api-workflows-agent-eval-run-on-trajectory-complete':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_ON_TRAJECTORY_COMPLETE_HONO_PERCENT',
  'api-workflows-agent-eval-run-paginate-test-cases':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_PAGINATE_TEST_CASES_HONO_PERCENT',
  'api-workflows-agent-eval-run-resume-agent-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RESUME_AGENT_TRAJECTORY_HONO_PERCENT',
  'api-workflows-agent-eval-run-resume-thread-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RESUME_THREAD_TRAJECTORY_HONO_PERCENT',
  'api-workflows-agent-eval-run-run-agent-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RUN_AGENT_TRAJECTORY_HONO_PERCENT',
  'api-workflows-agent-eval-run-run-benchmark':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RUN_BENCHMARK_HONO_PERCENT',
  'api-workflows-agent-eval-run-run-thread-trajectory':
    'LOBE_API_WORKFLOWS_AGENT_EVAL_RUN_RUN_THREAD_TRAJECTORY_HONO_PERCENT',
  'file-proxy': 'LOBE_FILE_PROXY_HONO_PERCENT',
  'market-agent': 'LOBE_MARKET_AGENT_HONO_PERCENT',
  'market-oidc': 'LOBE_MARKET_OIDC_HONO_PERCENT',
  'market-social': 'LOBE_MARKET_SOCIAL_HONO_PERCENT',
  'market-user-me': 'LOBE_MARKET_USER_ME_HONO_PERCENT',
  'market-user-profile': 'LOBE_MARKET_USER_PROFILE_HONO_PERCENT',
  'oidc-callback-desktop': 'LOBE_OIDC_CALLBACK_DESKTOP_HONO_PERCENT',
  'oidc-clear-session': 'LOBE_OIDC_CLEAR_SESSION_HONO_PERCENT',
  'oidc-consent': 'LOBE_OIDC_CONSENT_HONO_PERCENT',
  'oidc-handoff': 'LOBE_OIDC_HANDOFF_HONO_PERCENT',
  'oidc-provider': 'LOBE_OIDC_PROVIDER_HONO_PERCENT',
  'webapi-chat': 'LOBE_WEBAPI_CHAT_HONO_PERCENT',
  'webapi-create-image-comfyui': 'LOBE_WEBAPI_CREATE_IMAGE_COMFYUI_HONO_PERCENT',
  'webapi-models': 'LOBE_WEBAPI_MODELS_HONO_PERCENT',
  'webapi-models-pull': 'LOBE_WEBAPI_MODELS_PULL_HONO_PERCENT',
  'webapi-stt-openai': 'LOBE_WEBAPI_STT_OPENAI_HONO_PERCENT',
  'webapi-trace': 'LOBE_WEBAPI_TRACE_HONO_PERCENT',
  'webapi-tts-edge': 'LOBE_WEBAPI_TTS_EDGE_HONO_PERCENT',
  'webapi-tts-microsoft': 'LOBE_WEBAPI_TTS_MICROSOFT_HONO_PERCENT',
  'webapi-tts-openai': 'LOBE_WEBAPI_TTS_OPENAI_HONO_PERCENT',
  'webapi-user-avatar': 'LOBE_WEBAPI_USER_AVATAR_HONO_PERCENT',
} as const satisfies Record<APIRouteId, string>;

const normalizeRuntime = (value: string | null | undefined): APIRuntimeMode | undefined => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'hono' || normalized === 'next' || normalized === 'gray') return normalized;

  return undefined;
};

const readRuntimeMode = (route: APIRouteId): APIRuntimeMode | undefined =>
  normalizeRuntime(process.env[ROUTE_RUNTIME_ENV[route]]) ??
  normalizeRuntime(process.env.LOBE_API_RUNTIME);

const readGrayPercent = (route: APIRouteId): number => {
  const rawValue = process.env[ROUTE_PERCENT_ENV[route]] ?? process.env.LOBE_API_HONO_PERCENT;
  if (!rawValue) return DEFAULT_GRAY_PERCENT;

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) return DEFAULT_GRAY_PERCENT;

  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, parsedValue));
};

const hashToBucket = (value: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % MAX_PERCENT;
};

const createStableGrayKey = (request: Request, route: APIRouteId): string => {
  const url = new URL(request.url);

  return [
    route,
    url.pathname,
    request.headers.get('cookie') ?? '',
    request.headers.get('authorization') ?? '',
    request.headers.get('x-api-key') ?? '',
    request.headers.get('x-forwarded-for') ?? '',
    request.headers.get('user-agent') ?? '',
  ].join('|');
};

export const selectAPIRuntime = (request: Request, route: APIRouteId): RuntimeSelection => {
  const requestedRuntime = normalizeRuntime(request.headers.get(API_RUNTIME_HEADER));
  if (requestedRuntime === 'hono' || requestedRuntime === 'next') {
    return {
      percent: requestedRuntime === 'hono' ? MAX_PERCENT : MIN_PERCENT,
      reason: 'request-header',
      runtime: requestedRuntime,
    };
  }

  const configuredMode = readRuntimeMode(route);
  if (configuredMode === 'hono' || configuredMode === 'next') {
    return {
      percent: configuredMode === 'hono' ? MAX_PERCENT : MIN_PERCENT,
      reason: `${ROUTE_RUNTIME_ENV[route]}/LOBE_API_RUNTIME`,
      runtime: configuredMode,
    };
  }

  const percent = readGrayPercent(route);
  if (configuredMode !== 'gray' && percent <= MIN_PERCENT) {
    return { percent, reason: 'default', runtime: 'next' };
  }

  const bucket = hashToBucket(createStableGrayKey(request, route));

  return {
    percent,
    reason: configuredMode === 'gray' ? 'gray-runtime-env' : 'gray-percent-env',
    runtime: bucket < percent ? 'hono' : 'next',
  };
};

export const withAPIRuntimeHeaders = (
  response: Response,
  selection: RuntimeSelection,
): Response => {
  const headers = new Headers(response.headers);

  headers.set(API_RUNTIME_HEADER, selection.runtime);
  headers.set(API_RUNTIME_REASON_HEADER, selection.reason);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
