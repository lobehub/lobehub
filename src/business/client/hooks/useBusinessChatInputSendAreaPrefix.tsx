import type { ReactNode } from 'react';

// The cloud implementation calls hooks while the OSS fallback intentionally does not.
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
export const useBusinessChatInputCostEstimateAlert = (): ReactNode => null;

// The cloud implementation calls hooks while the OSS fallback intentionally does not.
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix
export const useBusinessChatInputAlerts = (): ReactNode => null;

export const getBusinessChatInputSendAreaPrefix = (sendAreaPrefix?: ReactNode): ReactNode =>
  sendAreaPrefix;

export const useBusinessChatInputSendAreaPrefix = getBusinessChatInputSendAreaPrefix;
