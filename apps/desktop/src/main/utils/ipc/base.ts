import { AsyncLocalStorage } from 'node:async_hooks';

import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { ipcMain } from 'electron';

// Base context for IPC methods
export interface IpcContext {
  event: IpcMainInvokeEvent;
  sender: WebContents;
}

// Metadata storage for decorated methods
const methodMetadata = new WeakMap<any, Map<string, string>>();
const ipcContextStorage = new AsyncLocalStorage<IpcContext>();

/**
 * Electron's IPC error serialization carries an Error's `message` / `stack` /
 * `name` plus its *enumerable* own properties. A standard `cause` (set via
 * `new Error(msg, { cause })`) is non-enumerable, so the real failure reason —
 * e.g. undici wrapping `ENOTFOUND` / `ECONNREFUSED` under a generic
 * `TypeError: fetch failed` — is dropped on the way to the renderer.
 *
 * Re-expose `cause` as an enumerable, plain (clone-safe) field so callers
 * receive it alongside `message`. A nested Error is flattened to
 * `{ name, message, code }` because it would otherwise lose its own
 * non-enumerable props through the same serialization.
 */
const exposeErrorCause = (error: unknown): unknown => {
  if (!(error instanceof Error) || error.cause === undefined || error.cause === null) {
    return error;
  }

  const { cause } = error;
  const serializableCause =
    cause instanceof Error
      ? { code: (cause as { code?: unknown }).code, message: cause.message, name: cause.name }
      : cause;

  Object.defineProperty(error, 'cause', {
    configurable: true,
    enumerable: true,
    value: serializableCause,
    writable: true,
  });

  return error;
};

// Decorator for IPC methods
export function IpcMethod() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const { constructor } = target;

    if (!methodMetadata.has(constructor)) {
      methodMetadata.set(constructor, new Map());
    }

    const methods = methodMetadata.get(constructor)!;
    methods.set(propertyKey, propertyKey);

    return descriptor;
  };
}

// Handler registry for IPC methods
export class IpcHandler {
  private static instance: IpcHandler;
  private registeredChannels = new Set<string>();

  static getInstance(): IpcHandler {
    if (!IpcHandler.instance) {
      IpcHandler.instance = new IpcHandler();
    }
    return IpcHandler.instance;
  }

  registerMethod<TArgs extends unknown[], TOutput>(
    channel: string,
    handler: (...args: TArgs) => Promise<TOutput> | TOutput,
  ) {
    if (this.registeredChannels.has(channel)) {
      return; // Already registered
    }

    this.registeredChannels.add(channel);

    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: any[]) => {
      const context: IpcContext = {
        event,
        sender: event.sender,
      };

      return ipcContextStorage.run(context, async () => {
        try {
          const typedArgs = args as TArgs;
          return await handler(...typedArgs);
        } catch (error) {
          console.error(`Error in IPC method ${channel}:`, error);
          throw exposeErrorCause(error);
        }
      });
    });
  }

  // Send events to renderer
  sendToRenderer<T = any>(webContents: WebContents, channel: string, data: T) {
    webContents.send(channel, data);
  }
}

// Base class for IPC service groups
export abstract class IpcService {
  protected handler = IpcHandler.getInstance();
  static readonly groupName: string;

  constructor() {
    this.registerMethods();
  }

  protected registerMethods(): void {
    const { constructor } = this;
    const methods = methodMetadata.get(constructor);

    if (methods) {
      methods.forEach((methodName, propertyKey) => {
        const method = (this as any)[propertyKey];
        if (typeof method === 'function') {
          this.registerMethod(methodName, method.bind(this));
        }
      });
    }
  }

  protected registerMethod<TArgs extends unknown[], TOutput>(
    methodName: string,
    handler: (...args: TArgs) => Promise<TOutput> | TOutput,
  ) {
    const groupName = (this.constructor as typeof IpcService).groupName;
    const channel = `${groupName}.${methodName}`;
    this.handler.registerMethod(channel, handler);
  }
}

// Service constructor with groupName
export interface IpcServiceConstructor {
  new (...args: any[]): IpcService;
  readonly groupName: string;
}

// Create services function that infers types from service constructors
export function createServices<T extends readonly IpcServiceConstructor[]>(
  serviceConstructors: T,
  ...constructorArgs: any[]
): CreateServicesResult<T> {
  const services = {} as any;

  for (const ServiceConstructor of serviceConstructors) {
    const instance = new ServiceConstructor(...constructorArgs);
    const groupName = ServiceConstructor.groupName;

    if (!groupName) {
      throw new Error(
        `Service ${ServiceConstructor.name} must define a static readonly groupName property`,
      );
    }

    services[groupName] = instance;
  }

  return services;
}

// Helper type for createServices return type
export type CreateServicesResult<T extends readonly IpcServiceConstructor[]> = {
  [K in T[number] as K['groupName']]: InstanceType<K>;
};

export function getIpcContext() {
  return ipcContextStorage.getStore();
}

export function runWithIpcContext<T>(context: IpcContext, callback: () => T): T {
  return ipcContextStorage.run(context, callback);
}
