import  {
  type ArgumentMatcher,
  type HumanInterventionPolicy,
  type HumanInterventionRule,
  type SecurityBlacklistRule,
  type ShouldInterveneParams,
} from '@lobechat/types';

import { DEFAULT_SECURITY_BLACKLIST } from '../audit/defaultSecurityBlacklist';

/**
 * Result of security blacklist check
 */
export interface SecurityCheckResult {
  /**
   * Whether the operation is blocked by security rules
   */
  blocked: boolean;

  /**
   * Reason for blocking (if blocked)
   */
  reason?: string;
}

/**
 * Intervention Checker
 * Determines whether a tool call requires human intervention
 */
export class InterventionChecker {
  /**
   * Check if tool call is blocked by security blacklist
   * This check runs BEFORE all other intervention checks
   *
   * @param securityBlacklist - Security blacklist rules
   * @param toolArgs - Tool call arguments
   * @returns Security check result
   */
  static checkSecurityBlacklist(
    securityBlacklist: SecurityBlacklistRule[] = [],
    toolArgs: Record<string, any> = {},
  ): SecurityCheckResult {
    for (const rule of securityBlacklist) {
      if (this.matchesSecurityRule(rule, toolArgs)) {
        return {
          blocked: true,
          reason: rule.description,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Check if a tool call requires intervention
   *
   * @param params - Parameters object containing config, toolArgs, confirmedHistory, and toolKey
   * @returns Policy to apply
   */
  static shouldIntervene(params: ShouldInterveneParams): HumanInterventionPolicy {
    const { config, toolArgs = {} } = params;

    // Use default blacklist if not provided
    const securityBlacklist =
      params.securityBlacklist !== undefined
        ? params.securityBlacklist
        : DEFAULT_SECURITY_BLACKLIST;

    // CRITICAL: Check security blacklist first - this overrides ALL other settings
    const securityCheck = this.checkSecurityBlacklist(securityBlacklist, toolArgs);
    if (securityCheck.blocked) {
      // Security blacklist always requires intervention, even in auto-run mode
      return 'required';
    }

    // No config means never intervene (auto-execute)
    if (!config) return 'never';

    // Simple policy string
    if (typeof config === 'string') {
      return config;
    }

    // Array of rules - find first matching rule
    for (const rule of config) {
      if (this.matchesRule(rule, toolArgs)) {
        return rule.policy;
      }
    }

    // No rule matched - default to require for safety
    return 'required';
  }

  /**
   * Check if tool arguments match a security blacklist rule
   *
   * @param rule - Security rule to check
   * @param toolArgs - Tool call arguments
   * @returns true if matches (should be blocked)
   */
  private static matchesSecurityRule(
    rule: SecurityBlacklistRule,
    toolArgs: Record<string, any>,
  ): boolean {
    // Security rules must have match criteria
    if (!rule.match) return false;

    // All matchers must match (AND logic)
    for (const [paramName, matcher] of Object.entries(rule.match)) {
      const paramValue = toolArgs[paramName];

      // Parameter not present in args - rule doesn't match
      if (paramValue === undefined) return false;

      // Check if value matches
      if (!this.matchesArgument(matcher, paramValue)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if tool arguments match a rule
   *
   * @param rule - Rule to check
   * @param toolArgs - Tool call arguments
   * @returns true if matches
   */
  private static matchesRule(rule: HumanInterventionRule, toolArgs: Record<string, any>): boolean {
    // No match criteria means it's a default rule
    if (!rule.match) return true;

    // Check each parameter matcher
    for (const [paramName, matcher] of Object.entries(rule.match)) {
      const paramValue = toolArgs[paramName];

      // Parameter not present in args
      if (paramValue === undefined) return false;

      // Check if value matches
      if (!this.matchesArgument(matcher, paramValue)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a parameter value matches the matcher
   *
   * @param matcher - Argument matcher
   * @param value - Parameter value
   * @returns true if matches
   */
  private static matchesArgument(matcher: ArgumentMatcher, value: any): boolean {
    const strValue = String(value);

    // Simple string matcher
    if (typeof matcher === 'string') {
      return this.matchPattern(matcher, strValue);
    }

    // Complex matcher with type
    const { pattern, type } = matcher;

    switch (type) {
      case 'exact': {
        return strValue === pattern;
      }
      case 'prefix': {
        return strValue.startsWith(pattern);
      }
      case 'wildcard': {
        return this.matchPattern(pattern, strValue);
      }
      case 'regex': {
        return new RegExp(pattern).test(strValue);
      }
      default: {
        return false;
      }
    }
  }

  /**
   * Match wildcard pattern (supports * wildcard)
   *
   * @param pattern - Pattern with wildcards
   * @param value - Value to match
   * @returns true if matches
   */
  private static matchPattern(pattern: string, value: string): boolean {
    // Check for colon-based prefix matching (e.g., "git add:*")
    if (pattern.includes(':')) {
      const [prefix, suffix] = pattern.split(':');
      if (suffix === '*') {
        return value.startsWith(prefix + ':') || value === prefix;
      }
    }

    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replaceAll(/[$()+.?[\\\]^{|}]/g, '\\$&') // Escape special chars
      .replaceAll('*', '.*'); // Replace * with .*

    return new RegExp(`^${regexPattern}$`).test(value);
  }

  /**
   * Generate tool key from identifier and API name
   *
   * @param identifier - Tool identifier
   * @param apiName - API name
   * @param argsHash - Optional hash of arguments
   * @returns Tool key in format "identifier/apiName" or "identifier/apiName#hash"
   */
  static generateToolKey(identifier: string, apiName: string, argsHash?: string): string {
    const baseKey = `${identifier}/${apiName}`;
    return argsHash ? `${baseKey}#${argsHash}` : baseKey;
  }

  /**
   * Generate simple hash of arguments for tool tracking
   *
   * @param args - Tool call arguments
   * @returns Hash string
   */
  static hashArguments(args: Record<string, any>): string {
    const sortedKeys = Object.keys(args).sort();
    const str = sortedKeys.map((key) => `${key}=${JSON.stringify(args[key])}`).join('&');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }
}
