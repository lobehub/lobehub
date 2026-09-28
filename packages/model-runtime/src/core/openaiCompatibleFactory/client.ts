import { isRecord } from '@lobechat/utils';
import OpenAI from 'openai';

/** Preserves flat JSON errors returned by OpenAI-compatible providers. */
export class OpenAICompatibleClient extends OpenAI {
  protected override makeStatusError(
    status: number,
    error: object,
    message: string | undefined,
    headers: Headers,
  ) {
    // The SDK only reads errorResponse.error and otherwise discards parsed JSON.
    // https://github.com/openai/openai-node/blob/master/src/core/error.ts
    const flatError =
      isRecord(error) &&
      !('error' in error) &&
      (typeof error.message === 'string' || typeof error.reason === 'string');

    return super.makeStatusError(status, flatError ? { error } : error, message, headers);
  }
}
