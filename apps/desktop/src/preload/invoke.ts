import { ipcRenderer } from 'electron';

type IpcInvoke = <T = unknown>(event: string, ...data: unknown[]) => Promise<T>;

/**
 * Client-side method to invoke electron main process
 */
export const invoke: IpcInvoke = async (event, ...data) => ipcRenderer.invoke(event, ...data);
