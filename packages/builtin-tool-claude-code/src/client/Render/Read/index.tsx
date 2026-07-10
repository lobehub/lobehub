'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Image, PreviewGroup } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

interface ReadArgs {
  file_path?: string;
  limit?: number;
  offset?: number;
}

/**
 * A single uploaded image echoed by `Read` on an image file. The adapter
 * synthesizes these from CC's `image` tool_result block and the runtime
 * pipeline uploads them, so by the time the render runs each entry carries a
 * `url` (base64 `data` has been stripped) — see `HeterogeneousToolResultImage`.
 */
interface ReadResultImage {
  fileId?: string;
  mediaType?: string;
  url?: string;
}

interface ReadPluginState {
  images?: ReadResultImage[];
}

/**
 * Strip Claude Code's numbered-line prefix (e.g. `␣␣␣␣␣1\tfoo`) so the
 * Highlighter can tokenize the actual source. CC always returns this `cat -n`
 * style output; we keep the line numbers conceptually via Highlighter's own
 * gutter when available, and otherwise just display the raw source.
 */
const stripLineNumbers = (text: string): string => {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n');
};

const Read = memo<BuiltinRenderProps<ReadArgs, ReadPluginState>>(
  ({ args, content, pluginState }) => {
    const filePath = args?.file_path || '';
    const ext = filePath ? path.extname(filePath).slice(1).toLowerCase() : '';

    // `Read` on an image file yields uploaded thumbnails on `pluginState.images`
    // instead of source text. Prefer that echo over the `[Image: …]` content
    // placeholder the adapter leaves behind as a fallback.
    const images = useMemo(
      () => pluginState?.images?.filter((image) => !!image.url) ?? [],
      [pluginState?.images],
    );

    const source = useMemo(() => stripLineNumbers(content || ''), [content]);

    if (images.length > 0) {
      return (
        <PreviewGroup>
          <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
            {images.map((image, index) => (
              <Image
                alt={filePath || image.mediaType || ''}
                key={image.fileId || image.url || index}
                src={image.url}
                style={{ borderRadius: 8, maxHeight: 240, objectFit: 'contain' }}
              />
            ))}
          </Flexbox>
        </PreviewGroup>
      );
    }

    if (!source) return null;

    return (
      <Highlighter
        wrap
        language={ext || 'text'}
        showLanguage={false}
        style={{ maxHeight: 240, overflow: 'auto' }}
        variant={'borderless'}
      >
        {source}
      </Highlighter>
    );
  },
);

Read.displayName = 'ClaudeCodeRead';

export default Read;
