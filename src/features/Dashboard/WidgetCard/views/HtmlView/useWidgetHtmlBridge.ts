import type { WidgetOutput } from '@lobechat/types';
import { type RefObject, useEffect, useRef } from 'react';

import { isOpenableWidgetUrl, isWidgetHtmlFrameMessage, WIDGET_HTML_HOST_SOURCE } from './document';

/**
 * Keep a widget HTML frame fed: post the output and theme whenever either
 * changes, and again when the frame reports ready (a new document after the
 * HTML changed, or the first load). Opens the web links the frame asks for.
 */
export const useWidgetHtmlBridge = (
  frameRef: RefObject<HTMLIFrameElement | null>,
  output: WidgetOutput,
  appearance: 'dark' | 'light',
) => {
  // Read by the message listener, which outlives renders.
  const latest = useRef({ output, theme: { appearance } });

  const post = () =>
    frameRef.current?.contentWindow?.postMessage(
      { source: WIDGET_HTML_HOST_SOURCE, type: 'update', ...latest.current },
      '*',
    );

  useEffect(() => {
    latest.current = { output, theme: { appearance } };
    post();
  }, [output, appearance]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isWidgetHtmlFrameMessage(event.data)
      ) {
        return;
      }
      const message = event.data;
      if (message.type === 'ready') post();
      if (message.type === 'open' && isOpenableWidgetUrl(message.url)) {
        window.open(message.url, '_blank', 'noopener,noreferrer');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
};
