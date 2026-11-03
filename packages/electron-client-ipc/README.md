# @lobechat/electron-client-ipc

This package is a client-side toolkit for handling IPC (Inter-Process Communication) in LobeHub's Electron environment.

## Introduction

In Electron applications, IPC (Inter-Process Communication) serves as a bridge connecting the Main Process, Renderer Process, and NextJS Process. To better organize and manage these communications, we have split the IPC-related code into two packages:

- `@lobechat/electron-client-ipc`: **Client-side IPC package**
- `@lobechat/electron-server-ipc`: **Server-side IPC package**

## Key Differences

### electron-client-ipc (This Package)

- Runtime Environment: Runs in the Renderer Process
- Main Responsibilities:
  - Provides interface definitions for renderer process to call main process methods
  - Encapsulates `ipcRenderer.invoke` related methods
  - Handles communication requests with the main process

### electron-server-ipc

- Runtime Environment: Runs in both Electron main process and Next.js server process
- Main Responsibilities:
  - Provides Socket-based IPC communication mechanism
  - Implements server-side (ElectronIPCServer) and client-side (ElectronIpcClient) communication components
  - Handles cross-process requests and responses
  - Provides automatic reconnection and error handling mechanisms
  - Ensures type-safe API calls

## Use Cases

When the renderer process needs to:

- Access system APIs
- Perform file operations
- Call main process specific functions

All such operations need to be initiated through the methods provided by the `electron-client-ipc` package.

## Technical Notes

This separated package design follows the principle of separation of concerns, ensuring that:

- IPC communication interfaces are clear and maintainable
- Client-side and server-side code are decoupled
- TypeScript type definitions are shared, ensuring type safety

## 🤝 Contribution

IPC communication needs vary across different use cases and platforms. We welcome community contributions to improve and extend the IPC functionality. You can participate in improvements through:

### How to Contribute

1. **Bug Reports**: Report issues with IPC communication or type definitions
2. **Feature Requests**: Suggest new IPC methods or improvements to existing interfaces
3. **Code Contributions**: Submit pull requests for bug fixes or new features

### Contribution Process

1. Fork the [LobeHub repository](https://github.com/lobehub/lobe-chat)
2. Make your changes to the IPC client package
3. Submit a Pull Request describing:

- The problem being solved
- Implementation details
- Test cases or usage examples
- Impact on existing functionality

## 📌 Note

This is an internal module of LobeHub (`"private": true`), designed specifically for LobeHub and not published as a standalone package.
