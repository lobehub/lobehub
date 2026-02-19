# @lobechat/electron-client-ipc

這個包是 LobeChat 在 Electron 環境中用於處理 IPC（製程間通訊）的客戶端工具包。

## 介紹

在 Electron 應用程式中，IPC（製程間通訊）是連接主製程（Main Process）、渲染製程（Renderer Process）以及 NextJS 製程的橋樑。為了更好地組織和管理這些通訊，我們將 IPC 相關的程式碼分成了兩個包：

- `@lobechat/electron-client-ipc`：**客戶端 IPC 包**
- `@lobechat/electron-server-ipc`：**伺服端 IPC 包**

## 主要區別

### electron-client-ipc（本包）

- 執行環境：在渲染製程（Renderer Process）中執行
- 主要職責：
  - 提供渲染製程調用主製程方法的接口定義
  - 封裝 `ipcRenderer.invoke` 相關方法
  - 處理與主製程的通訊請求

### electron-server-ipc

- 執行環境：在 Electron 主製程和 Next.js 伺服端製程中執行
- 主要職責：
  - 提供基於 Socket 的 IPC 通訊機制
  - 實現伺服端（ElectronIPCServer）和客戶端（ElectronIpcClient）通訊組件
  - 處理跨製程的請求和回應
  - 提供自動重連和錯誤處理機制
  - 確保類型安全的 API 調用

## 使用場景

當渲染製程需要：

- 存取系統 API
- 進行檔案操作
- 調用主製程特定功能

時，都需要通過 `electron-client-ipc` 包提供的方法來發起請求。

## 技術說明

這種分包設計遵循了關注點分離原則，使得：

- IPC 通訊接口清晰可維護
- 客戶端和伺服端程式碼解耦
- TypeScript 類型定義共享，確保類型安全

## 🤝 參與貢獻

不同用例和平臺的 IPC 通訊需求各異。我們歡迎社群貢獻來改進和擴充功能 IPC 功能。您可以通過以下方式參與改進：

### 如何貢獻

1. **錯誤報告**：報告 IPC 通訊或類型定義的問題
2. **功能請求**：建議新的 IPC 方法或改進現有接口
3. **程式碼貢獻**：提交錯誤修復或新功能的拉取請求

### 貢獻流程

1. Fork [LobeChat 倉庫](https://github.com/lobehub/lobe-chat)
2. 對 IPC 客戶端包進行修改
3. 提交 Pull Request 並描述：

- 解決的問題
- 實現細節
- 測試用例或使用示例
- 對現有功能的影響

## 📌 說明

這是 LobeHub 的內部模組（`"private": true`），專為 LobeChat 設計，不作為獨立包發佈。
