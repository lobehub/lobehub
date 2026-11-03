import type { GoogleGenAIOptions } from '@google/genai';
import { GoogleGenAI } from '@google/genai';

import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { LobeGoogleAI } from '../google';

const DEFAULT_VERTEXAI_LOCATION = 'global';
type VertexAIInitOptions = GoogleGenAIOptions & ModelIdMappingOptions;

export class LobeVertexAI extends LobeGoogleAI {
  static initFromVertexAI(params?: VertexAIInitOptions) {
    try {
      const { modelIdMapping, ...googleOptions } = params ?? {};
      const client = new GoogleGenAI({
        ...googleOptions,
        location: googleOptions.location ?? DEFAULT_VERTEXAI_LOCATION, // @google/genai throws an error if location is not provided
        vertexai: true,
      });

      return new LobeGoogleAI({
        apiKey: 'avoid-error',
        client,
        isVertexAi: true,
        modelIdMapping,
      });
    } catch (e) {
      const err = e as Error;

      if (err.name === 'IllegalArgumentError') {
        throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidVertexCredentials, {
          message: err.message,
        });
      }

      throw e;
    }
  }
}
