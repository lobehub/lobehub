import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import {
  INLINE_TTS_AUDIO_FORMATS,
  resolveTTSModelRef,
  TTSProviderError,
  TTSRequestError,
  TTSService,
} from '@/server/services/tts';

import { BaseController, TRPC_CODE_TO_STATUS } from '../common/base.controller';
import type { SpeechRequest } from '../types/audio.type';
import { SpeechRequestSchema } from '../types/audio.type';

type OpenAIErrorType =
  | 'authentication_error'
  | 'invalid_request_error'
  | 'permission_error'
  | 'rate_limit_error'
  | 'server_error'
  | 'upstream_error';

/** Usage headers are custom, so browsers only expose them when listed here. */
const USAGE_HEADERS = [
  'X-LobeHub-Audio-Format',
  'X-LobeHub-Cost',
  'X-LobeHub-Provider',
  'X-LobeHub-Usage-Characters',
  'X-LobeHub-Usage-Tokens',
];

const isInlineFormat = (format: string): format is (typeof INLINE_TTS_AUDIO_FORMATS)[number] =>
  (INLINE_TTS_AUDIO_FORMATS as readonly string[]).includes(format);

const errorTypeForStatus = (status: number): OpenAIErrorType => {
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 502) return 'upstream_error';
  if (status >= 400 && status < 500) return 'invalid_request_error';
  return 'server_error';
};

/**
 * OpenAI-compatible text-to-speech, so external apps (desktop pets, bots) can call
 * LobeHub with an OpenAI SDK pointed at `/api/v1`.
 */
export class AudioController extends BaseController {
  /**
   * POST /api/v1/audio/speech
   * Body: SpeechRequest. Returns the audio bytes, or an OpenAI-style `{ error }` body.
   */
  async handleSpeech(c: Context): Promise<Response> {
    try {
      const parsed = SpeechRequestSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return this.openAIError(
          c,
          400,
          issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid JSON body',
          issue?.path.join('.'),
        );
      }

      const body: SpeechRequest = parsed.data;
      if (body.stream_format === 'sse') {
        return this.openAIError(c, 400, 'stream_format "sse" is not supported', 'stream_format');
      }
      if (body.response_format && !isInlineFormat(body.response_format)) {
        return this.openAIError(
          c,
          400,
          `response_format "${body.response_format}" is not supported; use one of ${INLINE_TTS_AUDIO_FORMATS.join(', ')}`,
          'response_format',
        );
      }

      const { model, provider } = resolveTTSModelRef(body.model, body.provider);
      const params = {
        ...body.params,
        ...(body.response_format && { format: body.response_format as 'mp3' | 'opus' | 'aac' }),
        ...(body.speed !== undefined && { speed: body.speed }),
        ...(body.instructions !== undefined && { instructions: body.instructions }),
      };

      const db = await this.getDatabase();
      const service = new TTSService(db, this.getUserId(c)!, this.getWorkspaceId(c));
      const result = await service.synthesize({
        input: body.input,
        model,
        params,
        provider,
        voice: typeof body.voice === 'string' ? body.voice : body.voice?.id,
      });

      const headers: Record<string, string> = {
        'Access-Control-Expose-Headers': USAGE_HEADERS.join(', '),
        'Content-Type': result.mimeType,
        'X-LobeHub-Audio-Format': result.format,
        'X-LobeHub-Provider': provider,
      };
      const { usage } = result;
      if (usage?.inputCharacters !== undefined) {
        headers['X-LobeHub-Usage-Characters'] = String(usage.inputCharacters);
      }
      if (usage?.totalTokens !== undefined) {
        headers['X-LobeHub-Usage-Tokens'] = String(usage.totalTokens);
      }
      if (usage?.cost !== undefined) headers['X-LobeHub-Cost'] = String(usage.cost);

      return new Response(result.audio, { headers, status: 200 });
    } catch (error) {
      return this.handleSpeechError(c, error);
    }
  }

  private handleSpeechError(c: Context, error: unknown): Response {
    if (error instanceof TTSRequestError) {
      return this.openAIError(c, 400, error.message, undefined, error.reason);
    }
    if (error instanceof TTSProviderError) {
      console.error('[audio/speech] provider error:', error.detail ?? error);
      const status = error.errorType === 'RateLimitExceeded' ? 429 : 502;
      return this.openAIError(c, status, error.message, undefined, error.errorType);
    }
    if (error instanceof HTTPException) return this.openAIError(c, error.status, error.message);
    if (error instanceof Error && error.name === 'TRPCError') {
      // Server-side guards (budget, workspace access) refuse with tRPC codes.
      const code = (error as Error & { code?: string }).code;
      const status =
        (code && TRPC_CODE_TO_STATUS[code]) || (code === 'PAYMENT_REQUIRED' ? 402 : 500);
      return this.openAIError(c, status, error.message, undefined, code);
    }

    console.error('[audio/speech] unexpected error:', error);
    return this.openAIError(
      c,
      500,
      error instanceof Error && error.message ? error.message : 'Text-to-speech failed',
    );
  }

  private openAIError(
    c: Context,
    status: number,
    message: string,
    param?: string,
    code?: string,
  ): Response {
    return c.json(
      {
        error: {
          code: code ?? null,
          message,
          param: param || null,
          type: errorTypeForStatus(status),
        },
      },
      status as any,
    );
  }
}
