import type {
  DocumentChannel,
  GatewayMuxClient,
  GatewayMuxStatus,
  MuxDocServerMessage,
} from '@lobechat/agent-gateway-client';
import * as Y from 'yjs';

type Listener = (...args: any[]) => void;
type UserState = Record<string, unknown>;

export type PageCollabAccess = 'edit' | 'view';

export type PageCollabStatus = 'connecting' | 'offline' | 'synced';

export interface PageCollabProviderEvents {
  onAccess?: (access: PageCollabAccess) => void;
  onBootstrap?: () => void;
  onPendingChange?: (pending: number) => void;
  onReset?: () => void;
  onStatus?: (status: PageCollabStatus) => void;
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

class Emitter {
  private listeners = new Map<string, Set<Listener>>();

  emit(type: string, ...args: unknown[]) {
    this.listeners.get(type)?.forEach((cb) => cb(...args));
  }

  off(type: string, cb: Listener) {
    this.listeners.get(type)?.delete(cb);
  }

  on(type: string, cb: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
}

class PageCollabAwareness extends Emitter {
  private localState: UserState | null = null;
  private states = new Map<number, UserState>();

  constructor(
    private readonly clientID: number,
    private readonly publish: (state: UserState | null) => void,
  ) {
    super();
  }

  getLocalState() {
    return this.localState;
  }

  getStates() {
    const states = new Map(this.states);
    if (this.localState) states.set(this.clientID, this.localState);
    return states;
  }

  setLocalState(state: UserState | null) {
    this.localState = state;
    this.publish(state);
    this.emit('update');
  }

  setLocalStateField(field: string, value: unknown) {
    this.setLocalState({ ...this.localState, [field]: value });
  }

  setRemoteState(clientID: number, state: UserState | null) {
    if (clientID === this.clientID) return;
    if (state) this.states.set(clientID, state);
    else this.states.delete(clientID);
    this.emit('update');
  }

  clearRemote() {
    this.states.clear();
    this.emit('update');
  }
}

export class PageCollabProvider extends Emitter {
  readonly awareness: PageCollabAwareness;

  private channel: DocumentChannel | null = null;
  private epoch: string | undefined;
  private seq = 0;
  private readonly pending = new Set<number>();
  private waitingForBootstrap = false;
  private bootstrapPending = false;
  private synced = false;

  constructor(
    private readonly documentId: string,
    private readonly doc: Y.Doc,
    private readonly mux: GatewayMuxClient,
    private readonly events: PageCollabProviderEvents = {},
  ) {
    super();
    this.awareness = new PageCollabAwareness(doc.clientID, (state) =>
      this.channel?.send({ clientID: doc.clientID, documentId, state, type: 'doc_awareness' }),
    );
    doc.on('update', this.handleLocalUpdate);
  }

  get pendingCount() {
    return this.pending.size;
  }

  // The binding may subscribe after the room already answered (the editor
  // mounts later than the provider connects), so late `sync` listeners replay it.
  on(type: string, cb: Listener) {
    super.on(type, cb);
    if (type === 'sync' && this.synced) queueMicrotask(() => cb(true));
  }

  connect() {
    if (this.channel) return;
    this.emit('status', { status: 'connecting' });
    this.events.onStatus?.('connecting');
    this.channel = this.mux.openDocument(this.documentId, {
      onMessage: this.handleMessage,
      onReady: this.subscribe,
      onStatus: this.handleStatus,
    });
  }

  disconnect() {
    if (!this.channel) return;
    this.awareness.setLocalState(null);
    this.channel.close();
    this.channel = null;
    this.awareness.clearRemote();
    this.emit('status', { status: 'disconnected' });
  }

  destroy() {
    this.disconnect();
    this.doc.off('update', this.handleLocalUpdate);
  }

  private subscribe = () => {
    this.synced = false;
    this.channel?.send({
      documentId: this.documentId,
      ...(this.epoch ? { epoch: this.epoch } : {}),
      stateVector: toBase64(Y.encodeStateVector(this.doc)),
      type: 'doc_subscribe',
    });
  };

  private handleStatus = (status: GatewayMuxStatus) => {
    if (status !== 'connected') {
      this.synced = false;
      this.emit('status', { status: status === 'connecting' ? 'reconnecting' : status });
      this.events.onStatus?.('offline');
    }
  };

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const seq = ++this.seq;
    this.pending.add(seq);
    this.events.onPendingChange?.(this.pending.size);
    this.channel?.send({
      documentId: this.documentId,
      seq,
      type: 'doc_update',
      update: toBase64(update),
    });
  };

  private markSynced() {
    if (this.synced) return;
    this.synced = true;
    this.waitingForBootstrap = false;
    this.emit('status', { status: 'connected' });
    this.emit('sync', true);
    this.events.onStatus?.('synced');
  }

  // Someone else (e.g. the server agent) may fill the room while we hold the
  // claim; their content arriving first means our bootstrap would duplicate it.
  private scheduleBootstrap() {
    this.bootstrapPending = true;
    queueMicrotask(() => {
      if (!this.bootstrapPending) return;
      this.bootstrapPending = false;
      this.events.onBootstrap?.();
    });
  }

  private resendPending() {
    if (this.pending.size === 0) return;
    this.pending.clear();
    const update = Y.encodeStateAsUpdate(this.doc);
    this.handleLocalUpdate(update, null);
  }

  private handleMessage = (message: MuxDocServerMessage) => {
    switch (message.type) {
      case 'doc_synced': {
        if (message.reset && this.epoch && this.epoch !== message.epoch) {
          this.events.onReset?.();
          return;
        }
        this.epoch = message.epoch;
        this.events.onAccess?.(message.access);
        Y.applyUpdate(this.doc, fromBase64(message.update), this);
        for (const entry of message.awareness ?? []) {
          this.awareness.setRemoteState(entry.clientID, entry.state);
        }
        if (this.awareness.getLocalState()) {
          this.awareness.setLocalState(this.awareness.getLocalState());
        }
        this.resendPending();
        if (message.bootstrap || message.bootstrapped) {
          this.markSynced();
          if (message.bootstrap) this.scheduleBootstrap();
        } else {
          this.waitingForBootstrap = true;
        }
        return;
      }

      case 'doc_update': {
        this.bootstrapPending = false;
        Y.applyUpdate(this.doc, fromBase64(message.update), this);
        if (this.waitingForBootstrap) this.markSynced();
        return;
      }

      case 'doc_ack': {
        if (this.pending.delete(message.seq)) this.events.onPendingChange?.(this.pending.size);
        return;
      }

      case 'doc_awareness': {
        this.awareness.setRemoteState(message.clientID, message.state);
        return;
      }

      case 'doc_error': {
        if (message.code === 'read_only' || message.code === 'forbidden') {
          this.events.onAccess?.('view');
        }
        console.warn('[PageCollabProvider]', message.code, message.message);
      }
    }
  };
}
