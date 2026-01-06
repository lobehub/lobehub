import type { ErrorType } from '@lobechat/types';

export interface BusinessErrorContentResult {
  /**
   * Modified error type for i18n key lookup.
   * Return undefined to use the original error type.
   */
  errorType?: string;
  /**
   * Whether to hide the error message.
   * Useful when subscription status changes and error is no longer relevant.
   */
  hideMessage?: boolean;
}

/**
 * Business hook to customize error content based on subscription status.
 * Override this in cloud repo to implement subscription-aware error messages.
 */
export default function useBusinessErrorContent(
  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  errorType?: ErrorType | string,
): BusinessErrorContentResult {
  return {};
}
