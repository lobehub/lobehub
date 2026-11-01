import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it } from 'vitest';

import { ErrorHandlerService } from '@/server/services/comfyui/core/errorHandlerService';
import {
  ConfigError,
  ServicesError,
  UtilsError,
  WorkflowError,
} from '@/server/services/comfyui/errors';
import { ModelResolverError } from '@/server/services/comfyui/errors/modelResolverError';

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;

  beforeEach(() => {
    service = new ErrorHandlerService();
  });

  describe('handleError', () => {
    describe('ComfyUI internal errors', () => {
      it('should handle ConfigError correctly', () => {
        const error = new ConfigError('Config is invalid', ConfigError.Reasons.INVALID_CONFIG, {
          config: 'test',
        });

        expect(() => service.handleError(error)).toThrow();

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
          expect(e.cause.error.message).toBe('Config is invalid');
          expect(e.cause.error.details).toEqual({ config: 'test' });
          expect(e.cause.provider).toBe('comfyui');
        }
      });

      it('should handle WorkflowError with UNSUPPORTED_MODEL', () => {
        const error = new WorkflowError(
          'Model not supported',
          WorkflowError.Reasons.UNSUPPORTED_MODEL,
          { model: 'flux1-dev.safetensors' },
        );

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ModelNotFound);
          expect(e.cause.error.message).toBe('Model not supported');
        }
      });

      it('should handle WorkflowError with MISSING_COMPONENT', () => {
        const error = new WorkflowError(
          'Component missing',
          WorkflowError.Reasons.MISSING_COMPONENT,
          { component: 'vae' },
        );

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ComfyUIModelError);
        }
      });

      it('should handle UtilsError correctly', () => {
        const error = new UtilsError('Connection failed', UtilsError.Reasons.CONNECTION_ERROR);

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ComfyUIServiceUnavailable);
        }
      });

      it('should handle ModelResolverError correctly', () => {
        const error = new ModelResolverError('MODEL_NOT_FOUND', 'Model not found');

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ModelNotFound);
        }
      });

      it('should use default error type for unknown reasons', () => {
        const error = new ConfigError('Unknown error', 'UNKNOWN_REASON' as any);

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        }
      });

      it('should handle ServicesError with all mapped reasons', () => {
        // Test a mapped reason
        const error1 = new ServicesError('Model not found', ServicesError.Reasons.MODEL_NOT_FOUND, {
          model: 'test',
        });

        try {
          service.handleError(error1);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ModelNotFound);
        }

        // Test unmapped reason - should hit line 120 and return default
        const error2 = new ServicesError('Unknown error', 'UNMAPPED_REASON' as any, {});

        try {
          service.handleError(error2);
        } catch (e: any) {
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        }
      });
    });

    describe('Pre-formatted framework errors', () => {
      it('should pass through pre-formatted errors', () => {
        const error = {
          errorType: AgentRuntimeErrorType.ComfyUIWorkflowError,
          message: 'Already formatted',
          provider: 'comfyui',
        };

        expect(() => service.handleError(error)).toThrowError();

        try {
          service.handleError(error);
        } catch (e: any) {
          // Verify the cause contains the same error properties
          expect(e.cause.errorType).toBe(error.errorType);
          expect(e.cause.message).toBe(error.message);
          expect(e.cause.provider).toBe(error.provider);
        }
      });
    });

    describe('Other errors', () => {
      it('should parse string errors', () => {
        const error = 'Some error message';

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.provider).toBe('comfyui');
          expect(e.cause.error).toBeDefined();
        }
      });

      it('should parse Error objects', () => {
        const error = new Error('Standard error');

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.provider).toBe('comfyui');
          expect(e.cause.error).toBeDefined();
        }
      });

      it('should handle null/undefined errors', () => {
        expect(() => service.handleError(null)).toThrow();
        expect(() => service.handleError(undefined)).toThrow();
      });
    });
  });

  describe('Error mapping completeness', () => {
    it('should map all ConfigError reasons', () => {
      const reasons = Object.values(ConfigError.Reasons);

      reasons.forEach((reason) => {
        const error = new ConfigError('Test', reason);

        expect(() => service.handleError(error)).toThrow();

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBeDefined();
          expect(e.cause.errorType).toBe(AgentRuntimeErrorType.ComfyUIBizError);
        }
      });
    });

    it('should map all WorkflowError reasons', () => {
      const reasons = Object.values(WorkflowError.Reasons);
      const expectedMapping: Record<string, string> = {
        [WorkflowError.Reasons.INVALID_CONFIG]: AgentRuntimeErrorType.ComfyUIWorkflowError,
        [WorkflowError.Reasons.MISSING_COMPONENT]: AgentRuntimeErrorType.ComfyUIModelError,
        [WorkflowError.Reasons.MISSING_ENCODER]: AgentRuntimeErrorType.ComfyUIModelError,
        [WorkflowError.Reasons.UNSUPPORTED_MODEL]: AgentRuntimeErrorType.ModelNotFound,
        [WorkflowError.Reasons.INVALID_PARAMS]: AgentRuntimeErrorType.ComfyUIWorkflowError,
      };

      reasons.forEach((reason) => {
        const error = new WorkflowError('Test', reason);

        try {
          service.handleError(error);
        } catch (e: any) {
          const expected = expectedMapping[reason] || AgentRuntimeErrorType.ComfyUIWorkflowError;
          expect(e.cause.errorType).toBe(expected);
        }
      });
    });

    it('should map all UtilsError reasons', () => {
      const reasons = Object.values(UtilsError.Reasons);

      reasons.forEach((reason) => {
        const error = new UtilsError('Test', reason);

        expect(() => service.handleError(error)).toThrow();

        try {
          service.handleError(error);
        } catch (e: any) {
          expect(e.cause.errorType).toBeDefined();
          // Should not be undefined
          expect(e.cause.errorType).not.toBe(undefined);
        }
      });
    });
  });
});
