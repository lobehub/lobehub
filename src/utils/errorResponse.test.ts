import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createErrorResponse } from './errorResponse';

describe('createErrorResponse', () => {
  // Test status codes for various error types
  it('returns a 401 status for NoOpenAIAPIKey error type', () => {
    const errorType = ChatErrorType.NoOpenAIAPIKey;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(401);
  });

  it('returns a 401 status for InvalidAccessCode error type', () => {
    const errorType = ChatErrorType.InvalidAccessCode;
    const response = createErrorResponse(errorType as any);
    expect(response.status).toBe(401);
  });

  // Test error types containing 'Invalid'
  it('returns a 401 status for Invalid error type', () => {
    const errorType = 'InvalidTestError';
    const response = createErrorResponse(errorType as any);
    expect(response.status).toBe(401);
  });

  it('returns a 403 status for LocationNotSupportError error type', () => {
    const errorType = AgentRuntimeErrorType.LocationNotSupportError;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(403);
  });

  it('returns a 404 status for ModelNotFound error type', () => {
    const errorType = AgentRuntimeErrorType.ModelNotFound;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(404);
  });

  it('returns a 429 status for InsufficientQuota error type', () => {
    const errorType = AgentRuntimeErrorType.InsufficientQuota;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(429);
  });

  it('returns a 429 status for QuotaLimitReached error type', () => {
    const errorType = AgentRuntimeErrorType.QuotaLimitReached;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(429);
  });

  it('returns a 400 status for ExceededContextWindow error type', () => {
    const errorType = AgentRuntimeErrorType.ExceededContextWindow;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(400);
  });

  it('returns a 400 status for SystemTimeNotMatchError error type', () => {
    const errorType = ChatErrorType.SystemTimeNotMatchError;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(400);
  });

  it('returns a 400 status for SubscriptionKeyMismatch error type', () => {
    const errorType = ChatErrorType.SubscriptionKeyMismatch;
    const response = createErrorResponse(errorType);
    expect(response.status).toBe(400);
  });

  describe('Provider Biz Error', () => {
    it('returns a 471 status for ProviderBizError error type', () => {
      const errorType = AgentRuntimeErrorType.ProviderBizError;
      const response = createErrorResponse(errorType);
      expect(response.status).toBe(471);
    });

    it('returns a 471 status for ProviderContentPolicyViolation error type', () => {
      const errorType = AgentRuntimeErrorType.ProviderContentPolicyViolation;
      const response = createErrorResponse(errorType);
      expect(response.status).toBe(471);
    });

    it('returns a 470 status for AgentRuntimeError error type', () => {
      const errorType = AgentRuntimeErrorType.AgentRuntimeError;
      const response = createErrorResponse(errorType);
      expect(response.status).toBe(470);
    });

    it('returns a 472 status for OllamaBizError error type', () => {
      const errorType = AgentRuntimeErrorType.OllamaBizError;
      const response = createErrorResponse(errorType);
      expect(response.status).toBe(472);
    });

    it('returns a 472 status for OllamaServiceUnavailable error type', () => {
      const errorType = ChatErrorType.OllamaServiceUnavailable;
      const response = createErrorResponse(errorType);
      expect(response.status).toBe(472);
    });
  });

  // Test when status code is not a number or not in the range of 200-599
  it('logs an error when the status code is not a number or not in the range of 200-599', () => {
    const errorType = 'Unknown Error';
    const consoleSpy = vi.spyOn(console, 'error');
    try {
      createErrorResponse(errorType as any);
    } catch (e) {}
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // Test the default case
  it('returns the same error type as status for unknown error types', () => {
    const errorType = 500; // Assume 500 is an unknown error type
    const response = createErrorResponse(errorType as any);
    expect(response.status).toBe(errorType);
  });

  // Test that the returned Response object contains the correct body and errorType
  it('returns a Response object with the correct body and errorType', () => {
    const errorType = ChatErrorType.NoOpenAIAPIKey;
    const body = { message: 'No API key provided' };
    const response = createErrorResponse(errorType, body);
    return response.json().then((data) => {
      expect(data).toEqual({
        body,
        errorType,
      });
    });
  });

  // Test that the returned Response object has an undefined body when no body is provided
  it('returns a Response object with an undefined body when no body is provided', () => {
    const errorType = ChatErrorType.NoOpenAIAPIKey;
    const response = createErrorResponse(errorType);
    return response.json().then((data) => {
      expect(data.body).toBeUndefined();
    });
  });
});
