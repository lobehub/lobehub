import { MessageApiName } from '../../types';

// Placeholder inspectors — add custom inspector components per API as needed
export const MessageInspectors: Record<string, any> = {
  [MessageApiName.sendMessage]: undefined,
  [MessageApiName.readMessages]: undefined,
};
