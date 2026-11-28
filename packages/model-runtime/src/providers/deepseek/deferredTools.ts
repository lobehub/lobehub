import type { ResolveInlineToolChanges } from '../../core/protocols/anthropicMessages/inlineToolChanges';

const OFFICIAL_DEEPSEEK_HOST = 'api.deepseek.com';

/** Constructor option that opts one Anthropic-compatible DeepSeek channel in or out. */
export interface DeepSeekDeferredToolLoadingOptions {
  /**
   * Deferred tool loading for this endpoint only, in the `override` values of
   * {@link resolveDeepSeekInlineToolChanges}. Takes precedence over the env.
   */
  deferredToolLoading?: boolean | string;
}

/**
 * Only `deepseek-flash` loads deferred tools. `deepseek-v4-pro` ignores `defer_loading`
 * and reads a `tool_reference` as plain text, so it keeps the ordinary payload.
 *
 * @see https://api-docs.deepseek.com/guides/tool_calls#deferred-tool-loading
 */
export const supportsDeepSeekDeferredToolLoading = (model: string): boolean =>
  model.trim().toLowerCase().split('/').at(-1) === 'deepseek-flash';

const isOfficialDeepSeekEndpoint = (baseURL: string) => {
  try {
    return new URL(baseURL).hostname === OFFICIAL_DEEPSEEK_HOST;
  } catch {
    return false;
  }
};

/**
 * Deferred tool loading on DeepSeek's Anthropic-compatible API: the activated schemas
 * stay in the top-level list with `defer_loading: true` and are loaded by `tool_reference`
 * at the activation result, so the cached prefix survives a mid-run activation.
 *
 * A relay may validate or translate the request, so only the official endpoint loads
 * deferred tools by default. `override` (the channel's `deferredToolLoading` option, else
 * the `DEEPSEEK_DEFERRED_TOOL_LOADING` env) is the operator's answer for everything else:
 * `0` turns it off, `1` forces it on.
 */
export const resolveDeepSeekInlineToolChanges: ResolveInlineToolChanges = ({
  baseURL,
  model,
  options,
}) => {
  if (!supportsDeepSeekDeferredToolLoading(model)) return;

  const override =
    (options as DeepSeekDeferredToolLoadingOptions).deferredToolLoading ??
    process.env.DEEPSEEK_DEFERRED_TOOL_LOADING;

  switch (
    String(override ?? '')
      .trim()
      .toLowerCase()
  ) {
    case '0':
    case 'false':
    case 'off': {
      return undefined;
    }
    case '1':
    case 'true':
    case 'on': {
      return 'tool_reference';
    }
    default: {
      return isOfficialDeepSeekEndpoint(baseURL) ? 'tool_reference' : undefined;
    }
  }
};
