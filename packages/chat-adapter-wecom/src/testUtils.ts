import type { WeComSocket } from './connection';
import type { WeComFrame } from './types';

type Listener = (event: any) => void;

/**
 * In-memory stand-in for `wss://openws.work.weixin.qq.com`: records what the client sends and
 * lets a test push server frames. `autoAck` answers subscribe / ping / reply frames the way the
 * real server does (a cmd-less frame echoing the req_id), unless a test overrides it.
 */
export class FakeWeComServerSocket implements WeComSocket {
  readyState = 0;
  readonly sent: WeComFrame[] = [];
  /** Return `undefined` to send no receipt; default answers errcode 0. */
  ackFor: (frame: WeComFrame) => Partial<WeComFrame> | undefined = () => ({
    errcode: 0,
    errmsg: 'ok',
  });

  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as WeComFrame;
    this.sent.push(frame);
    const ack = this.ackFor(frame);
    if (ack) queueMicrotask(() => this.serverSend({ headers: frame.headers, ...ack }));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  /** Server → client frame. */
  serverSend(frame: WeComFrame): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  sentWith(cmd: string): WeComFrame[] {
    return this.sent.filter((frame) => frame.cmd === cmd);
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export const flush = async (times = 5): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
