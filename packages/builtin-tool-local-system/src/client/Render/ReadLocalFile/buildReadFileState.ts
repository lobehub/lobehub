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

/**
 * 1-based number of the first line in the read content, used to seed the
 * preview's line-number gutter.
 *
 * Mirrors `ComputerRuntime`: a reported `loc` is a 0-based, end-exclusive
 * slice (see local-file-shell `readLocalFile`), so it wins; otherwise the
 * cloud sandbox's 1-based `startLine` arg lands in `pluginState.startLine`,
 * and OpenCode / Pi take a 1-based `offset` arg.
 */
export const getFirstLineNumber = ({
  args,
  pluginState,
}: Pick<BuildReadFileStateInput, 'args' | 'pluginState'>): number => {
  const loc = pluginState?.loc;
  if (loc) return Math.max(loc[0], 0) + 1;
  if (pluginState?.startLine !== undefined) return Math.max(pluginState.startLine, 1);
  if (args?.offset !== undefined) return Math.max(args.offset, 1);
  return 1;
};

/**
 * Drop only the file's final line terminator: it ends the last line rather
 * than starting a new one, while any blank lines before it are real content.
 */
export const stripFinalLineTerminator = (content: string): string => content.replace(/\r?\n$/, '');
