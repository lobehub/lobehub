'use client';

import type { IEditor } from '@lobehub/editor';
import { useEffect, useRef } from 'react';

import { useStoreApi } from '../store';
import type { RealtimeDictationClient } from './client';
import type { RealtimeDictationStatus } from './contract';
import { attachHoldGesture, resolveHoldRelease } from './holdGesture';

interface UseHoldToDictateOptions {
  canStart: boolean;
  client?: RealtimeDictationClient;
  editor?: IEditor;
  enabled: boolean;
  prefetch: () => void;
  start: () => void;
  status: RealtimeDictationStatus;
}

/**
 * Press and hold inside the input to dictate, release to finish. Publishes
 * `dictationHold` so the placeholder can advertise the gesture while it is
 * usable and coach the user while a hold is in progress.
 */
export const useHoldToDictate = ({
  canStart,
  client,
  editor,
  enabled,
  prefetch,
  start,
  status,
}: UseHoldToDictateOptions) => {
  const storeApi = useStoreApi();
  const latest = useRef({ canStart, prefetch, start });
  latest.current = { canStart, prefetch, start };
  const stopWhenListeningRef = useRef(false);

  useEffect(() => {
    if (!stopWhenListeningRef.current) return;
    if (status === 'listening') {
      stopWhenListeningRef.current = false;
      void client?.stop();
    } else if (status !== 'connecting') {
      stopWhenListeningRef.current = false;
    }
  }, [client, status]);

  useEffect(() => {
    const lexicalEditor = editor?.getLexicalEditor();
    if (!enabled || !client || !lexicalEditor) {
      storeApi.setState({ dictationHold: undefined });
      return;
    }

    let detach: (() => void) | undefined;
    const unregisterRoot = lexicalEditor.registerRootListener((root) => {
      detach?.();
      detach = undefined;
      if (!root) {
        storeApi.setState({ dictationHold: undefined });
        return;
      }

      storeApi.setState({ dictationHold: 'ready' });
      detach = attachHoldGesture(root, {
        canStart: () => {
          const { status } = client.getSnapshot();
          return (
            latest.current.canStart &&
            lexicalEditor.isEditable() &&
            (status === 'idle' || status === 'error')
          );
        },
        onHoldEnd: () => {
          storeApi.setState({ dictationHold: 'ready' });
          const action = resolveHoldRelease(client.getSnapshot().status);
          if (action === 'stop') void client.stop();
          else if (action === 'cancel') void client.cancel();
          else if (action === 'stopWhenListening') stopWhenListeningRef.current = true;
        },
        onPress: () => latest.current.prefetch(),
        onHoldStart: () => {
          stopWhenListeningRef.current = false;
          storeApi.setState({ dictationHold: 'holding' });
          latest.current.start();
        },
      });
    });

    return () => {
      unregisterRoot();
      detach?.();
      storeApi.setState({ dictationHold: undefined });
    };
  }, [client, editor, enabled, storeApi]);
};
