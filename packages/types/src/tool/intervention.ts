import { z } from 'zod';

/**
 * Human Intervention Policy
 */
export type HumanInterventionPolicy =
  | 'never' // Never intervene, auto-execute
  | 'required' // Need intervention (can be bypassed by user's auto-run mode)
  | 'always'; // Always need intervention (cannot be bypassed by auto-run mode)

export const HumanInterventionPolicySchema = z.enum(['never', 'required', 'always']);

/**
 * Argument Matcher for parameter-level filtering
 * Supports wildcard patterns, prefix matching, and regex
 *
 * Examples:
 * - "git add:*" - matches any git add command
 * - "/Users/project/*" - matches paths under /Users/project/
 * - { pattern: "^rm.*", type: "regex" } - regex matching
 */
export type ArgumentMatcher =
  | string // Simple string or wildcard pattern
  | {
      pattern: string;
      type: 'exact' | 'prefix' | 'wildcard' | 'regex';
    };

export const ArgumentMatcherSchema: z.ZodType<ArgumentMatcher> = z.union([
  z.string(),
  z.object({
    pattern: z.string(),
    type: z.enum(['exact', 'prefix', 'wildcard', 'regex']),
  }),
]);

/**
 * Human Intervention Rule
 * Used for parameter-level control of intervention behavior
 */
export interface HumanInterventionRule {
  /**
   * Parameter filter - matches against tool call arguments
   * Key is the parameter name, value is the matcher
   *
   * Example:
   * { command: "git add:*" } - matches when command param starts with "git add"
   */
  match?: Record<string, ArgumentMatcher>;

  /**
   * Policy to apply when this rule matches
   */
  policy: HumanInterventionPolicy;
}

export const HumanInterventionRuleSchema: z.ZodType<HumanInterventionRule> = z.object({
  match: z.record(z.string(), ArgumentMatcherSchema).optional(),
  policy: HumanInterventionPolicySchema,
});

/**
 * Human Intervention Configuration
 * Can be either:
 * - Simple: Direct policy string for uniform behavior
 * - Complex: Array of rules for parameter-level control
 *
 * Examples:
 * - "always" - always require intervention
 * - [{ match: { command: "ls:*" }, policy: "never" }, { policy: "always" }]
 */
export type HumanInterventionConfig = HumanInterventionPolicy | HumanInterventionRule[];

export const HumanInterventionConfigSchema: z.ZodType<HumanInterventionConfig> = z.union([
  HumanInterventionPolicySchema,
  z.array(HumanInterventionRuleSchema),
]);

/**
 * Human Intervention Response
 * User's response to an intervention request
 */
export interface HumanInterventionResponse {
  /**
   * User's action:
   * - approve: Allow the tool call to proceed
   * - reject: Deny the tool call
   * - select: User made a selection from options
   */
  action: 'approve' | 'reject' | 'select';

  /**
   * Additional data based on action type
   */
  data?: {
    /**
     * Whether to remember this decision for future calls
     * Only applicable for 'first' policy
     */
    remember?: boolean;

    /**
     * Selected value(s) for select action
     * Can be single string or array for multi-select
     */
    selected?: string | string[];
  };
}

export const HumanInterventionResponseSchema = z.object({
  action: z.enum(['approve', 'reject', 'select']),
  data: z
    .object({
      remember: z.boolean().optional(),
      selected: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
});

/**
 * User's global intervention configuration
 * Applied across all tools in the session
 */
export interface UserInterventionConfig {
  /**
   * Allow list of approved tools (used in 'allow-list' mode)
   * Format: "identifier/apiName"
   *
   * Examples:
   * - "bash/bash"
   * - "web-browsing/crawlSinglePage"
   * - "search/search"
   */
  allowList?: string[];

  /**
   * Tool approval mode
   * - auto-run: Automatically approve all tools without user consent
   * - allow-list: Only approve tools in the allow list
   * - manual: Use tool's own humanIntervention config (default)
   * - headless: Fully automated mode for async tasks - all tools execute automatically,
   *             security blacklist tools are skipped (not blocked)
   */
  approvalMode: 'auto-run' | 'allow-list' | 'manual' | 'headless';
}

export const UserInterventionConfigSchema = z.object({
  allowList: z.array(z.string()).optional(),
  approvalMode: z.enum(['auto-run', 'allow-list', 'manual', 'headless']),
});

/**
 * Security Blacklist Rule
 * Used to forcefully block dangerous operations regardless of user settings
 */
export interface SecurityBlacklistRule {
  /**
   * Description of why this rule exists (for error messages)
   */
  description: string;

  /**
   * Parameter filter - matches against tool call arguments
   * Same format as HumanInterventionRule.match
   */
  match: Record<string, ArgumentMatcher>;
}

export const SecurityBlacklistRuleSchema = z.object({
  description: z.string(),
  match: z.record(z.string(), ArgumentMatcherSchema),
});

/**
 * Security Blacklist Configuration
 * A list of rules that will always block execution and require intervention
 */
export type SecurityBlacklistConfig = SecurityBlacklistRule[];

export const SecurityBlacklistConfigSchema = z.array(SecurityBlacklistRuleSchema);

/**
 * Parameters for shouldIntervene method
 */
export interface ShouldInterveneParams {
  /**
   * Intervention configuration (from manifest or user override)
   */
  config: HumanInterventionConfig | undefined;

  /**
   * List of confirmed tool calls (for 'first' policy)
   * @default []
   */
  confirmedHistory?: string[];

  /**
   * Security blacklist rules that will be checked first
   * These rules override all other settings including auto-run mode
   * @default []
   */
  securityBlacklist?: SecurityBlacklistConfig;

  /**
   * Tool call arguments to check against rules
   * @default {}
   */
  toolArgs?: Record<string, any>;

  /**
   * Tool key to check against confirmed history
   * Format: "identifier/apiName" or "identifier/apiName#argsHash"
   */
  toolKey?: string;
}

export const ShouldInterveneParamsSchema = z.object({
  config: HumanInterventionConfigSchema.optional(),
  confirmedHistory: z.array(z.string()).optional(),
  securityBlacklist: SecurityBlacklistConfigSchema.optional(),
  toolArgs: z.record(z.string(), z.any()).optional(),
  toolKey: z.string().optional(),
});
