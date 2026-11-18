import { type McpConnectVia } from '@lobechat/types';
import { useState } from 'react';

export interface AdvancedSectionFields {
  clientId?: string;
  clientSecret?: string;
  connectVia?: McpConnectVia;
  headers?: Record<string, string>;
  /** OAuth is the chosen auth type (and offered by this form). */
  isOAuth?: boolean;
}

/**
 * Whether 高级设置 holds a value that saving keeps. The OAuth client counts only
 * while OAuth is chosen: saving drops it for any other auth type.
 */
export const hasAdvancedValue = ({
  clientId,
  clientSecret,
  connectVia,
  headers,
  isOAuth,
}: AdvancedSectionFields): boolean =>
  connectVia === 'device' ||
  (Boolean(isOAuth) && Boolean(clientId || clientSecret)) ||
  Object.keys(headers ?? {}).length > 0;

/**
 * Expanded state of 高级设置. It starts collapsed but opens whenever the section
 * comes to hold a saved value (an edited connector, a JSON import), so a device
 * route, an OAuth client or headers never take effect unseen. The user can still
 * collapse it afterwards.
 */
export const useAdvancedSectionExpanded = (holdsValue: boolean) => {
  const [expanded, setExpanded] = useState(holdsValue);
  const [seenValue, setSeenValue] = useState(holdsValue);

  if (holdsValue !== seenValue) {
    setSeenValue(holdsValue);
    if (holdsValue) setExpanded(true);
  }

  return [expanded, setExpanded] as const;
};
