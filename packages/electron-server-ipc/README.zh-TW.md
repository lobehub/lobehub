# @lobechat/electron-server-ipc

LobeHub 的 Electron 應用程式與伺服端之間的 IPC（製程間通訊）模組，提供可靠的跨製程通訊能力。

## 📝 簡介

`@lobechat/electron-server-ipc` 是 LobeHub 桌面應用程式的核心組件，負責處理 Electron 主製程與 nextjs 伺服端之間的通訊。它提供了一套簡單而健壯的 API，用於在不同製程間傳遞資料和執行遠端方法調用。

## 🛠️ 核心功能

- **可靠的 IPC 通訊**: 基於 Socket 的通訊機制，確保跨製程通訊的穩定性和可靠性
- **自動重連機制**: 客戶端具備斷線重連功能，提高應用程式穩定性
- **類型安全**: 使用 TypeScript 提供完整的類型定義，確保 API 調用的類型安全
- **跨平臺支援**: 同時支援 Windows、macOS 和 Linux 平臺

## 🧩 核心組件

### IPC 伺服端 (ElectronIPCServer)

負責監聽客戶端請求並回應，通常執行在 Electron 的主製程中：

```typescript
import { ElectronIPCEventHandler, ElectronIPCServer } from '@lobechat/electron-server-ipc';

// 定義處理函數
const eventHandler: ElectronIPCEventHandler = {
  getDatabasePath: async () => {
    return '/path/to/database';
  },
  // 其他處理函數...
};

// 建立並啟動伺服器
const server = new ElectronIPCServer(eventHandler);
server.start();
```

### IPC 客戶端 (ElectronIpcClient)

負責連接到伺服端併發送請求，通常在伺服端（如 Next.js 服務）中使用：

```typescript
import { ElectronIPCMethods, ElectronIpcClient } from '@lobechat/electron-server-ipc';

// 建立客戶端
const client = new ElectronIpcClient();

// 發送請求
const dbPath = await client.sendRequest(ElectronIPCMethods.getDatabasePath);
```

## 🤝 參與貢獻

IPC 伺服端實現需要處理各種通訊場景和邊緣情況。我們歡迎社群貢獻來增強可靠性和功能性。您可以通過以下方式參與改進：

### 如何貢獻

1. **性能優化**：提高 IPC 通訊速度和可靠性
2. **錯誤處理**：增強錯誤恢復和重連機制
3. **新功能**：新增新的 IPC 方法或通訊模式支援
4. **文件改進**：改進程式碼文件和使用示例

### 貢獻流程

1. Fork [LobeChat 倉庫](https://github.com/lobehub/lobe-chat)
2. 對 IPC 伺服端包實施改進
3. 提交 Pull Request 並描述：

- 性能改進或新功能
- 測試方法和結果
- 相容性考慮
- 使用示例

## 📌 說明

這是 LobeHub 的內部模組 (`"private": true`)，專為 LobeHub 桌面應用程式設計，不作為獨立包發佈。
