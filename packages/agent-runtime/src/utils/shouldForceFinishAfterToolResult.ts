import type { ChatToolPayload } from '@lobechat/types';

const MEDIA_KIND_RE = /image|video/i;
const TERMINAL_MEDIA_NAME_RE =
  /(?:edit|generate|create|variation|upscale|stylize|transform|render|draw|paint|convert|txt2img|img2img).*(?:image|video)|(?:image|video).*(?:edit|generate|create|variation|upscale|stylize|transform|render|draw|paint|convert|txt2img|img2img)/i;
const MEDIA_DATA_URL_RE = /^data:(?:image|video)\//i;
const HTTP_URL_RE = /^https?:\/\//i;
const MEDIA_OUTPUT_KEYS = [
  'asset',
  'assets',
  'data',
  'image',
  'imageUrl',
  'image_url',
  'images',
  'output',
  'result',
  'results',
  'thumbnailUrl',
  'thumbnail_url',
  'url',
  'urls',
  'video',
  'videoUrl',
  'video_url',
] as const;

const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const hasTerminalMediaOutput = (value: unknown, depth = 0): boolean => {
  if (value == null || depth > 4) return false;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (MEDIA_DATA_URL_RE.test(trimmed) || HTTP_URL_RE.test(trimmed)) return true;

    const parsed = tryParseJson(trimmed);
    return parsed ? hasTerminalMediaOutput(parsed, depth + 1) : false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasTerminalMediaOutput(item, depth + 1));
  }

  if (typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind : undefined;

  if (kind && MEDIA_KIND_RE.test(kind)) {
    for (const key of MEDIA_OUTPUT_KEYS) {
      if (hasTerminalMediaOutput(record[key], depth + 1)) return true;
    }
  }

  for (const key of MEDIA_OUTPUT_KEYS) {
    if (hasTerminalMediaOutput(record[key], depth + 1)) return true;
  }

  return false;
};

const isTerminalMediaToolName = (toolCall?: ChatToolPayload) => {
  if (!toolCall) return false;

  return TERMINAL_MEDIA_NAME_RE.test(
    [toolCall.identifier, toolCall.apiName].filter(Boolean).join(' '),
  );
};

export const shouldForceFinishAfterToolResult = ({
  isSuccess,
  result,
  toolCall,
}: {
  isSuccess: boolean;
  result: unknown;
  toolCall?: ChatToolPayload;
}) => {
  if (!isSuccess || !toolCall) return false;
  if (!isTerminalMediaToolName(toolCall)) return false;

  return hasTerminalMediaOutput(result);
};
