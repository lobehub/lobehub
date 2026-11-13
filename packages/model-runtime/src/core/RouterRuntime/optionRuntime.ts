import type { GoogleGenAIOptions } from '@google/genai';

import { LobeOpenAI } from '../../providers/openai';
import { LobeVertexAI } from '../../providers/vertexai';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { setRuntimeSignatureScopeSource } from '../../utils/signatureScope';
import { getDurationMs } from '../../utils/timing';
import type { LobeRuntimeAI } from '../BaseAI';
import type { RouterInstance, RouterOptionItem } from './routerOptions';
import type { RouterRuntimeDeps } from './routeSelection';

/**
 * Build a runtime instance for a specific option item.
 * Option items can override apiType to switch providers for fallback.
 */
export const createRuntimeFromOption = async (
  deps: RouterRuntimeDeps,
  router: RouterInstance,
  optionItem: RouterOptionItem,
) => {
  const startedAt = Date.now();
  const { apiType: optionApiType, id: channelId, remark, ...optionOverrides } = optionItem;
  delete optionOverrides.weight;
  const resolvedApiType = optionApiType ?? router.apiType;
  const finalOptions = {
    ...deps.params,
    ...deps.options,
    ...optionOverrides,
  };
  const signatureScopeSource = {
    apiType: resolvedApiType,
    channelId,
    provider: deps.id,
    routerId: router.id ?? deps.id,
  };

  /**
   * Vertex AI uses GoogleGenAI credentials flow rather than API keys.
   * Accept JSON credentials in apiKey for compatibility with server config.
   */
  if (resolvedApiType === 'vertexai') {
    const { apiKey, googleAuthOptions, project, location, ...restOptions } = finalOptions;
    const credentials = safeParseJSON<Record<string, any>>(apiKey);
    const vertexOptions: GoogleGenAIOptions & ModelIdMappingOptions = {
      ...(restOptions as GoogleGenAIOptions),
      vertexai: true,
    };

    if (googleAuthOptions) {
      vertexOptions.googleAuthOptions = googleAuthOptions;
    } else if (credentials) {
      vertexOptions.googleAuthOptions = { credentials };
    }

    if (project) vertexOptions.project = project;
    if (location) vertexOptions.location = location as GoogleGenAIOptions['location'];

    deps.trace(
      'createRuntimeFromOption done routerId=%s channelId=%s apiType=%s durationMs=%d vertex=true',
      router.id,
      channelId,
      resolvedApiType,
      getDurationMs(startedAt),
    );

    const runtime = LobeVertexAI.initFromVertexAI(vertexOptions);
    setRuntimeSignatureScopeSource(runtime, signatureScopeSource);

    return {
      channelId,
      id: resolvedApiType,
      remark,
      runtime,
    };
  }

  const { baseRuntimeMap } = await import('./baseRuntimeMap');
  const providerAI =
    resolvedApiType === router.apiType
      ? (router.runtime ?? baseRuntimeMap[resolvedApiType] ?? LobeOpenAI)
      : (baseRuntimeMap[resolvedApiType] ?? LobeOpenAI);
  const runtime: LobeRuntimeAI = new providerAI({ ...finalOptions, id: deps.id });
  setRuntimeSignatureScopeSource(runtime, signatureScopeSource);

  deps.trace(
    'createRuntimeFromOption done routerId=%s channelId=%s apiType=%s durationMs=%d',
    router.id,
    channelId,
    resolvedApiType,
    getDurationMs(startedAt),
  );

  return {
    channelId,
    id: resolvedApiType,
    remark,
    runtime,
  };
};
