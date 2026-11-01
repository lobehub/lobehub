import type { ConnectorOAuthError } from '@/utils/connectorOAuth';

export const getOAuthErrorPresentation = (
  error: string,
  messages: Record<ConnectorOAuthError['reason'], string>,
) => {
  const known = Object.hasOwn(messages, error);
  return {
    detail: known ? undefined : error,
    summary: known ? messages[error as ConnectorOAuthError['reason']] : messages.failed,
  };
};
