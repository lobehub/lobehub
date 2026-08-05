'use client';

import type { BuiltinRender, BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter, Image, PreviewGroup, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Globe } from 'lucide-react';
import { memo } from 'react';

import {
  BROWSER_MCP_TOOL_NAMES,
  type BrowserMcpApi,
  isBrowserMcpApiName,
  parseBrowserMcpApi,
} from '../Inspector/browserMcpLabels';

const styles = createStaticStyles(({ css, cssVar }) => ({
  row: css`
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
}));

/**
 * A screenshot echoed back by the in-app browser. The MCP handler returns the
 * capture as an image block, the CC adapter lifts it onto `pluginState.images`,
 * and the runtime pipeline uploads it — so by render time `data` (base64) is
 * gone and only the uploaded reference remains. Same lifecycle as `Read` on an
 * image file; see `HeterogeneousToolResultImage`.
 */
interface BrowserMcpImage {
  fileId?: string;
  mediaType?: string;
  url?: string;
}

interface BrowserMcpPluginState {
  images?: BrowserMcpImage[];
}

type BrowserMcpRenderProps = BuiltinRenderProps<unknown, BrowserMcpPluginState, string>;

const uploadedImages = (pluginState?: BrowserMcpPluginState): BrowserMcpImage[] =>
  pluginState?.images?.filter((image) => !!image.url) ?? [];

/**
 * navigate / click / fill / press / scroll all resolve to a one-line outcome the
 * executor already phrased for the model ("Opened https://… — \"Title\""), so
 * the card just presents that line instead of restating the arguments the
 * inspector chip already shows.
 */
const PageRow = memo<{ content?: string }>(({ content }) => {
  if (!content) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.row} gap={6}>
      <Globe size={14} />
      <Text ellipsis>{content}</Text>
    </Flexbox>
  );
});

PageRow.displayName = 'ClaudeCodeBrowserPageRow';

const PageAction = memo<BrowserMcpRenderProps>(({ content }) => <PageRow content={content} />);

PageAction.displayName = 'ClaudeCodeBrowserPageAction';

/**
 * Screenshot: show the captured page inline. This is the whole point of the
 * call — the agent looked at the page, and the user should see exactly what it
 * saw without unfolding anything (`displayControls` expands this card once the
 * image lands).
 *
 * When the upload failed the adapter leaves an `[Image: …]` placeholder in the
 * content, so fall back to the text rather than rendering an empty card.
 */
const Screenshot = memo<BrowserMcpRenderProps>(({ content, pluginState }) => {
  const images = uploadedImages(pluginState);

  if (images.length === 0) return content ? <PageRow content={content} /> : null;

  return (
    <PreviewGroup>
      <Flexbox gap={8}>
        {images.map((image, index) => (
          <Block
            key={image.fileId || image.url || index}
            // The border frames the capture, so it has to sit on the image's edge:
            // any padding reads as a mat around the screenshot rather than a frame.
            // `display: flex` also kills the inline-image baseline gap, which would
            // otherwise leave a sliver of background under the picture.
            style={{ alignSelf: 'flex-start', display: 'flex', overflow: 'hidden', padding: 0 }}
            variant={'outlined'}
          >
            {/* A full-page capture of the sidebar browser is tall (e.g. 720×1620), so
                bound the height and let the user click through to the preview for the
                full view — same treatment as an image `Read`. Never stretch to the card
                width either: upscaling a narrow capture just makes it blurry. */}
            <Image
              alt={'Browser screenshot'}
              maxHeight={600}
              src={image.url}
              style={{ maxWidth: '100%' }}
            />
          </Block>
        ))}
      </Flexbox>
    </PreviewGroup>
  );
});

Screenshot.displayName = 'ClaudeCodeBrowserScreenshot';

/**
 * snapshot / readPage return a page dump (a11y tree or article text). Keep it
 * scrollable and collapsed by default — it's context for the model, not
 * something the user reads top to bottom.
 */
const PageDump = memo<BrowserMcpRenderProps>(({ content }) => {
  if (!content) return null;

  return (
    <Highlighter
      wrap
      language={'text'}
      showLanguage={false}
      style={{ maxHeight: 240, overflow: 'auto' }}
      variant={'borderless'}
    >
      {content}
    </Highlighter>
  );
});

PageDump.displayName = 'ClaudeCodeBrowserPageDump';

const RENDER_BY_API: Record<BrowserMcpApi, BuiltinRender> = {
  click: PageAction as BuiltinRender,
  fill: PageAction as BuiltinRender,
  navigate: PageAction as BuiltinRender,
  press: PageAction as BuiltinRender,
  readPage: PageDump as BuiltinRender,
  screenshot: Screenshot as BuiltinRender,
  scroll: PageAction as BuiltinRender,
  snapshot: PageDump as BuiltinRender,
};

const renderFor = (apiName: string): BuiltinRender | undefined => {
  const api = parseBrowserMcpApi(apiName);
  return api ? RENDER_BY_API[api] : undefined;
};

const FixedBrowserMcpRenders: Record<string, BuiltinRender> = Object.fromEntries(
  BROWSER_MCP_TOOL_NAMES.map((tool) => [tool, renderFor(tool)!]),
);

export const BrowserMcpRenders: Record<string, BuiltinRender> = new Proxy(FixedBrowserMcpRenders, {
  get: (target, prop) => {
    if (typeof prop !== 'string') return undefined;
    return target[prop] || (isBrowserMcpApiName(prop) ? renderFor(prop) : undefined);
  },
});
