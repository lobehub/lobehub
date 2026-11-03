export const SOCK_FILE = (id: string) => `${id}-electron-ipc.sock`;

export const SOCK_INFO_FILE = (id: string) => `${id}-electron-ipc-info.json`;

export const WINDOW_PIPE_FILE = (id: string) => `\\\\.\\pipe\\${id}-electron-ipc`;
