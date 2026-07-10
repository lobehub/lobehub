// cspell:ignore tokenx
import { filesPrompts } from '@lobechat/prompts';
import type {
  ChatAudioItem,
  ChatFileItem,
  ChatImageItem,
  ChatVideoItem,
  UIChatMessage,
  UploadFileItem,
} from '@lobechat/types';
import { getMimeType } from '@lobechat/utils/mimeType';
import { estimateTokenCount } from 'tokenx';

const ESTIMATE_INPUT_MESSAGE_ID = '__cost_estimate_input__';
const VISUAL_INPUT_TOKEN_ESTIMATE = 1000;
// Per-attachment flat estimate for audio media parts. Audio token usage scales
// with duration (Gemini bills ~32 tokens/sec), but duration isn't available at
// preflight, so we mirror the visual flat-per-item heuristic as a lower bound.
const AUDIO_INPUT_TOKEN_ESTIMATE = 1000;
const BYTES_PER_TEXT_TOKEN_ESTIMATE = 4;
const TEXT_UPLOAD_MIME_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-typescript',
  'application/x-yaml',
  'application/xml',
]);
const TEXT_UPLOAD_EXTENSION_OVERRIDES = new Set(['.cs', '.jsonl', '.ts', '.tsx']);

export interface InputTokenBuckets {
  audioTokens: number;
  imageTokens: number;
  textTokens: number;
  videoTokens: number;
}

interface AttachmentTokenOptions {
  canUseAudio: boolean;
  canUseVideo: boolean;
  canUseVision: boolean;
}

export const EMPTY_TOKEN_BUCKETS: InputTokenBuckets = {
  audioTokens: 0,
  imageTokens: 0,
  textTokens: 0,
  videoTokens: 0,
};

const countPromptTextTokens = (content: string) => {
  if (!content) return 0;

  return estimateTokenCount(content);
};

const countFileContextTokens = ({
  audioList,
  fileList,
  imageList,
  messageId,
  videoList,
}: {
  audioList?: ChatAudioItem[];
  fileList?: ChatFileItem[];
  imageList?: ChatImageItem[];
  messageId: string;
  videoList?: ChatVideoItem[];
}) => {
  const prompt = filesPrompts({
    addUrl: false,
    audioList,
    fileList,
    imageList,
    messageId,
    videoList,
  });

  return countPromptTextTokens(prompt);
};

export const estimateSentMessageAttachmentTokenBuckets = (
  messages: UIChatMessage[],
  { canUseAudio, canUseVideo, canUseVision }: AttachmentTokenOptions,
): InputTokenBuckets => {
  let textTokens = 0;
  let imageTokens = 0;
  let videoTokens = 0;
  let audioTokens = 0;

  for (const message of messages) {
    if (message.role !== 'user') continue;

    const fileList = message.fileList ?? [];
    const imageList = message.imageList ?? [];
    const videoList = message.videoList ?? [];
    const audioList = message.audioList ?? [];

    if (
      fileList.length === 0 &&
      imageList.length === 0 &&
      videoList.length === 0 &&
      audioList.length === 0
    )
      continue;

    textTokens += countFileContextTokens({
      audioList,
      fileList,
      imageList,
      messageId: message.id,
      videoList,
    });

    if (canUseVision) {
      imageTokens += imageList.length * VISUAL_INPUT_TOKEN_ESTIMATE;
    }

    if (canUseVideo) {
      videoTokens += videoList.length * VISUAL_INPUT_TOKEN_ESTIMATE;
    }

    if (canUseAudio) {
      audioTokens += audioList.length * AUDIO_INPUT_TOKEN_ESTIMATE;
    }
  }

  return {
    audioTokens,
    imageTokens,
    textTokens,
    videoTokens,
  };
};

const getUploadFileUrl = (item: UploadFileItem) =>
  item.fileUrl || item.base64Url || item.previewUrl || '';

const isTextLikeMimeType = (type: string) =>
  type.startsWith('text/') || TEXT_UPLOAD_MIME_TYPES.has(type);

const getFileExtension = (name: string) => {
  const dotIndex = name.lastIndexOf('.');

  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
};

export const isTextLikeUploadFile = (item: UploadFileItem) => {
  const declaredType = item.file.type.toLowerCase();
  const inferredType = getMimeType(item.file.name).toLowerCase();
  const name = item.file.name.toLowerCase();

  return (
    isTextLikeMimeType(declaredType) ||
    isTextLikeMimeType(inferredType) ||
    TEXT_UPLOAD_EXTENSION_OVERRIDES.has(getFileExtension(name))
  );
};

const estimateTextFileTokensBySize = (size: number) =>
  Math.ceil(size / BYTES_PER_TEXT_TOKEN_ESTIMATE);

export const estimatePendingUploadTokenBuckets = (
  files: UploadFileItem[],
  { canUseAudio, canUseVideo, canUseVision }: AttachmentTokenOptions,
  textFileContents: Record<string, string>,
): InputTokenBuckets => {
  if (files.length === 0) return EMPTY_TOKEN_BUCKETS;

  const fileList: ChatFileItem[] = [];
  const imageList: ChatImageItem[] = [];
  const videoList: ChatVideoItem[] = [];
  const audioList: ChatAudioItem[] = [];
  let pendingTextFallbackTokens = 0;

  for (const item of files) {
    const type = item.file.type || '';
    const url = getUploadFileUrl(item);

    if (type.startsWith('image')) {
      imageList.push({
        alt: item.file.name || item.id,
        id: item.id,
        url,
      });
      continue;
    }

    if (type.startsWith('video')) {
      videoList.push({
        alt: item.file.name || item.id,
        id: item.id,
        url,
      });
      continue;
    }

    if (type.startsWith('audio')) {
      audioList.push({
        alt: item.file.name || item.id,
        id: item.id,
        url,
      });
      continue;
    }

    const textContent = textFileContents[item.id];
    if (isTextLikeUploadFile(item) && textContent === undefined) {
      pendingTextFallbackTokens += estimateTextFileTokensBySize(item.file.size || 0);
    }

    fileList.push({
      content: textContent,
      fileType: type,
      id: item.id,
      name: item.file.name || item.id,
      size: item.file.size || 0,
      url,
    });
  }

  return {
    audioTokens: canUseAudio ? audioList.length * AUDIO_INPUT_TOKEN_ESTIMATE : 0,
    imageTokens: canUseVision ? imageList.length * VISUAL_INPUT_TOKEN_ESTIMATE : 0,
    textTokens:
      countFileContextTokens({
        audioList,
        fileList,
        imageList,
        messageId: ESTIMATE_INPUT_MESSAGE_ID,
        videoList,
      }) + pendingTextFallbackTokens,
    videoTokens: canUseVideo ? videoList.length * VISUAL_INPUT_TOKEN_ESTIMATE : 0,
  };
};

export const addTokenBuckets = (...buckets: InputTokenBuckets[]): InputTokenBuckets =>
  buckets.reduce<InputTokenBuckets>(
    (sum, bucket) => ({
      audioTokens: sum.audioTokens + bucket.audioTokens,
      imageTokens: sum.imageTokens + bucket.imageTokens,
      textTokens: sum.textTokens + bucket.textTokens,
      videoTokens: sum.videoTokens + bucket.videoTokens,
    }),
    EMPTY_TOKEN_BUCKETS,
  );
