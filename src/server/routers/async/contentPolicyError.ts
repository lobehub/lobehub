const CONTENT_POLICY_ERROR_MESSAGE =
  'Content policy check failed. Revise your prompt and try again.';

const getErrorCode = (error: any) => error?.code || error?.error?.code;
const getErrorMessage = (error: any) => error?.message || error?.error?.message || '';

export const getContentPolicyErrorMessage = (error: any) => {
  const errorCode = getErrorCode(error);
  const errorMessage = getErrorMessage(error).toLowerCase();

  if (
    errorCode === 'InputTextSensitiveContentDetected' ||
    errorCode === 'content_policy_violation' ||
    errorCode === 'moderation_blocked' ||
    errorMessage.includes('content policy') ||
    errorMessage.includes('safety system') ||
    errorMessage.includes('sensitive information')
  ) {
    return CONTENT_POLICY_ERROR_MESSAGE;
  }
};
