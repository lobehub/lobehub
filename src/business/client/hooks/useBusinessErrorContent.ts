import { type ErrorType } from '@lobechat/types';

export interface BusinessErrorContentResult {
  errorType?: string;
  hideMessage?: boolean;
}

export default function useBusinessErrorContent(
  _errorType?: ErrorType | string,
): BusinessErrorContentResult {
  return {};
}
