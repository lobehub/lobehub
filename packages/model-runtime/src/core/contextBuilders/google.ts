import type {
  Content,
  FunctionDeclaration,
  Part,
  Tool as GoogleFunctionCallTool,
} from '@google/genai';
import { imageUrlToBase64, resolveImageMimeTypeFromBase64 } from '@lobechat/utils';

import type { ChatCompletionTool, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { isPublicExternalUrl, parseDataUri, validateExternalUrl } from '../../utils/uriParser';

const GOOGLE_SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg', // non-standard but widely used alias for image/jpeg
  'image/webp',
  'image/heic',
  'image/heif',
]);

const isImageTypeSupported = (mimeType: string | null | undefined): mimeType is string =>
  !!mimeType && GOOGLE_SUPPORTED_IMAGE_TYPES.has(mimeType.toLowerCase());

/**
 * Magic thoughtSignature to bypass Gemini thought signature validation.
 * Use `skip_thought_signature_validator` instead of `context_engineering_is_the_way_to_go`
 * because Vertex AI only accepts `skip_thought_signature_validator`.
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 * @see https://github.com/pydantic/pydantic-ai/issues/3881
 */
export const GEMINI_MAGIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

const getGeminiMajorVersion = (model?: string) => {
  if (!model) return null;

  // Examples:
  // - gemini-3-flash-preview
  // - gemini-2.5-flash
  const match = model.match(/gemini-(\d+)(?:\.(\d+))?/i);
  if (!match?.[1]) return null;

  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
};

/**
 * External HTTP / Signed URLs support varies by model generation.
 * In practice, Gemini 3+ supports `fileData.fileUri` for external URLs reliably,
 * while earlier models often require `inlineData`.
 * Returns false for unversioned model IDs (e.g. gemini-pro) to avoid request failures.
 */
const supportsExternalUrlFileData = (model?: string) => {
  const major = getGeminiMajorVersion(model);
  if (major === null) return false;
  return major >= 3;
};

const buildExternalUrlFileDataPart = async (
  url: string,
  options?: { model?: string },
): Promise<Part | undefined> => {
  if (!supportsExternalUrlFileData(options?.model) || !isPublicExternalUrl(url)) return undefined;

  const validation = await validateExternalUrl(url);
  if (validation.isValid) {
    return {
      fileData: {
        fileUri: url,
        mimeType: validation.contentType,
      },
      thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
    };
  }

  if (validation.isTooLarge) {
    throw new RangeError(validation.reason || 'External URL file too large');
  }

  return undefined;
};

/**
 * Convert OpenAI content part to Google Part format
 *
 * TODO: urlContext tool only supports files up to 34MB. In the future, we should
 * detect file URLs in the conversation and use External URL feature (fileData.fileUri)
 * for files larger than 34MB to avoid urlContext limitations.
 * @see https://ai.google.dev/gemini-api/docs/file-input-methods
 */
export const buildGooglePart = async (
  content: UserMessageContentPart,
  options?: { model?: string },
): Promise<Part | undefined> => {
  switch (content.type) {
    default: {
      return undefined;
    }

    case 'text': {
      return {
        text: content.text,
        thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
      };
    }

    case 'image_url': {
      const { mimeType, base64, type } = parseDataUri(content.image_url.url);

      if (type === 'base64') {
        if (!base64) {
          throw new TypeError("Image URL doesn't contain base64 data");
        }

        const resolvedMimeType = await resolveImageMimeTypeFromBase64(mimeType, base64);

        if (!isImageTypeSupported(resolvedMimeType)) return undefined;

        return {
          inlineData: { data: base64, mimeType: resolvedMimeType },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      if (type === 'url') {
        const url = content.image_url.url;

        const externalUrlPart = await buildExternalUrlFileDataPart(url, options);
        if (externalUrlPart) return externalUrlPart;

        // Fallback: convert URL to base64 (for private/local URLs or failed validation)
        const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(url);
        const resolvedMimeType = urlMimeType || mimeType;

        if (!isImageTypeSupported(resolvedMimeType)) return undefined;

        return {
          inlineData: { data: urlBase64, mimeType: resolvedMimeType || 'image/png' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      throw new TypeError(`currently we don't support image url: ${content.image_url.url}`);
    }

    case 'video_url': {
      const { mimeType, base64, type } = parseDataUri(content.video_url.url);

      if (type === 'base64') {
        if (!base64) {
          throw new TypeError("Video URL doesn't contain base64 data");
        }

        return {
          inlineData: { data: base64, mimeType: mimeType || 'video/mp4' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      if (type === 'url') {
        const url = content.video_url.url;

        const externalUrlPart = await buildExternalUrlFileDataPart(url, options);
        if (externalUrlPart) return externalUrlPart;

        // Fallback: convert URL to base64
        // Use imageUrlToBase64 for SSRF protection (works for any binary data including videos)
        // Note: This might need size/duration limits for practical use
        const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(url);

        return {
          inlineData: { data: urlBase64, mimeType: urlMimeType },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      throw new TypeError(`currently we don't support video url: ${content.video_url.url}`);
    }
  }
};

/**
 * Convert OpenAI message to Google Content format
 */
export const buildGoogleMessage = async (
  message: OpenAIChatMessage,
  toolCallNameMap?: Map<string, string>,
  options?: { model?: string },
): Promise<Content> => {
  const content = message.content as string | UserMessageContentPart[];

  // Handle assistant messages with tool_calls
  if (!!message.tool_calls) {
    return {
      parts: message.tool_calls.map<Part>((tool) => {
        const parsed = safeParseJSON(tool.function.arguments);
        // Gemini's functionCall.args requires a plain object, same constraint
        // as Anthropic's tool_use.input. See anthropic.ts for the full
        // recovery rationale.
        let args: Record<string, unknown> = {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed[0] &&
          typeof parsed[0] === 'object' &&
          !Array.isArray(parsed[0])
        ) {
          args = parsed[0] as Record<string, unknown>;
          console.warn(
            '[google] functionCall.args recovered from array — parsed arguments was wrapped in []',
            {
              argumentsLength: tool.function.arguments?.length,
              arrayLength: parsed.length,
              name: tool.function.name,
            },
          );
        } else if (parsed !== undefined) {
          console.warn(
            '[google] functionCall.args fallback to {} — parsed arguments is not a plain object',
            {
              argumentsLength: tool.function.arguments?.length,
              name: tool.function.name,
              parsedType: Array.isArray(parsed)
                ? 'array'
                : parsed === null
                  ? 'null'
                  : typeof parsed,
            },
          );
        }
        return {
          functionCall: { args, name: tool.function.name },
          thoughtSignature: tool.thoughtSignature,
        };
      }),
      role: 'model',
    };
  }

  // Convert tool_call result to functionResponse part
  if (message.role === 'tool' && toolCallNameMap && message.tool_call_id) {
    const functionName = toolCallNameMap.get(message.tool_call_id);
    if (functionName) {
      return {
        parts: [
          {
            functionResponse: {
              name: functionName,
              response: { result: message.content },
            },
          },
        ],
        role: 'user',
      };
    }
  }

  const getParts = async () => {
    if (typeof content === 'string')
      return [{ text: content, thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }];

    const parts = await Promise.all(content.map(async (c) => await buildGooglePart(c, options)));
    return parts.filter(Boolean) as Part[];
  };

  return {
    parts: await getParts(),
    role: message.role === 'assistant' ? 'model' : 'user',
  };
};

/**
 * Convert messages from the OpenAI format to Google GenAI SDK format
 */
export const buildGoogleMessages = async (
  messages: OpenAIChatMessage[],
  options?: { model?: string },
): Promise<Content[]> => {
  const toolCallNameMap = new Map<string, string>();

  // Build tool call id to name mapping
  messages.forEach((message) => {
    if (message.role === 'assistant' && message.tool_calls) {
      message.tool_calls.forEach((toolCall) => {
        if (toolCall.type === 'function') {
          toolCallNameMap.set(toolCall.id, toolCall.function.name);
        }
      });
    }
  });

  const pools = messages
    .filter((message) => message.role !== 'function')
    .map(async (msg) => await buildGoogleMessage(msg, toolCallNameMap, options));

  const contents = await Promise.all(pools);

  // Filter out empty messages: contents.parts must not be empty.
  const nonEmptyContents = contents.filter(
    (content: Content) => content.parts && content.parts.length > 0,
  );

  // Merge consecutive functionResponse contents into a single Content.
  // Vertex AI requires the number of functionResponse parts to equal
  // the number of functionCall parts in the preceding model turn.
  const filteredContents: Content[] = [];
  for (const content of nonEmptyContents) {
    const isFunctionResponse =
      content.role === 'user' && content.parts?.every((p) => p.functionResponse);

    const last = filteredContents.at(-1);
    const lastIsFunctionResponse =
      last?.role === 'user' && last.parts?.every((p) => p.functionResponse);

    if (isFunctionResponse && lastIsFunctionResponse) {
      last!.parts = [...(last!.parts || []), ...(content.parts || [])];
    } else {
      filteredContents.push(content);
    }
  }

  // Add magic signature to all function calls that don't have thoughtSignature.
  // This handles cross-provider scenarios (e.g., OpenAI → Gemini switch) where
  // historical tool_calls lack thoughtSignature, as well as multi-turn Gemini
  // conversations where earlier turns may have lost their signatures.
  // @see https://linear.app/lobehub/issue/
  for (const content of filteredContents) {
    if (content.role === 'model' && content.parts) {
      for (const part of content.parts) {
        if (part.functionCall && !part.thoughtSignature) {
          part.thoughtSignature = GEMINI_MAGIC_THOUGHT_SIGNATURE;
        }
      }
    }
  }

  return filteredContents;
};

/**
 * Recursively sanitize a JSON Schema to comply with Gemini proto constraints:
 * - `enum` is only allowed on STRING type fields
 * - `required` is only allowed on OBJECT type fields
 *
 * This handles the OpenAI→Gemini schema bridge where the upstream
 * schema may place `enum` on non-STRING types (e.g. number, boolean)
 * or `required` on non-OBJECT types.
 *
 * @see https://linear.app/lobehub/issue/
 */
export const sanitizeGeminiSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;

  const sanitized = { ...schema };

  // Determine if the schema type is (or includes) STRING / OBJECT.
  // Handles both `type: 'string'` and nullable `type: ['string', 'null']`.
  const isStringType = (t: unknown): boolean =>
    typeof t === 'string' ? t === 'string' : Array.isArray(t) && t.includes('string');
  const isObjectType = (t: unknown): boolean =>
    typeof t === 'string' ? t === 'object' : Array.isArray(t) && t.includes('object');

  // Strip enum from non-STRING types and empty enums
  // Gemini proto: "enum: only allowed for STRING type"
  if (
    sanitized.enum !== undefined &&
    (!isStringType(sanitized.type) || !Array.isArray(sanitized.enum) || sanitized.enum.length === 0)
  ) {
    console.warn(
      '[google] sanitizeGeminiSchema stripped enum — not allowed for non-STRING type or empty',
      { type: sanitized.type, enumLength: sanitized.enum?.length },
    );
    delete sanitized.enum;
  }

  // Strip required from non-OBJECT types and empty required arrays
  // Gemini proto: "required: only allowed for OBJECT type"
  if (
    sanitized.required !== undefined &&
    (!isObjectType(sanitized.type) ||
      !Array.isArray(sanitized.required) ||
      sanitized.required.length === 0)
  ) {
    console.warn(
      '[google] sanitizeGeminiSchema stripped required — not allowed for non-OBJECT type or empty',
      { type: sanitized.type, requiredLength: sanitized.required?.length },
    );
    delete sanitized.required;
  }

  // Recursively sanitize properties
  if (sanitized.properties && typeof sanitized.properties === 'object') {
    for (const key of Object.keys(sanitized.properties)) {
      sanitized.properties[key] = sanitizeGeminiSchema(sanitized.properties[key]);
    }
  }

  // Recursively sanitize items (for array types)
  if (sanitized.items) {
    sanitized.items = sanitizeGeminiSchema(sanitized.items);
  }

  // Recursively sanitize anyOf/oneOf/allOf combinators
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(sanitized[key])) {
      sanitized[key] = sanitized[key].map(sanitizeGeminiSchema);
    }
  }

  // Recursively sanitize definitions/$defs — when a tool schema stores
  // non-compliant constraints inside a referenced sub-schema the walker
  // must reach into the definitions map as well.
  for (const key of ['definitions', '$defs']) {
    if (sanitized[key] && typeof sanitized[key] === 'object') {
      for (const defKey of Object.keys(sanitized[key])) {
        sanitized[key][defKey] = sanitizeGeminiSchema(sanitized[key][defKey]);
      }
    }
  }

  return sanitized;
};

/**
 * Convert ChatCompletionTool to Google FunctionDeclaration.
 * Uses `parametersJsonSchema` to pass standard JSON Schema directly,
 * avoiding Google's restrictive Schema subset (no $ref, nullable, const, etc.).
 */
export const buildGoogleTool = (tool: ChatCompletionTool): FunctionDeclaration => {
  const functionDeclaration = tool.function;
  const parameters = functionDeclaration.parameters;

  // refs: https://github.com/lobehub/lobe-chat/pull/5002
  const hasProperties = parameters?.properties && Object.keys(parameters.properties).length > 0;

  const jsonSchema = hasProperties
    ? sanitizeGeminiSchema(parameters)
    : { type: 'object', properties: { dummy: { type: 'string' } } };

  return {
    description: functionDeclaration.description,
    name: functionDeclaration.name,
    parametersJsonSchema: jsonSchema,
  };
};

/**
 * Build Google function declarations from ChatCompletionTool array
 */
export const buildGoogleTools = (
  tools: ChatCompletionTool[] | undefined,
): GoogleFunctionCallTool[] | undefined => {
  if (!tools || tools.length === 0) return;

  // Deduplicate by function name to prevent Vertex AI 400 error:
  // "Duplicate function declaration found: xxx"
  const seenToolNames = new Set<string>();
  const uniqueTools = tools.filter((tool) => {
    const name = tool.function.name;
    if (seenToolNames.has(name)) return false;
    seenToolNames.add(name);
    return true;
  });

  return [
    {
      functionDeclarations: uniqueTools.map((tool) => buildGoogleTool(tool)),
    },
  ];
};
