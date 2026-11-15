import type {
  LocalAsrJobProgressPayload,
  LocalAsrRealtimeEvent,
} from '@lobechat/electron-client-ipc';
import { type UtilityProcess, utilityProcess } from 'electron';

import { createLogger } from '@/utils/logger';

import type { EngineRequest, EngineToHostMessage } from './protocol';

const logger = createLogger('modules:localAsr:EngineHost');

type RequestMethod = EngineRequest['method'];
type RequestParams<M extends RequestMethod> = Extract<EngineRequest, { method: M }>['params'];

interface EngineHostOptions {
  entry: string;
  onEvent: (event: LocalAsrRealtimeEvent) => void;
  onProgress: (payload: LocalAsrJobProgressPayload) => void;
  runtimePath: string;
}

/**
 * Runs the sherpa-onnx engine in an Electron utility process so decoding never
 * blocks the main process, and a native crash only takes down the engine.
 */
export class LocalAsrEngineHost {
  private child?: UtilityProcess;
  private fatalError?: string;
  private nextId = 1;
  private readonly liveSessions = new Set<string>();
  private readonly pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: any) => void }
  >();

  constructor(private readonly options: EngineHostOptions) {}

  get pid() {
    return this.child?.pid;
  }

  request<M extends RequestMethod>(method: M, params: RequestParams<M>): Promise<any> {
    const child = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      child.postMessage({ id, method, params, type: 'request' });
    });
  }

  trackSession(sessionId: string) {
    this.liveSessions.add(sessionId);
  }

  untrackSession(sessionId: string) {
    this.liveSessions.delete(sessionId);
  }

  sendAudio(sessionId: string, frame: Uint8Array) {
    this.child?.postMessage({ frame, sessionId, type: 'audio' });
  }

  dispose() {
    this.child?.kill();
    this.child = undefined;
  }

  private ensure() {
    if (this.child) return this.child;

    this.fatalError = undefined;
    const child = utilityProcess.fork(this.options.entry, [], {
      env: { ...process.env, LOBE_LOCAL_ASR_RUNTIME: this.options.runtimePath },
      serviceName: 'LobeHub Local ASR',
      stdio: 'pipe',
    });
    child.stdout?.on('data', (chunk) => logger.debug(String(chunk).trim()));
    child.stderr?.on('data', (chunk) => logger.warn(String(chunk).trim()));
    child.on('message', (message: EngineToHostMessage) => this.handleMessage(message));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      const reason = this.fatalError ?? `engine_exited:${code}`;
      logger.warn(`local ASR engine exited (${reason})`);
      for (const { reject } of this.pending.values()) reject(new Error(reason));
      this.pending.clear();
      for (const sessionId of this.liveSessions) {
        this.options.onEvent({
          code: this.fatalError?.startsWith('runtime_unavailable')
            ? 'RUNTIME_UNAVAILABLE'
            : 'ENGINE_CRASHED',
          message: reason,
          retryable: true,
          sequence: 0,
          sessionId,
          type: 'session.error',
        });
      }
      this.liveSessions.clear();
    });
    this.child = child;
    return child;
  }

  /** Text only: audio never reaches the log. */
  private logEvent(event: LocalAsrRealtimeEvent) {
    switch (event.type) {
      case 'session.ready': {
        logger.info(
          `session ${event.sessionId} ready: ${event.engine} (load ${Math.round(event.loadMs)} ms, pid ${this.pid})`,
        );
        return;
      }
      case 'transcript.final': {
        logger.info(
          `session ${event.sessionId} ${event.segmentId} [${event.startMs}-${event.endMs} ms] ${event.text.slice(0, 40)}`,
        );
        return;
      }
      case 'session.completed': {
        logger.info(`session ${event.sessionId} completed: ${JSON.stringify(event.stats)}`);
        return;
      }
      case 'session.error': {
        logger.warn(`session ${event.sessionId} error: ${event.code} ${event.message ?? ''}`);
      }
    }
  }

  private handleMessage(message: EngineToHostMessage) {
    switch (message.type) {
      case 'response': {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error));
        else entry.resolve(message.result);
        return;
      }
      case 'event': {
        if (message.event.type === 'session.completed' || message.event.type === 'session.error') {
          this.liveSessions.delete(message.event.sessionId);
        }
        this.logEvent(message.event);
        this.options.onEvent(message.event);
        return;
      }
      case 'progress': {
        this.options.onProgress(message.payload);
        return;
      }
      case 'fatal': {
        this.fatalError = message.error;
        logger.error(`local ASR engine fatal: ${message.error}`);
      }
    }
  }
}
