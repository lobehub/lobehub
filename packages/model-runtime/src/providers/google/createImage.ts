import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from '@google/genai';
import { imageUrlToBase64 } from '@lobechat/utils';

import { convertGoogleAIUsage } from '../../core/usageConverters/google-ai';
import { AgentRuntimeErrorType } from '../../types/error';
import type {
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateImageResponse,
} from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { getModelPricing } from '../../utils/getModelPricing';
import { parseGoogleErrorMessage } from '../../utils/googleErrorParser';
import { parseDataUri } from '../../utils/uriParser';

// Maximum number of images allowed for processing
const MAX_IMAGE_COUNT = 10;
const GOOGLE_IMAGE_CONTENT_POLICY_TEXT_SIGNAL = '1';

export const GOOGLE_IMAGE_GENERATION_SYSTEM_PROMPT = [
  '<image_generation_contract>',
  'You are an image generation API endpoint, not a conversational assistant.',
  '',
  'Use the wrapped <user_request> as the image prompt.',
  'Return an image whenever possible. Do not answer conversationally.',
  '',
  'If the user request is conversational, ambiguous, or not a direct image prompt:',
  '- Do not answer the question in text.',
  '- Create a relevant visual interpretation of the request instead.',
  '- For model identity or capability questions, generate a simple visual metaphor for an AI image model.',
  '',
  'If no image can be returned:',
  '- If policy, moderation, or safety prevents generation, return text only: 1',
  '- If another concrete reason prevents generation, return that reason as concise user-safe text.',
  '',
  'Output rules:',
  '- Return the image.',
  '- If an image is returned, do not include captions or explanatory text.',
  '- Do not explain, apologize, ask follow-up questions, or wrap anything in Markdown.',
  '</image_generation_contract>',
].join('\n');

export const GOOGLE_IMAGE_GENERATION_USER_PROMPT_CONTRACT = [
  '<image_generation_request>',
  '<instruction>Generate an image whenever possible. If policy or safety blocks generation, return text only: 1.</instruction>',
].join('\n');

// Google enum values from GenerateContentResponse.FinishReason and
// PromptFeedback.BlockedReason that should be surfaced as provider moderation.
// Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/GenerateContentResponse
const GOOGLE_IMAGE_CONTENT_POLICY_FINISH_REASONS = new Set([
  'BLOCKLIST',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'IMAGE_SAFETY',
  'MODEL_ARMOR',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'SAFETY',
  'SPII',
]);

const GOOGLE_IMAGE_CONTENT_POLICY_BLOCK_REASONS = new Set([
  'BLOCKLIST',
  'IMAGE_SAFETY',
  'JAILBREAK',
  'MODEL_ARMOR',
  'PROHIBITED_CONTENT',
  'SAFETY',
]);

interface ErrorWithRawProviderResponse extends Error {
  isGoogleImageNoImageError?: boolean;
  providerReason?: string;
  providerResponse?: GenerateContentResponse;
  reasonCode?: string;
}

interface GoogleImageErrorMetadata {
  providerReason?: string;
  reasonCode?: string;
}

interface GoogleImageOptions {
  pricingContext?: CreateImageMethodOptions['pricingContext'];
  pricingModel?: string;
  routingModel?: string;
}

// Keep raw provider responses available to upstream error handlers without
// exposing text-only no-image responses through JSON serialization.
const attachNonSerializableProviderResponse = <T extends object>(
  target: T,
  response: GenerateContentResponse,
): T & { providerResponse?: GenerateContentResponse } => {
  Object.defineProperty(target, 'providerResponse', {
    configurable: true,
    enumerable: false,
    value: response,
  });

  return target;
};

const createGoogleImageNoImageError = (
  message: string,
  response: GenerateContentResponse,
  metadata?: GoogleImageErrorMetadata,
): ErrorWithRawProviderResponse => {
  const error = new Error(message) as ErrorWithRawProviderResponse;
  error.isGoogleImageNoImageError = true;

  if (metadata?.providerReason) {
    error.providerReason = metadata.providerReason;
  }
  if (metadata?.reasonCode) {
    error.reasonCode = metadata.reasonCode;
  }

  return attachNonSerializableProviderResponse(error, response) as ErrorWithRawProviderResponse;
};

const createGoogleImageContentPolicyError = (
  response: GenerateContentResponse,
  reason: string,
  message = 'Google image generation was blocked by content policy.',
  metadata?: Pick<GoogleImageErrorMetadata, 'reasonCode'>,
): ErrorWithRawProviderResponse => {
  const error = new Error(message) as ErrorWithRawProviderResponse;
  error.providerReason = reason;
  if (metadata?.reasonCode) {
    error.reasonCode = metadata.reasonCode;
  }

  return attachNonSerializableProviderResponse(error, response) as ErrorWithRawProviderResponse;
};

const getTextFromParts = (parts: Part[]) =>
  parts
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join('\n');

const escapeGoogleImageXmlText = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Some image gateways ignore systemInstruction-only fallback guidance and answer
// prompts like "can you generate images?" conversationally, so keep the API
// contract in the user part as well.
const buildGoogleImageUserPrompt = (prompt: string) =>
  [
    GOOGLE_IMAGE_GENERATION_USER_PROMPT_CONTRACT,
    '<user_request>',
    escapeGoogleImageXmlText(prompt),
    '</user_request>',
    '</image_generation_request>',
  ].join('\n');

const getGoogleImageContentPolicyReason = (response: GenerateContentResponse) => {
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const blockReason = response.promptFeedback?.blockReason;

  if (
    typeof finishReason === 'string' &&
    GOOGLE_IMAGE_CONTENT_POLICY_FINISH_REASONS.has(finishReason)
  ) {
    return finishReason;
  }
  if (
    typeof blockReason === 'string' &&
    GOOGLE_IMAGE_CONTENT_POLICY_BLOCK_REASONS.has(blockReason)
  ) {
    return blockReason;
  }
};

/**
 * Process a single image URL and convert it to Google AI Part format
 */
async function processImageForParts(imageUrl: string): Promise<Part> {
  const { mimeType, base64, type } = parseDataUri(imageUrl);

  if (type === 'base64') {
    if (!base64) {
      throw new TypeError("Image URL doesn't contain base64 data");
    }

    return {
      inlineData: {
        data: base64,
        mimeType: mimeType || 'image/png',
      },
    };
  } else if (type === 'url') {
    const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(imageUrl);

    return {
      inlineData: {
        data: urlBase64,
        mimeType: urlMimeType,
      },
    };
  } else {
    throw new TypeError(`currently we don't support image url: ${imageUrl}`);
  }
}

/**
 * Extract image data from generateContent response
 */
function extractImageFromResponse(response: GenerateContentResponse): CreateImageResponse {
  const candidate = response.candidates?.[0];
  const contentPolicyReason = getGoogleImageContentPolicyReason(response);

  if (contentPolicyReason) {
    throw createGoogleImageContentPolicyError(response, contentPolicyReason);
  }

  if (candidate?.finishReason === 'NO_IMAGE') {
    throw createGoogleImageNoImageError('No image generated', response);
  }
  if (!candidate?.content?.parts) {
    // Handle cases where Google returns 200 but omits image parts (often moderation)
    throw createGoogleImageNoImageError('No image generated', response);
  }

  for (const part of candidate.content.parts) {
    if (part.inlineData?.data) {
      const imageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      return { imageUrl };
    }
  }

  const textFromParts = getTextFromParts(candidate.content.parts);
  if (textFromParts) {
    if (textFromParts.trim() === GOOGLE_IMAGE_CONTENT_POLICY_TEXT_SIGNAL) {
      throw createGoogleImageContentPolicyError(
        response,
        'TEXT_POLICY_REFUSAL',
        'Google image generation was blocked by text policy refusal.',
        { reasonCode: 'google_image_content_policy_violation' },
      );
    }

    throw createGoogleImageNoImageError(textFromParts, response, {
      reasonCode: 'google_image_text_only_response',
    });
  }

  // Fallback when no inlineData is present (commonly moderation or policy blocks)
  throw createGoogleImageNoImageError('No image data found in response', response);
}

/**
 * Generate images using traditional Imagen models with generateImages API
 */
async function generateByImageModel(
  client: GoogleGenAI,
  payload: CreateImagePayload,
): Promise<CreateImageResponse> {
  const { model, params } = payload;

  const response = await client.models.generateImages({
    config: {
      aspectRatio: params.aspectRatio,
      numberOfImages: 1,
    },
    model,
    prompt: params.prompt,
  });

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageBytes) {
    throw new Error('No image generated');
  }

  // 1. official doc use png as example
  // 2. no responseType param support like openai now.
  // I think we can just hard code png now
  const imageUrl = `data:image/png;base64,${imageBytes}`;

  return { imageUrl };
}

/**
 * Generate images using Gemini Chat Models with generateContent
 */
async function generateImageByChatModel(
  client: GoogleGenAI,
  payload: CreateImagePayload,
  provider: string,
  options?: Pick<GoogleImageOptions, 'pricingContext' | 'pricingModel'>,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const actualModel = model.replace(':image', '');

  // Check for conflicting image parameters
  if (params.imageUrl && params.imageUrls && params.imageUrls.length > 0) {
    throw new TypeError('Cannot provide both imageUrl and imageUrls parameters simultaneously');
  }

  // Build content parts
  const parts: Part[] = [{ text: buildGoogleImageUserPrompt(params.prompt) }];

  // Add image for editing if provided
  if (params.imageUrl && params.imageUrl !== null) {
    const imagePart = await processImageForParts(params.imageUrl);
    parts.push(imagePart);
  }

  // Add multiple images for editing if provided
  if (params.imageUrls && Array.isArray(params.imageUrls) && params.imageUrls.length > 0) {
    if (params.imageUrls.length > MAX_IMAGE_COUNT) {
      throw new TypeError(`Too many images provided. Maximum ${MAX_IMAGE_COUNT} images allowed`);
    }

    const imageParts = await Promise.all(
      params.imageUrls.map((imageUrl) => processImageForParts(imageUrl)),
    );
    parts.push(...imageParts);
  }

  const contents: Content[] = [
    {
      parts,
      role: 'user',
    },
  ];

  // Build imageConfig independently for aspectRatio and resolution so that
  // selecting only one (e.g. resolution=4K while aspectRatio stays 'auto')
  // still reaches the Google API. Previously both fields were gated on
  // aspectRatio !== 'auto', which silently dropped the user's resolution.
  const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
  if (params.aspectRatio && params.aspectRatio !== 'auto') {
    imageConfig.aspectRatio = params.aspectRatio;
  }
  if (params.resolution) {
    imageConfig.imageSize = params.resolution;
  }

  const config: GenerateContentConfig = {
    responseModalities: ['TEXT', 'IMAGE'],
    systemInstruction: GOOGLE_IMAGE_GENERATION_SYSTEM_PROMPT,
    ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
  };

  const response = await client.models.generateContent({
    config,
    contents,
    model: actualModel,
  });

  const imageResponse = extractImageFromResponse(response);
  if (response.usageMetadata) {
    const pricing = await getModelPricing(
      options?.pricingModel ?? model,
      provider,
      options?.pricingContext,
    );
    imageResponse.modelUsage = convertGoogleAIUsage(response.usageMetadata, pricing);
  }

  return imageResponse;
}

/**
 * Create image using Google AI models
 */
export async function createGoogleImage(
  client: GoogleGenAI,
  provider: string,
  payload: CreateImagePayload,
  options?: GoogleImageOptions,
): Promise<CreateImageResponse> {
  try {
    const routingModel = options?.routingModel ?? payload.model;

    // Handle Gemini 2.5 Flash Image models that use generateContent
    if (routingModel.endsWith(':image')) {
      return await generateImageByChatModel(client, payload, provider, options);
    }

    // Handle traditional Imagen models that use generateImages
    return await generateByImageModel(client, payload);
  } catch (error) {
    const err = error as Error;

    if ((err as any)?.errorType) {
      throw err;
    }

    const { errorType, error: parsedError } = parseGoogleErrorMessage(err.message);
    const providerResponse = (err as ErrorWithRawProviderResponse).providerResponse;
    const providerReason =
      (err as ErrorWithRawProviderResponse).providerReason ??
      (providerResponse ? getGoogleImageContentPolicyReason(providerResponse) : undefined);
    const isContentPolicyViolation = Boolean(providerReason);
    const isGoogleImageNoImageError = Boolean(
      (err as ErrorWithRawProviderResponse).isGoogleImageNoImageError,
    );
    const reasonCode =
      (err as ErrorWithRawProviderResponse).reasonCode ??
      (isContentPolicyViolation ? 'google_image_content_policy_violation' : undefined);
    const agentError = AgentRuntimeError.createImage({
      error: {
        ...parsedError,
        providerReason,
        reasonCode,
        responseId: providerResponse?.responseId,
      },
      errorType: isContentPolicyViolation
        ? AgentRuntimeErrorType.ProviderContentPolicyViolation
        : isGoogleImageNoImageError
          ? AgentRuntimeErrorType.ProviderNoImageGenerated
          : errorType,
      provider,
    });

    if (providerResponse) {
      attachNonSerializableProviderResponse(agentError, providerResponse);
    }

    throw agentError;
  }
}
