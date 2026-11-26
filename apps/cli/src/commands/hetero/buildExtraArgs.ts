import { toCodexServiceTier } from '@lobechat/types';

export interface HeteroCliArgumentOptions {
  agentArg?: string[];
  effort?: string;
  /** Amp agent mode, forwarded as the native `--mode` flag. */
  mode?: string;
  model?: string;
  /**
   * Speed mode selection (Codex only). Translated into the native
   * `service_tier` config; `fast` requests the Fast (priority) tier.
   */
  speed?: string;
  type: string;
}

const CODEX_REASONING_EFFORT_CONFIG_KEY = 'model_reasoning_effort';
const CODEX_SERVICE_TIER_CONFIG_KEY = 'service_tier';

export const buildExtraArgs = (options: HeteroCliArgumentOptions): string[] | undefined => {
  const modelArg = options.model ? ['--model', options.model] : [];
  const selectorArgs =
    options.type === 'amp'
      ? options.mode
        ? ['--mode', options.mode]
        : []
      : options.type === 'droid' || options.type === 'trae'
        ? []
        : options.type === 'codex'
          ? [
              ...modelArg,
              ...(options.effort
                ? ['-c', `${CODEX_REASONING_EFFORT_CONFIG_KEY}="${options.effort}"`]
                : []),
              ...(options.speed
                ? ['-c', `${CODEX_SERVICE_TIER_CONFIG_KEY}="${toCodexServiceTier(options.speed)}"`]
                : []),
            ]
          : options.type === 'antigravity' ||
              options.type === 'claude-code' ||
              options.type === 'codebuddy' ||
              options.type === 'grok-build'
            ? [...modelArg, ...(options.effort ? ['--effort', options.effort] : [])]
            : options.type === 'cursor' ||
                options.type === 'devin' ||
                options.type === 'kimi-code' ||
                options.type === 'opencode' ||
                options.type === 'pi'
              ? modelArg
              : options.type === 'copilot' || options.type === 'qoder'
                ? [...modelArg, ...(options.effort ? ['--reasoning-effort', options.effort] : [])]
                : [];
  const extraArgs = [...(options.agentArg ?? []), ...selectorArgs];

  return extraArgs.length > 0 ? extraArgs : undefined;
};
