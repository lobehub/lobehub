import type { HumanInterventionConfig } from '../../tool';

export interface UserToolConfig {
  dalle: {
    autoGenerate: boolean;
  };
  /**
   * Human intervention configuration
   */
  humanIntervention?: {
    /**
     * List of confirmed tool calls (for 'once' policy)
     * Format: "identifier/apiName" or "identifier/apiName#argsHash"
     *
     * Examples:
     * - "web-browsing/crawlSinglePage"
     * - "bash/bash#a1b2c3d4"
     */
    confirmed?: string[];

    /**
     * Whether human intervention is enabled globally
     * @default true
     */
    enabled: boolean;

    /**
     * Per-tool intervention policy overrides
     * Key format: "identifier/apiName"
     *
     * Example:
     * {
     *   "web-browsing/crawlSinglePage": "confirm",
     *   "bash/bash": [
     *     { match: { command: "git add:*" }, policy: "auto" },
     *     { policy: "confirm" }
     *   ]
     * }
     */
    overrides?: Record<string, HumanInterventionConfig>;
  };
}
