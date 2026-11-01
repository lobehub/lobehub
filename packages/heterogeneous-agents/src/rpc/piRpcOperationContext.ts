import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PiExtensionUiRequest, PiRpcCommand, PiRpcResponse } from './piRpcProtocol';

const CONTEXT_TIMEOUT_MS = 5000;

export class PiOperationContextUnavailableError extends Error {}

/** A private extension command, never a model message or a replacement bash tool. */
export class PiRpcOperationContext {
  readonly commandName = `lobe-operation-${randomUUID()}`;
  private readonly directory = path.join(tmpdir(), this.commandName);
  readonly path = path.join(this.directory, 'operation.mjs');
  private preparation?: Promise<void>;
  private sequence = 0;
  private closed = false;
  private pending?: { acknowledgment: string; reject: (error: Error) => void; resolve: () => void };

  prepare(): Promise<void> {
    this.preparation ??= this.writeExtension();
    return this.preparation;
  }

  private async writeExtension(): Promise<void> {
    if (this.closed) throw new Error('Pi operation context is closed');
    await mkdir(this.directory, { mode: 0o700 });
    // Keep this source self-contained: Electron bundles this module, while Pi
    // loads the generated extension in its own process with its own env.
    await writeFile(
      this.path,
      `export default function(pi) {
  const command = ${JSON.stringify(this.commandName)};
  let sequence = 0;
  let active = false;
  pi.registerCommand(command, {
    description: 'LobeHub internal operation context',
    handler: async (args, ctx) => {
      const input = JSON.parse(args);
      if (!ctx.isIdle() || !Number.isSafeInteger(input.sequence)) throw new Error('Pi is not idle');
      if (input.action === 'set') {
        if (active || input.sequence !== sequence + 1) throw new Error('Stale operation context');
        if (input.value !== null && typeof input.value !== 'string') throw new Error('Invalid operation ID');
        if (input.value === null) delete process.env.LOBEHUB_OPERATION_ID;
        else process.env.LOBEHUB_OPERATION_ID = input.value;
        sequence = input.sequence;
        active = true;
      } else if (input.action === 'clear') {
        if (!active || input.sequence !== sequence) throw new Error('Stale operation cleanup');
        delete process.env.LOBEHUB_OPERATION_ID;
        active = false;
      } else throw new Error('Invalid context action');
      ctx.ui.setStatus(command, JSON.stringify({ action: input.action, sequence }));
    },
  });
}
`,
      { mode: 0o600 },
    );
  }

  async update(
    action: 'set' | 'clear',
    value: string | null,
    send: (command: PiRpcCommand, timeout: number) => Promise<PiRpcResponse>,
  ): Promise<void> {
    if (this.closed) throw new Error('Pi operation context is closed');
    if (this.pending) throw new Error('Pi operation context update already pending');
    if (action === 'set') this.sequence += 1;
    const sequence = this.sequence;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const acknowledgment = new Promise<void>((resolve, reject) => {
      this.pending = { acknowledgment: JSON.stringify({ action, sequence }), reject, resolve };
      timer = setTimeout(
        () => reject(new Error('Pi operation context acknowledgment timed out')),
        CONTEXT_TIMEOUT_MS,
      );
    });
    try {
      // Register the waiter BEFORE writing: Pi can emit the status before its
      // ordinary prompt response, which alone does not prove handler success.
      await Promise.all([
        acknowledgment,
        send(
          {
            type: 'prompt',
            message: `/${this.commandName} ${JSON.stringify({ action, sequence, value })}`,
          },
          CONTEXT_TIMEOUT_MS,
        ),
      ]);
    } finally {
      clearTimeout(timer);
      this.pending = undefined;
    }
  }

  consume(request: PiExtensionUiRequest): boolean {
    if (request.method !== 'setStatus' || request.statusKey !== this.commandName) return false;
    if (request.statusText === this.pending?.acknowledgment) this.pending?.resolve();
    return true;
  }

  cancel(error: Error): void {
    this.closed = true;
    this.pending?.reject(error);
  }

  async dispose(): Promise<void> {
    this.cancel(new Error('Pi operation context is closed'));
    // Startup can be cancelled during the async file write. Wait for it before
    // deleting so a late write cannot recreate a leaked extension directory.
    await this.preparation?.catch(() => {
      // The startup caller reports the original preparation failure.
    });
    await rm(this.directory, { force: true, recursive: true });
  }
}
