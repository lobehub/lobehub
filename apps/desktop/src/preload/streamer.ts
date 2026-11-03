import type { StreamInvokeRequestParams } from '@lobechat/electron-client-ipc';
import { ipcRenderer } from 'electron';
import { v4 as uuid } from 'uuid';

interface StreamResponse {
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export interface StreamerCallbacks {
  onData: (chunk: Uint8Array) => void;
  onEnd: () => void;
  onError: (error: Error) => void;
  onResponse: (response: StreamResponse) => void;
}

/**
 * Calls the main process method and handles the stream response via callbacks.
 * @param params The request parameters.
 * @param callbacks The callbacks to handle stream events.
 */
export const onStreamInvoke = (
  params: StreamInvokeRequestParams,
  callbacks: StreamerCallbacks,
): (() => void) => {
  const requestId = uuid();

  const cleanup = () => {
    ipcRenderer.removeAllListeners(`stream:data:${requestId}`);
    ipcRenderer.removeAllListeners(`stream:end:${requestId}`);
    ipcRenderer.removeAllListeners(`stream:error:${requestId}`);
    ipcRenderer.removeAllListeners(`stream:response:${requestId}`);
  };

  ipcRenderer.on(`stream:data:${requestId}`, (_, chunk: Buffer) => {
    callbacks.onData(new Uint8Array(chunk));
  });

  ipcRenderer.once(`stream:end:${requestId}`, () => {
    callbacks.onEnd();
    cleanup();
  });

  ipcRenderer.once(`stream:error:${requestId}`, (_, error: Error) => {
    callbacks.onError(error);
    cleanup();
  });

  ipcRenderer.once(`stream:response:${requestId}`, (_, response: StreamResponse) => {
    callbacks.onResponse(response);
  });

  ipcRenderer.send('stream:start', { ...params, requestId });

  // Return a cleanup function to be called on cancellation
  return cleanup;
};
