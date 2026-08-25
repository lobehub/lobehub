import type { ReadFileState } from '@lobechat/tool-runtime';
import path from 'path-browserify-esm';

export interface ReadFileArgs {
  file_path?: string;
  filePath?: string;
  limit?: number;
  offset?: number;
  path?: string;
}

interface BuildReadFileStateInput {
  args?: ReadFileArgs;
  identifier?: string;
  parsedContent: { content: string; hasEnvelope?: boolean; path?: string };
  pluginError?: unknown;
  pluginState?: Partial<ReadFileState>;
}

export const buildReadFileState = ({
  args,
  identifier,
  parsedContent,
  pluginError,
  pluginState,
}: BuildReadFileStateInput): ReadFileState | undefined => {
  if (pluginError) return;

  const filePath =
    args?.path ||
    args?.filePath ||
    args?.file_path ||
    pluginState?.path ||
    parsedContent.path ||
    '';
  if (!filePath) return;

  const canUseContentFallback = identifier === 'opencode' || identifier === 'pi';
  const text = pluginState?.content ?? (canUseContentFallback ? parsedContent.content : '');
  const images = pluginState?.images;
  // An empty file is still a successful read: keep the card when the builtin
  // tool reported a state, or when the OpenCode envelope confirms completion.
  const isConfirmedRead = !!pluginState || parsedContent.hasEnvelope === true;
  if (!isConfirmedRead && !text && !images?.length) return;

  const startLine = args?.offset ?? pluginState?.startLine ?? pluginState?.loc?.[0];
  const endLine =
    pluginState?.endLine ??
    pluginState?.loc?.[1] ??
    (startLine !== undefined && args?.limit !== undefined
      ? startLine + Math.max(args.limit - 1, 0)
      : undefined);

  return {
    ...pluginState,
    charCount: pluginState?.charCount ?? text.length,
    content: text,
    fileType: pluginState?.fileType ?? path.extname(filePath).slice(1).toLowerCase(),
    loc:
      pluginState?.loc ??
      (startLine !== undefined && endLine !== undefined ? [startLine, endLine] : undefined),
    path: filePath,
  };
};
