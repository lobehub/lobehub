import type { GoogleGenAIOptions } from '@google/genai';
import { GoogleGenAI } from '@google/genai';

import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { LobeGoogleAI } from '../google';

const DEFAULT_VERTEXAI_LOCATION = 'global';

export class LobeVertexAI extends LobeGoogleAI {
  static initFromVertexAI(params?: GoogleGenAIOptions) {
    try {
      const client = new GoogleGenAI({
        ...params,
        location: params?.location ?? DEFAULT_VERTEXAI_LOCATION, // @google/genai 不传 location 会报错
        vertexai: true,
      });

      return new LobeGoogleAI({ apiKey: 'avoid-error', client, isVertexAi: true });
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
