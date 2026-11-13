import OpenAI from 'openai';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleImage } from '../../core/openaiCompatibleFactory/createImage';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*(data:image\/[^)\s]+|https?:\/\/[^)\s]+)\s*\)/;

/**
 * Gemini image models answer on chat completions with the image as markdown in `message.content`,
 * which the shared chat route does not read (it reads `message.images`). Everything else uses the shared code.
 */
export async function createSteadyRouterImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL ?? undefined });

  const requestModel = resolveMappedModelId(payload.model, options);

  if (!payload.model.endsWith(':image')) {
    return createOpenAICompatibleImage(client, payload, options.provider, {
      pricingModel: payload.model,
      requestModel,
      routingModel: payload.model,
    });
  }

  const { imageUrls, prompt } = payload.params;
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    { text: prompt, type: 'text' },
    ...(imageUrls ?? []).map((url) => ({ image_url: { url }, type: 'image_url' as const })),
  ];
  const response = await client.chat.completions.create({
    messages: [{ content, role: 'user' }],
    model: requestModel.replace(/:image$/, ''),
    stream: false,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const imageUrl = text.match(MARKDOWN_IMAGE)?.[1];
  if (!imageUrl) throw new Error('No image generated in chat completion response');

  return { imageUrl };
}
