import debug from 'debug';

import { deviceService } from '@/services/device';

import { type TerminalSessionSink, xtermManager } from './xtermManager';

const log = debug('lobe-desktop:chat-terminal');

/**
 * How long an idle terminal waits before asking its device for new output.
 *
 * The device RPC surface is request/response, so output arrives by polling
 * rather than pushed over a socket. 300ms is a deliberate middle: fast enough
 * that typing feels live (a `sudo` password prompt is indistinguishable from a
 * local one), slow enough that an idle panel is not a request flood.
 * Full-screen interactive programs are out of scope for this transport.
 */
export const TERMINAL_POLL_INTERVAL_MS = 300;

/**
 * Longest a failed read waits before the next attempt.
 *
 * A device that dropped off the network comes back on its own, so a read that
 * failed for a transport reason is retried rather than ending the session — but
 * a disconnected panel must not keep asking at poll speed. Consecutive failures
 * double the delay up to this ceiling.
 */
export const TERMINAL_RETRY_MAX_MS = 5000;

/** Device RPC payloads carry bytes as base64; PTY output is not always valid UTF-8. */
const encodeBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const decodeBase64 = (base64: string): string => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

interface DeviceTerminalInfo {
  cwd: string;
  id: string;
  pid: number;
  shell: string;
}

/**
 * One interactive shell on a remote device, driven over the device RPC surface.
 *
 * The PTY itself lives in the device's `lh connect` process; this object owns
 * only the polling cursor and the sink that routes keystrokes back. Because the
 * shell is a real PTY, `sudo` sees a controlling terminal and prompts for its
 * password exactly as it would locally — the password never leaves the device
 * and nothing about it is stored anywhere.
 */
export class DeviceTerminalSession {
  private cursor = 0;
  private disposed = false;
  private exited = false;
  /** Consecutive failed reads, which is what widens the retry delay. */
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * Keystrokes waiting to be sent.
   *
   * Each `writeTerminal` is a separate request, and two of them in flight can
   * arrive out of order — which scrambles fast input (a paste, or a test
   * typing at machine speed) even though it looks fine at typing speed. So
   * input is appended here and flushed strictly one request at a time, which
   * also coalesces a burst of keystrokes into a single call.
   */
  private pendingInput = '';
  private sendingInput = false;

  private constructor(
    readonly deviceId: string,
    readonly info: DeviceTerminalInfo,
  ) {}

  /**
   * Open a shell on `deviceId` and start draining it. Throws when the device
   * refuses (offline, or a client without PTY support) so the panel can show
   * why instead of waiting on a session that will never appear.
   */
  static async open(
    deviceId: string,
    params: { cols: number; cwd?: string; rows: number },
  ): Promise<DeviceTerminalSession> {
    const info = (await deviceService.createTerminalSession({
      ...params,
      deviceId,
    })) as DeviceTerminalInfo;
    const session = new DeviceTerminalSession(deviceId, info);
    // Registered before the first poll so input typed during the initial read
    // is not dropped.
    xtermManager.setSessionSink(info.id, session.sink);
    void session.poll();
    return session;
  }

  get sessionId() {
    return this.info.id;
  }

  /** How this session's keystrokes and resizes reach the device. */
  readonly sink: TerminalSessionSink = {
    close: () => {
      void this.dispose();
    },
    resize: (sessionId, cols, rows) => {
      void deviceService
        .resizeTerminal({ cols, deviceId: this.deviceId, id: sessionId, rows })
        .catch((error) => log('resizeTerminal %s failed: %O', sessionId, error));
    },
    write: (sessionId, data) => {
      this.queueInput(sessionId, data);
    },
  };

  private queueInput(sessionId: string, data: string) {
    this.pendingInput += data;
    if (this.sendingInput || this.disposed) return;
    this.sendingInput = true;
    void this.flushInput(sessionId);
  }

  private async flushInput(sessionId: string) {
    try {
      while (this.pendingInput) {
        const batch = this.pendingInput;
        this.pendingInput = '';
        await deviceService.writeTerminal({
          data: encodeBase64(batch),
          deviceId: this.deviceId,
          id: sessionId,
        });
      }
    } catch (error) {
      // The batch is dropped rather than retried: a persistent failure here
      // would otherwise spin. Output keeps flowing, so the terminal stays
      // usable and the failure is visible in the log.
      log('writeTerminal %s failed: %O', sessionId, error);
    } finally {
      this.sendingInput = false;
    }
  }

  /** Stop polling and end the shell on the device. Safe to call twice. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    try {
      await deviceService.closeTerminal({ deviceId: this.deviceId, id: this.info.id });
    } catch (error) {
      log('closeTerminal %s failed: %O', this.info.id, error);
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.exited) return;

    try {
      // Drain until the device has nothing left rather than returning one chunk
      // per interval, so a burst (a build log) is not paced by the poll.
      for (;;) {
        const result = await deviceService.readTerminal({
          cursor: this.cursor,
          deviceId: this.deviceId,
          id: this.info.id,
        });

        this.cursor = result.nextCursor;
        if (result.chunk) {
          xtermManager.write(this.info.id, decodeBase64(result.chunk));
        }

        if (result.exited) {
          this.exited = true;
          // The session is gone device-side; the exit code only tells the store
          // to close the pane.
          xtermManager.notifyExit(this.info.id, result.exitCode ?? 0);
          return;
        }

        if (!result.chunk) break;
      }
      this.failures = 0;
    } catch (error) {
      // A single failed read is usually a dropped request, not a dead shell, so
      // keep polling — but on a widening delay: a device that is off the network
      // cannot be read from, and asking every 300ms would turn a disconnected
      // panel into a request flood. A device that outlived its session does not
      // land here at all: it answers such a read with `exited`.
      this.failures += 1;
      log('readTerminal %s failed (%d in a row): %O', this.info.id, this.failures, error);
    }

    if (this.disposed || this.exited) return;
    const delay = this.failures
      ? Math.min(TERMINAL_POLL_INTERVAL_MS * 2 ** this.failures, TERMINAL_RETRY_MAX_MS)
      : TERMINAL_POLL_INTERVAL_MS;
    this.timer = setTimeout(() => void this.poll(), delay);
  }
}
