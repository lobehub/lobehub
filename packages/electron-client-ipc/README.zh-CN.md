# @lobechat/electron-client-ipc

这个包是 LobeHub 在 Electron 环境中用于处理 IPC（进程间通信）的客户端工具包。

## 介绍

在 Electron 应用中，IPC（进程间通信）是连接主进程（Main Process）、渲染进程（Renderer Process）以及 NextJS 进程的桥梁。为了更好地组织和管理这些通信，我们将 IPC 相关的代码分成了两个包：

- `@lobechat/electron-client-ipc`：**客户端 IPC 包**
- `@lobechat/electron-server-ipc`：**服务端 IPC 包**

## 主要区别

### electron-client-ipc（本包）

- 运行环境：在渲染进程（Renderer Process）中运行
- 主要职责：
  - 提供渲染进程调用主进程方法的接口定义
  - 封装 `ipcRenderer.invoke` 相关方法
  - 处理与主进程的通信请求

### electron-server-ipc

- 运行环境：在 Electron 主进程和 Next.js 服务端进程中运行
- 主要职责：
  - 提供基于 Socket 的 IPC 通信机制
  - 实现服务端（ElectronIPCServer）和客户端（ElectronIpcClient）通信组件
  - 处理跨进程的请求和响应
  - 提供自动重连和错误处理机制
  - 确保类型安全的 API 调用

## 使用场景

当渲染进程需要：

- 访问系统 API
- 进行文件操作
- 调用主进程特定功能

时，都需要通过 `electron-client-ipc` 包提供的方法来发起请求。

## 技术说明

这种分包设计遵循了关注点分离原则，使得：

- IPC 通信接口清晰可维护
- 客户端和服务端代码解耦
- TypeScript 类型定义共享，确保类型安全

## 🤝 参与贡献

不同用例和平台的 IPC 通信需求各异。我们欢迎社区贡献来改进和扩展 IPC 功能。您可以通过以下方式参与改进：

### 如何贡献

1. **错误报告**：报告 IPC 通信或类型定义的问题
2. **功能请求**：建议新的 IPC 方法或改进现有接口
3. **代码贡献**：提交错误修复或新功能的拉取请求

### 贡献流程

1. Fork [LobeHub 仓库](https://github.com/lobehub/lobe-chat)
2. 对 IPC 客户端包进行修改
3. 提交 Pull Request 并描述：

- 解决的问题
- 实现细节
- 测试用例或使用示例
- 对现有功能的影响

## 📌 说明

这是 LobeHub 的内部模块（`"private": true`），专为 LobeHub 设计，不作为独立包发布。
