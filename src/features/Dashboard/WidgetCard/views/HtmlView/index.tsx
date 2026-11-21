'use client';

import type { WidgetOutput } from '@lobechat/types';
import { ActionIcon, Center, Text, useThemeMode } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { createWidgetHtmlDocument, WIDGET_HTML_WRAPPER_DOCUMENT } from './document';
import { useElementFullscreen } from './useElementFullscreen';
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
  },
  // The browser paints a full-screen element's backdrop black; keep the app's page color.
  fullscreen: {
    backgroundColor: cssVar.colorBgLayout,
    borderRadius: 0,
    borderWidth: 0,
    height: '100%',
  },
  hidden: {
    display: 'none',
  },
  root: {
    height: '100%',
    position: 'relative',
    width: '100%',
  },
  // Always visible: the pointer is usually over the frame, and a parent's :hover
  // does not reliably match while it is inside a sandboxed iframe.
  toggle: {
    backgroundColor: cssVar.colorBgElevated,
    boxShadow: cssVar.boxShadowTertiary,
    insetBlockStart: 8,
    insetInlineEnd: 8,
    opacity: {
      ':focus-visible': 1,
      ':hover': 1,
      'default': 0.72,
    },
    position: 'absolute',
    zIndex: 1,
  },
  toggleShown: {
    opacity: 1,
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

/**
 * A widget output drawn by its version's own HTML, in a sandboxed frame. The
 * view can go full screen in place: the same frame grows, so it keeps its
 * state and live updates, and Esc brings it back.
 */
const HtmlView = memo<HtmlViewProps>(({ html, output, framed }) => {
  const { t } = useTranslation('dashboard');
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { isDarkMode } = useThemeMode();
  const contentDocument = useMemo(() => createWidgetHtmlDocument(html), [html]);
  const { blocked } = useWidgetHtmlBridge(
    frameRef,
    contentDocument,
    output,
    isDarkMode ? 'dark' : 'light',
  );
  const fullscreen = useElementFullscreen(containerRef);
  const toggleLabel = t(
    fullscreen.isFullscreen ? 'widget.fullscreen.exit' : 'widget.fullscreen.enter',
  );

  return (
    <div
      data-widget-html-root
      data-widget-html-fullscreen={fullscreen.isFullscreen || undefined}
      ref={containerRef}
      {...stylex.props(
        styles.root,
        framed && styles.framed,
        fullscreen.isFullscreen && styles.fullscreen,
      )}
    >
      <iframe
        data-widget-html
        className={stylex.props(styles.frame, blocked && styles.hidden).className}
        ref={frameRef}
        sandbox={'allow-scripts'}
        srcDoc={WIDGET_HTML_WRAPPER_DOCUMENT}
        style={FRAME_STYLE}
        title={'widget'}
      />
      {blocked && (
        <Center data-widget-html-blocked height={'100%'} padding={12}>
          <Text fontSize={12} type={'secondary'}>
            {t('widget.html.blocked')}
          </Text>
        </Center>
      )}
      {fullscreen.supported && !blocked && (
        <ActionIcon
          data-widget-html-fullscreen-toggle
          aria-label={toggleLabel}
          icon={fullscreen.isFullscreen ? Minimize2Icon : Maximize2Icon}
          size={'small'}
          className={
            stylex.props(styles.toggle, fullscreen.isFullscreen && styles.toggleShown).className
          }
          title={toggleLabel}
          // The card around the view opens the drill-down on click.
          onClick={(event) => {
            event.stopPropagation();
            void fullscreen.toggle();
          }}
        />
      )}
    </div>
  );
});

HtmlView.displayName = 'DashboardWidgetHtmlView';

export default HtmlView;
