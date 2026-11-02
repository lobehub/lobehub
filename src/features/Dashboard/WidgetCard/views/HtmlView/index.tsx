'use client';

import type { WidgetOutput } from '@lobechat/types';
import { useThemeMode } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo, useRef } from 'react';

import { createWidgetHtmlDocument } from './document';
import { useWidgetHtmlBridge } from './useWidgetHtmlBridge';

const styles = stylex.create({
  frame: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    display: 'block',
    height: '100%',
    width: '100%',
  },
  framed: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    height: 360,
    overflow: 'hidden',
    width: '100%',
  },
});

// An iframe whose color scheme differs from its embedder's is painted opaque;
// the document inside keeps the default `normal`.
const FRAME_STYLE = { colorScheme: 'normal' } as const;

interface HtmlViewProps {
  /** Draw in its own bordered frame, for hosts without a widget card around it. */
  framed?: boolean;
  html: string;
  output: WidgetOutput;
}

/** A widget output drawn by its version's own HTML, in a sandboxed frame. */
const HtmlView = memo<HtmlViewProps>(({ html, output, framed }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const { isDarkMode } = useThemeMode();
  const srcDoc = useMemo(() => createWidgetHtmlDocument(html), [html]);
  useWidgetHtmlBridge(ref, output, isDarkMode ? 'dark' : 'light');

  const frame = (
    <iframe
      data-widget-html
      className={stylex.props(styles.frame).className}
      ref={ref}
      sandbox={'allow-scripts'}
      srcDoc={srcDoc}
      style={FRAME_STYLE}
      title={'widget'}
    />
  );
  if (!framed) return frame;

  return <div {...stylex.props(styles.framed)}>{frame}</div>;
});

HtmlView.displayName = 'DashboardWidgetHtmlView';

export default HtmlView;
