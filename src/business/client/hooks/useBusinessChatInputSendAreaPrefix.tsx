import type { ReactNode } from 'react';

export const useBusinessChatInputCostEstimateAlert = (): ReactNode => null;

export const getBusinessChatInputSendAreaPrefix = (sendAreaPrefix?: ReactNode): ReactNode =>
  sendAreaPrefix;

export const useBusinessChatInputSendAreaPrefix = getBusinessChatInputSendAreaPrefix;
