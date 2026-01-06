import type { ErrorType } from '@lobechat/types';
import type { AlertProps } from '@lobehub/ui';

/**
 * Business hook to extend error alert config for subscription-related errors.
 * Override this in cloud repo to customize alert appearance.
 */
export default function useBusinessErrorAlertConfig(
  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  errorType?: ErrorType,
): AlertProps | undefined {
  return undefined;
}
