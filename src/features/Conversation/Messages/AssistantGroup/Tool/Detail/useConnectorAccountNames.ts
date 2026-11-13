import isEqual from 'fast-deep-equal';

import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

/**
 * Arguments that pick the account of a multi-account connector. The tool gets
 * `connector_link_id` instead when it already declares a `link_id` of its own.
 */
export const CONNECTOR_ACCOUNT_PARAMS = ['link_id', 'connector_link_id'] as const;

const NO_NAMES: Record<string, string> = {};

/**
 * Account names for the account arguments of a tool call, keyed by argument.
 * An id that names no known account (another workspace, a removed account, a
 * value still streaming in) is left out, so callers show it as it was sent.
 */
export const useConnectorAccountNames = (args: unknown): Record<string, string> =>
  useToolStore((s) => {
    if (!args || typeof args !== 'object') return NO_NAMES;

    let names: Record<string, string> | undefined;
    for (const param of CONNECTOR_ACCOUNT_PARAMS) {
      const value = (args as Record<string, unknown>)[param];
      if (typeof value !== 'string') continue;
      const name = connectorSelectors.connectorLinkNameById(value)(s);
      if (name) (names ??= {})[param] = name;
    }
    return names ?? NO_NAMES;
  }, isEqual);
