/**
 * Entry of the local ASR utility process. It has no network code: audio frames
 * arrive over Electron's parentPort and only text/timing leaves it.
 */
import { createRequire } from 'node:module';

import { LocalAsrEngine, type SherpaRuntime } from '../engine';
import type { EngineToHostMessage, HostToEngineMessage } from '../protocol';

const parentPort = (process as any).parentPort as {
  on: (event: 'message', listener: (event: { data: HostToEngineMessage }) => void) => void;
  postMessage: (message: EngineToHostMessage) => void;
};

const post = (message: EngineToHostMessage) => parentPort.postMessage(message);

let runtime: SherpaRuntime;
try {
  // The host resolves the package (OTA cores resolve native deps from the shell) and passes the path.
  const runtimePath = process.env.LOBE_LOCAL_ASR_RUNTIME || 'sherpa-onnx-node';
  runtime = createRequire(__filename)(runtimePath) as SherpaRuntime;
} catch (error) {
  post({ error: `runtime_unavailable:${(error as Error).message}`, type: 'fatal' });
  process.exit(1);
}

const engine = new LocalAsrEngine({
  emitEvent: (event) => post({ event, type: 'event' }),
  emitProgress: (payload) => post({ payload, type: 'progress' }),
  peakRssMb: () => Math.round(process.resourceUsage().maxRSS / 1024),
  runtime: runtime!,
});

const handle = async (message: Extract<HostToEngineMessage, { type: 'request' }>) => {
  switch (message.method) {
    case 'ping': {
      return { pid: process.pid };
    }
    case 'startSession': {
      return engine.startSession(message.params);
    }
    case 'stopSession': {
      return engine.stopSession(message.params.sessionId);
    }
    case 'cancelSession': {
      return engine.cancelSession(message.params.sessionId);
    }
    case 'transcribeFile': {
      return engine.transcribeFile(message.params);
    }
  }
};

parentPort.on('message', ({ data }) => {
  if (data.type === 'audio') {
    try {
      engine.pushAudio(data.sessionId, data.frame);
    } catch (error) {
      post({
        event: {
          code: 'INTERNAL_ERROR',
          message: (error as Error).message,
          retryable: false,
          sequence: 0,
          sessionId: data.sessionId,
          type: 'session.error',
        },
        type: 'event',
      });
    }
    return;
  }

  handle(data).then(
    (result) => post({ id: data.id, result, type: 'response' }),
    (error: Error) =>
      post({ error: error?.message ?? String(error), id: data.id, type: 'response' }),
  );
});
