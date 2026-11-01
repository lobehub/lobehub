'use client';

import type { IEditor } from '@lobehub/editor';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { BrowserAudioWorkletCapture, requestDictationMicrophone } from './audio';
import { RealtimeDictationClient } from './client';
import { LexicalDictationEditor } from './editor';
import { createRealtimeAsrSession } from './service';

const createSocket = (url: string) => new WebSocket(url);
const FALLBACK_SNAPSHOT = { retryable: false, status: 'idle' as const };
const getFallbackSnapshot = () => FALLBACK_SNAPSHOT;
const subscribeFallback = () => () => undefined;

export const useRealtimeDictation = (editor?: IEditor) => {
  const client = useMemo(
    () =>
      editor
        ? new RealtimeDictationClient({
            createCapture: BrowserAudioWorkletCapture.create,
            createSession: createRealtimeAsrSession,
            createWebSocket: createSocket,
            editor: new LexicalDictationEditor(editor),
            requestMicrophone: requestDictationMicrophone,
          })
        : undefined,
    [editor],
  );

  const snapshot = useSyncExternalStore(
    client?.subscribe ?? subscribeFallback,
    client?.getSnapshot ?? getFallbackSnapshot,
    client?.getSnapshot ?? getFallbackSnapshot,
  );

  useEffect(
    () => () => {
      void client?.dispose();
    },
    [client],
  );

  return { client, ...snapshot };
};
