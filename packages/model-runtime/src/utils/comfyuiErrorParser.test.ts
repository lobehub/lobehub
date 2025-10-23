import { describe, expect, it } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { cleanComfyUIErrorMessage, parseComfyUIErrorMessage } from './comfyuiErrorParser';

describe('comfyuiErrorParser', () => {
  describe('cleanComfyUIErrorMessage', () => {
    it('should remove leading asterisks and spaces', () => {
      const message = '* Error message';
      expect(cleanComfyUIErrorMessage(message)).toBe('Error message');

      // Test multiple asterisks
      const multiAsterisk = '* * * Error message';
      expect(cleanComfyUIErrorMessage(multiAsterisk)).toBe('* * Error message');
    });

    it('should convert escaped newlines', () => {
      const message = 'Line 1\\nLine 2';
      expect(cleanComfyUIErrorMessage(message)).toBe('Line 1 Line 2');
    });

    it('should replace multiple newlines with single space', () => {
      const message = 'Line 1\n\n\nLine 2';
      expect(cleanComfyUIErrorMessage(message)).toBe('Line 1 Line 2');
    });

    it('should trim leading and trailing spaces', () => {
      const message = '  Error message  ';
      expect(cleanComfyUIErrorMessage(message)).toBe('Error message');
    });
  });

  describe('parseComfyUIErrorMessage', () => {
    describe('HTTP status code errors', () => {
      it('should identify 401 as InvalidProviderAPIKey', () => {
        const error = { message: 'Unauthorized', status: 401 };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      });

      it('should identify 403 as PermissionDenied', () => {
        const error = { message: 'Forbidden', status: 403 };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.PermissionDenied);
      });

      it('should identify 404 as InvalidProviderAPIKey', () => {
        const error = { message: 'Not Found', status: 404 };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      });

      it('should identify 500+ as ComfyUIServiceUnavailable', () => {
        const error = { message: 'Internal Server Error', status: 500 };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIServiceUnavailable);
      });

      it('should identify HTTP status in message when status field missing', () => {
        const error = { message: 'Request failed with HTTP 401' };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      });
    });

    describe('Network errors', () => {
      it('should return ComfyUIBizError for fetch failed (processed by server)', () => {
        const error = new Error('fetch failed');
        const result = parseComfyUIErrorMessage(error);

        // Network error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('fetch failed');
      });

      it('should return ComfyUIBizError for ECONNREFUSED (processed by server)', () => {
        const error = { message: 'Connection ECONNREFUSED', code: 'ECONNREFUSED' };
        const result = parseComfyUIErrorMessage(error);

        // Network error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Connection ECONNREFUSED');
      });

      it('should return ComfyUIBizError for WebSocket errors (processed by server)', () => {
        const error = { message: 'WebSocket connection failed', code: 'WS_CONNECTION_FAILED' };
        const result = parseComfyUIErrorMessage(error);

        // Network error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('WebSocket connection failed');
      });
    });

    describe('Model errors', () => {
      it('should return ComfyUIBizError for model not found (processed by server)', () => {
        const error = { message: 'Model not found: flux1-dev.safetensors' };
        const result = parseComfyUIErrorMessage(error);

        // Model error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Model not found: flux1-dev.safetensors');
      });

      it('should return ComfyUIBizError for checkpoint not found (processed by server)', () => {
        const error = { message: 'Checkpoint not found' };
        const result = parseComfyUIErrorMessage(error);

        // Model error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Checkpoint not found');
      });

      it('should return ComfyUIBizError for safetensors file errors (processed by server)', () => {
        const error = { message: 'Missing file: model.safetensors' };
        const result = parseComfyUIErrorMessage(error);

        // Model error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Missing file: model.safetensors');
      });

      it('should preserve server-provided file info but return ComfyUIBizError', () => {
        const error = {
          message: 'Some error',
          missingFileName: 'flux1-dev.safetensors',
          missingFileType: 'model',
        };
        const result = parseComfyUIErrorMessage(error);

        // File info is preserved but error type detection is server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.missingFileName).toBe('flux1-dev.safetensors');
        expect(result.error.missingFileType).toBe('model');
      });
    });

    describe('Workflow errors', () => {
      it('should return ComfyUIBizError for workflow validation errors (processed by server)', () => {
        const error = { message: 'Workflow validation failed' };
        const result = parseComfyUIErrorMessage(error);

        // Workflow error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Workflow validation failed');
      });

      it('should return ComfyUIBizError for node execution errors (processed by server)', () => {
        const error = {
          message: 'Node execution failed',
          node_id: '5',
          node_type: 'KSampler',
        };
        const result = parseComfyUIErrorMessage(error);

        // Workflow error detection moved to server-side, but node info is preserved
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Node execution failed');
        expect(result.error.details).toEqual({
          node_id: '5',
          node_type: 'KSampler',
        });
      });

      it('should return ComfyUIBizError for queue errors (processed by server)', () => {
        const error = { message: 'Queue processing error' };
        const result = parseComfyUIErrorMessage(error);

        // Workflow error detection moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Queue processing error');
      });
    });

    describe('SDK custom errors', () => {
      it('should identify SDK error classes', () => {
        const error = {
          name: 'ExecutionFailedError',
          message: 'Execution failed',
        };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
      });

      it('should identify SDK error messages', () => {
        const error = { message: 'SDK Error: Invalid configuration' };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
      });
    });

    describe('JSON parsing errors', () => {
      it('should return ComfyUIBizError for SyntaxError (SyntaxError detection moved to server)', () => {
        const error = new SyntaxError('Unexpected token < in JSON at position 0');
        const result = parseComfyUIErrorMessage(error);

        // SyntaxError detection and message enhancement moved to server-side
        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('Unexpected token < in JSON at position 0');
        expect(result.error.type).toBe('SyntaxError');
      });
    });

    describe('Error information extraction', () => {
      it('should extract error info from string', () => {
        const error = 'Simple error message';
        const result = parseComfyUIErrorMessage(error);

        expect(result.error.message).toBe('Simple error message');
      });

      it('should extract error info from Error object', () => {
        const error = new Error('Error message');
        (error as any).code = 'ERROR_CODE';
        (error as any).status = 500;

        const result = parseComfyUIErrorMessage(error);

        expect(result.error.message).toBe('Error message');
        expect(result.error.code).toBe('ERROR_CODE');
        expect(result.error.status).toBe(500);
        expect(result.error.type).toBe('Error');
      });

      it('should extract error info from structured object', () => {
        const error = {
          message: 'Error message',
          code: 'ERROR_CODE',
          status: 400,
          details: { foo: 'bar' },
          node_id: '5',
          node_type: 'KSampler',
        };

        const result = parseComfyUIErrorMessage(error);

        expect(result.error.message).toBe('Error message');
        expect(result.error.code).toBe('ERROR_CODE');
        expect(result.error.status).toBe(400);
        expect(result.error.details).toEqual({
          foo: 'bar',
          node_id: '5',
          node_type: 'KSampler',
        });
      });

      it('should preserve server-generated file info and guidance', () => {
        const error = {
          message: 'Model file missing',
          missingFileName: 'flux1-dev.safetensors',
          missingFileType: 'model' as const,
          userGuidance: 'Please download the model from...',
        };

        const result = parseComfyUIErrorMessage(error);

        expect(result.error.missingFileName).toBe('flux1-dev.safetensors');
        expect(result.error.missingFileType).toBe('model');
        expect(result.error.userGuidance).toBe('Please download the model from...');
      });

      it('should extract nested error info from various locations', () => {
        const error = {
          body: {
            error: {
              message: 'Nested error',
              missingFileName: 'ae.safetensors',
              userGuidance: 'Download VAE model',
            },
          },
        };

        const result = parseComfyUIErrorMessage(error);

        expect(result.error.missingFileName).toBe('ae.safetensors');
        expect(result.error.userGuidance).toBe('Download VAE model');
      });

      it('should handle cause field (SDK pattern)', () => {
        const error = new Error('Wrapper error');
        (error as any).cause = {
          message: 'Actual error',
          code: 'ACTUAL_CODE',
        };

        const result = parseComfyUIErrorMessage(error);

        expect(result.error.message).toBe('Actual error');
        expect(result.error.code).toBe('ACTUAL_CODE');
        // Type comes from the cause object's constructor name (plain object = "Object")
        expect(result.error.type).toBe('Object');
      });

      it('should extract message from various possible sources', () => {
        const error = {
          exception_message: 'ComfyUI exception',
          error: {
            message: 'Should not use this',
          },
        };

        const result = parseComfyUIErrorMessage(error);

        // exception_message has highest priority
        expect(result.error.message).toBe('ComfyUI exception');
      });
    });

    describe('AgentRuntimeError handling', () => {
      it('should detect and return AgentRuntimeError as-is', () => {
        const agentRuntimeError = {
          error: {
            message: 'Model not found',
            missingFileName: 'flux1-dev.safetensors',
            missingFileType: 'model',
            userGuidance: 'Please download the model',
          },
          errorType: AgentRuntimeErrorType.ModelNotFound,
          provider: 'comfyui',
        };

        const result = parseComfyUIErrorMessage(agentRuntimeError);

        expect(result.errorType).toBe(AgentRuntimeErrorType.ModelNotFound);
        expect(result.error).toEqual(agentRuntimeError.error);
      });

      it('should handle AgentRuntimeError with InvalidProviderAPIKey', () => {
        const agentRuntimeError = {
          error: {
            message: 'Authentication failed',
            status: 401,
          },
          errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
          provider: 'comfyui',
        };

        const result = parseComfyUIErrorMessage(agentRuntimeError);

        expect(result.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
        expect(result.error.message).toBe('Authentication failed');
      });
    });

    describe('Default error handling', () => {
      it('should handle unknown error types', () => {
        const error = { random: 'data' };
        const result = parseComfyUIErrorMessage(error);

        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toContain('object');
      });

      it('should handle null/undefined gracefully', () => {
        const result = parseComfyUIErrorMessage(null);

        expect(result.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        expect(result.error.message).toBe('null');
      });
    });
  });
});
