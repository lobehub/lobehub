import type net from 'node:net';

export type IPCEventMethod = (
  params: any,
  context: { id: string; method: string; socket: net.Socket },
) => Promise<any>;

export type ElectronIPCEventHandler = Record<string, IPCEventMethod>;

export * from './file';
