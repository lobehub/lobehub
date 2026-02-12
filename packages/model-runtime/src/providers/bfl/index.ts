import createDebug from 'debug';
import type { ClientOptions } from 'openai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { createBflImage } from './createImage';

const log = createDebug('lobe-image:bfl');

export class LobeBflAI implements LobeRuntimeAI {
  private apiKey: string;
  baseURL?: string;

  constructor({ apiKey, baseURL }: ClientOptions = {}) {
    if (!apiKey) throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey;
    this.baseURL = baseURL || undefined;

    log('BFL AI initialized');
  }

  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    const { model, params } = payload;
    log('Creating image with model: %s and params: %O', model, params);

    try {
      return await createBflImage(payload, {
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        provider: 'bfl',
      });
    } catch (error) {
      log('Error in createImage: %O', error);

      // Check for authentication errors based on HTTP status or error properties
      if (error instanceof Error && 'status' in error && (error as any).status === 401) {
        throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey, {
          error,
        });
      }

      // Wrap other errors
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, { error });
    }
  }
}
