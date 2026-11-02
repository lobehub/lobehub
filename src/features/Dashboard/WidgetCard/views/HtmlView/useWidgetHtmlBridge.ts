import type { WidgetOutput } from '@lobechat/types';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { isOpenableWidgetUrl, isWidgetHtmlFrameMessage, WIDGET_HTML_HOST_SOURCE } from './document';

/**
 * Keep a widget HTML frame fed. The frame loads the fixed wrapper; once it
 * reports `wrapper-ready` it gets the content document (`contentDocument`,
 * again whenever that changes), and once the content reports `ready` it gets
 * the output and theme, again whenever either changes. Opens the web links
 * the content asks for.
 *
 * If the content frame tries to leave its document, the wrapper drops it and
 * the frame is `blocked`: nothing is posted to it any more.
 */
export const useWidgetHtmlBridge = (
  frameRef: RefObject<HTMLIFrameElement | null>,
  contentDocument: string,
  output: WidgetOutput,
  appearance: 'dark' | 'light',
) => {
  const [blocked, setBlocked] = useState(false);
  // Read by the message listener, which outlives renders.
  const latest = useRef({ contentDocument, output, theme: { appearance } });
  const isBlocked = useRef(false);

  const send = (message: Record<string, unknown>) => {
    if (isBlocked.current) return;
    frameRef.current?.contentWindow?.postMessage(
      { source: WIDGET_HTML_HOST_SOURCE, ...message },
      '*',
    );
  };
  const postDocument = () => send({ html: latest.current.contentDocument, type: 'document' });
  const postUpdate = () =>
    send({ output: latest.current.output, theme: latest.current.theme, type: 'update' });

  useEffect(() => {
    latest.current = { ...latest.current, output, theme: { appearance } };
    postUpdate();
  }, [output, appearance]);

  // Skip the first run: the wrapper asks for the document when it is ready.
  const mounted = useRef(false);
  useEffect(() => {
    latest.current = { ...latest.current, contentDocument };
    if (mounted.current) postDocument();
    mounted.current = true;
  }, [contentDocument]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isWidgetHtmlFrameMessage(event.data)
      ) {
        return;
      }
      const message = event.data;
      switch (message.type) {
        case 'wrapper-ready': {
          postDocument();
          break;
        }
        case 'ready': {
          postUpdate();
          break;
        }
        case 'open': {
          if (isOpenableWidgetUrl(message.url)) {
            window.open(message.url, '_blank', 'noopener,noreferrer');
          }
          break;
        }
        case 'navigated': {
          isBlocked.current = true;
          setBlocked(true);
          break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return { blocked };
};
