import OpenAI from 'openai';

import { videoUrlToBase64 } from '@/utils/videoToBase64';

import { parseDataUri } from '../../utils/uriParser';

interface SiliconCloudChatCompletionContentPartVideo {
  type: 'video_url';
  video_url: {
    url: string;
  };
}

type SiliconCloudChatCompletionContentPart =
  | OpenAI.ChatCompletionContentPart
  | SiliconCloudChatCompletionContentPartVideo;

export const convertSiliconCloudMessageContent = async (
  content: SiliconCloudChatCompletionContentPart,
) => {
  if (content.type === 'video_url') {
    const { type } = parseDataUri(content.video_url.url);

    if (type === 'url' && process.env.LLM_VISION_VIDEO_USE_BASE64 === '1') {
      try {
        const { base64, mimeType } = await videoUrlToBase64(content.video_url.url);

        return {
          ...content,
          video_url: { ...content.video_url, url: `data:${mimeType};base64,${base64}` },
        };
      } catch (error) {
        console.warn('Failed to convert video to base64:', error);
        // Return original content if conversion fails
        return content;
      }
    }
  }

  return content;
};

export const transformSiliconCloudMessages = async (
  messages: OpenAI.ChatCompletionMessageParam[],
): Promise<OpenAI.ChatCompletionMessageParam[]> => {
  return (await Promise.all(
    messages.map(async (message) => ({
      ...message,
      content:
        typeof message.content === 'string'
          ? message.content
          : await Promise.all(
              (message.content || []).map((c) => {
                return convertSiliconCloudMessageContent(
                  c as SiliconCloudChatCompletionContentPart,
                );
              }),
            ),
    })),
  )) as OpenAI.ChatCompletionMessageParam[];
};
