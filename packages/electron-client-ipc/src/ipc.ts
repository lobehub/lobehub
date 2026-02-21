import type { StreamInvokeRequestParams } from './types';

type IpcInvoke = <T = unknown>(event: string, ...data: unknown[]) => Promise<T>;

interface StreamerCallbacks {
  onData: (chunk: Uint8Array) => void;
  onEnd: () => void;
  onError: (error: Error) => void;
  onResponse: (response: {
    headers: Record<string, string>;
    status: number;
    statusText: string;
  }) => void;
}

export interface DesktopIpcServicesMap {}
export type DesktopIpcServices = DesktopIpcServicesMap;
export type ElectronDesktopIpc = DesktopIpcServices | null;

const createInvokeProxy = <IpcServices>(invoke: IpcInvoke): IpcServices =>
  new Proxy(
    {},
    {
      get(_target, groupKey) {
        if (typeof groupKey !== 'string') return undefined;

        return new Proxy(
          {},
          {
            get(_methodTarget, methodKey) {
              if (typeof methodKey !== 'string') return undefined;

              const channel = `${groupKey}.${methodKey}`;
              return (payload?: unknown) =>
                payload === undefined ? invoke(channel) : invoke(channel, payload);
            },
          },
        );
      },
    },
  ) as IpcServices;

let cachedProxy: DesktopIpcServices | null = null;

declare global {
  interface Window {
    electronAPI?: {
      invoke?: IpcInvoke;
      onStreamInvoke: (
        params: StreamInvokeRequestParams,
        callbacks: StreamerCallbacks,
      ) => () => void;
    };
  }
}

export const getElectronIpc = (): DesktopIpcServices | null => {
  if (typeof window === 'undefined') return null;
  if (cachedProxy) return cachedProxy;

  const invoke = window.electronAPI?.invoke;
  if (!invoke) return null;

  cachedProxy = createInvokeProxy<DesktopIpcServices>(invoke);
  return cachedProxy;
};
