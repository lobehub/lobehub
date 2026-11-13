import { isConnectorLinkParam } from '@lobechat/mecha';
import isEqual from 'fast-deep-equal';

import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

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
    // `link_id`, or `connector_link_id…` when a tool declares `link_id` itself.
    for (const [param, value] of Object.entries(args)) {
      if (typeof value !== 'string' || !isConnectorLinkParam(param)) continue;
      const name = connectorSelectors.connectorLinkNameById(value)(s);
      if (name) (names ??= {})[param] = name;
    }
    return names ?? NO_NAMES;
  }, isEqual);
