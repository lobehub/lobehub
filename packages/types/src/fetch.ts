/* eslint-disable sort-keys-fix/sort-keys-fix */
import type { ILobeAgentRuntimeErrorType } from './agentRuntime';

export const ChatErrorType = {
  // ******* Business Error Semantics ******* //

  InvalidAccessCode: 'InvalidAccessCode', // is in valid password
  FreePlanLimit: 'FreePlanLimit', // Free plan usage limit
  SubscriptionPlanLimit: 'SubscriptionPlanLimit', // Subscription user limit exceeded
  SubscriptionKeyMismatch: 'SubscriptionKeyMismatch', // Subscription key mismatch

  SupervisorDecisionFailed: 'SupervisorDecisionFailed', // Supervisor decision failed

  InvalidUserKey: 'InvalidUserKey', // is not valid User key
  CreateMessageError: 'CreateMessageError',
  /**
   * @deprecated
   */
  NoOpenAIAPIKey: 'NoOpenAIAPIKey',
  OllamaServiceUnavailable: 'OllamaServiceUnavailable', // Ollama service not started/detected
  PluginFailToTransformArguments: 'PluginFailToTransformArguments',
  UnknownChatFetchError: 'UnknownChatFetchError',
  SystemTimeNotMatchError: 'SystemTimeNotMatchError',
  ServerAgentRuntimeError: 'ServerAgentRuntimeError',

  // ******* Client Errors ******* //
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  ContentNotFound: 404, // Endpoint not found
  MethodNotAllowed: 405, // Method not supported
  TooManyRequests: 429,

  // ******* Server Errors ******* //InvalidPluginArgumentsTransform
  InternalServerError: 500,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
} as const;

export type ErrorType = (typeof ChatErrorType)[keyof typeof ChatErrorType];

export interface ErrorResponse {
  body: any;
  errorType: ErrorType | ILobeAgentRuntimeErrorType;
}
