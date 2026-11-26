import { BRANDING_PROVIDER, isOfficialProvider } from '@lobechat/business-const';

interface UsageCostSource {
  /** Provider shown for the message, resolved from its model card. */
  provider: string;
  /**
   * The message ran on a server-default heterogeneous agent (Claude Code / Codex served by the
   * branding provider). Its `provider` is the CLI type or whichever model card matched the
   * model id, so it does not name the provider that served the run.
   */
  serverDefault?: boolean;
}

/**
 * Whether a message's usage may be shown as money (the cost view, per-token pricing, the `$`
 * footer). Usage served by the official provider is shown in tokens only.
 */
export const canShowUsageCost = ({ provider, serverDefault }: UsageCostSource) =>
  !isOfficialProvider(serverDefault ? BRANDING_PROVIDER : provider);
