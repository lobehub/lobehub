## 核心框架组件目录架构

### 主进程核心组件

```
apps/desktop/src/main/
├── core/                     // 核心功能
│   ├── App.ts                // 应用核心类，整合所有管理器
│   ├── Browser.ts            // 浏览器窗口类
│   ├── BrowserManager.ts     // 浏览器窗口管理
│   ├── I18nManager.ts        // 国际化管理
│   ├── IoCContainer.ts       // 依赖注入容器
│   ├── MenuManager.ts        // 菜单管理核心类，负责选择和协调平台实现
│   ├── ShortcutManager.ts    // 快捷键管理
│   ├── StoreManager.ts       // 存储管理
│   └── UpdaterManager.ts     // 更新管理
├── controllers/              // 控制器层，处理渲染进程调用
│   ├── AuthCtr.ts            // 认证控制器
│   ├── BrowserWindowsCtr.ts  // 浏览器窗口控制器
│   ├── DevtoolsCtr.ts        // 开发工具控制器
│   ├── LocalFileCtr.ts       // 本地文件控制器
│   ├── MenuCtr.ts            // 菜单控制器
│   ├── RemoteServerConfigCtr.ts // 远程服务器配置控制器
│   ├── RemoteServerSyncCtr.ts   // 远程服务器同步控制器
│   ├── ShortcutCtr.ts        // 快捷键控制器
│   ├── SystemCtr.ts          // 系统控制器
│   ├── UpdaterCtr.ts         // 更新控制器
│   ├── UploadFileCtr.ts      // 文件上传控制器
│   └── index.ts              // 控制器导出
├── services/                 // 服务层
│   ├── fileSearchSrv.ts      // 文件搜索服务
│   ├── fileSrv.ts            // 文件服务
│   └── index.ts              // 服务导出
├── modules/                  // 功能模块
│   ├── fileSearch/           // 文件搜索模块
│   └── updater/              // 更新模块
├── menus/                    // 菜单实现目录
│   ├── index.ts              // 导出平台实现和接口
│   ├── types.ts              // 定义菜单平台接口 IMenuPlatform
│   └── impl/                 // 平台特定实现目录
│       ├── BaseMenuPlatform.ts // 基础平台类，注入App
│       ├── DarwinMenu.ts       // macOS 充血模型实现
│       ├── WindowsMenu.ts      // Windows 充血模型实现
│       └── LinuxMenu.ts        // Linux 充血模型实现
├── shortcuts/                // 快捷键实现
│   ├── config.ts             // 快捷键配置
│   └── index.ts              // 快捷键导出
├── utils/                    // 工具函数
│   ├── file-system.ts        // 文件系统工具
│   ├── logger.ts             // 日志工具
│   └── next-electron-rsc.ts  // Next.js Electron RSC 工具
├── types/                    // 类型定义
│   ├── fileSearch.ts         // 文件搜索类型
│   └── store.ts              // 存储类型
├── const/                    // 常量定义
│   ├── dir.ts                // 目录常量
│   ├── env.ts                // 环境常量
│   └── store.ts              // 存储常量
├── locales/                  // 国际化资源
│   ├── index.ts              // 导出 i18n 相关功能
│   ├── resources.ts          // 资源加载逻辑
│   └── default/              // 默认中文翻译源文件
│       ├── index.ts          // 导出所有翻译
│       ├── menu.ts           // 菜单翻译
│       ├── dialog.ts         // 对话框翻译
│       └── common.ts         // 通用翻译
└── index.ts                  // 主进程入口文件
```

### 预加载脚本

```
apps/desktop/src/preload/
├── index.ts                  // 预加载脚本入口
└── apis/                     // 预加载 API
    └── ...                   // 各种 API 实现
```

### 共享代码

```
apps/desktop/src/common/
├── constants/                // 共享常量
├── types/                    // 共享类型
└── utils/                    // 共享工具函数
```

## 功能模块实现

### 菜单实现框架

```
apps/desktop/src/main/
├── core/
│   ├── App.ts                // 应用核心类
│   ├── BrowserManager.ts     // 浏览器窗口管理
│   └── MenuManager.ts        // 菜单管理核心类，负责选择和协调平台实现
├── menus/                    // 菜单实现目录
│   ├── index.ts              // 导出平台实现和接口
│   ├── types.ts              // 定义菜单平台接口 IMenuPlatform
│   └── impl/                 // 平台特定实现目录
│       ├── BaseMenuPlatform.ts // 基础平台类，注入App
│       ├── DarwinMenu.ts       // macOS 充血模型实现
│       ├── WindowsMenu.ts      // Windows 充血模型实现
│       └── LinuxMenu.ts        // Linux 充血模型实现
├── controllers/
│   └── MenuCtr.ts            // 菜单控制器，处理渲染进程调用
```

### 国际化 (i18n) 实现

```
apps/desktop/src/main/
├── core/
│   ├── I18nManager.ts        // i18n 管理器
│   └── App.ts                // 应用主类，集成 i18n
├── locales/
│   ├── index.ts              // 导出 i18n 相关功能
│   ├── resources.ts          // 资源加载逻辑
│   └── default/              // 默认中文翻译源文件
│       ├── index.ts          // 导出所有翻译
│       ├── menu.ts           // 菜单翻译
│       ├── dialog.ts         // 对话框翻译
│       └── common.ts         // 通用翻译
```

主进程 i18n 国际化管理使用方式:

1. 直接导入 i18nManager 实例:

   ```typescript
   import i18nManager from '@/locales';
   ```

2. 使用翻译函数:

   ```typescript
   import { t } from '@/locales';

   const translated = t('key');
   ```

3. 添加新翻译:
   在 locales/default/ 目录下添加翻译源文件

## 核心模块详细说明

### 认证模块 (Auth)

认证模块负责处理用户身份验证和授权流程，主要包括：

1. **AuthCtr 控制器**：实现 OAuth 授权流程
   - 请求授权：打开浏览器进行 OAuth 认证
   - 处理回调：接收授权码并交换访问令牌
   - 令牌刷新：自动刷新过期的访问令牌
   - 事件广播：向渲染进程通知授权状态变化

```typescript
import { ControllerModule, IpcMethod } from '@/controllers';

export default class AuthCtr extends ControllerModule {
  static override groupName = 'auth';

  @IpcMethod()
  async requestAuthorization(config: DataSyncConfig) {
    this.authRequestState = crypto.randomBytes(16).toString('hex');

    const authUrl = new URL('/oidc/auth', remoteUrl);
    authUrl.search = querystring.stringify({
      client_id: 'lobe-chat',
      redirect_uri: `${protocolPrefix}://auth/callback`,
      response_type: 'code',
      scope: 'openid profile',
      state: this.authRequestState,
    });

    await shell.openExternal(authUrl.toString());
  }
}
```

2. **桌面端特定认证**：
   - 在桌面应用中使用固定的用户 ID
   - 支持与 Better Auth 认证系统集成

### 存储模块 (Store)

存储模块使用 electron-store 实现持久化数据存储：

1. **StoreManager 类**：
   - 提供统一的存储接口
   - 支持类型安全的存取操作
   - 管理应用配置和用户数据

```typescript
// 存储管理器使用示例
export class StoreManager {
  private store: Store<ElectronMainStore>;

  // 获取配置项
  get<K extends StoreKey>(key: K, defaultValue?: ElectronMainStore[K]): ElectronMainStore[K] {
    return this.store.get(key, defaultValue as any);
  }

  // 设置配置项
  set<K extends StoreKey>(key: K, value: ElectronMainStore[K]): void {
    this.store.set(key, value);
  }

  // 删除配置项
  delete(key: StoreKey): void {
    this.store.delete(key);
  }
}
```

2. **存储用途**：
   - 窗口状态保存
   - 用户偏好设置
   - 认证令牌存储
   - 快捷键配置
   - 国际化语言设置

### 快捷键模块 (Shortcuts)

快捷键模块管理全局键盘快捷键：

1. **ShortcutManager 类**：
   - 注册和管理全局快捷键
   - 支持自定义快捷键配置
   - 提供快捷键状态查询

```typescript
// 快捷键管理器示例
export class ShortcutManager {
  private shortcuts: Map<string, () => void> = new Map();
  private shortcutsConfig: Record<string, string> = {};

  // 注册快捷键
  registerShortcut(accelerator: string, callback: () => void): boolean {
    const success = globalShortcut.register(accelerator, callback);
    if (success) {
      this.shortcuts.set(accelerator, callback);
    }
    return success;
  }

  // 更新快捷键配置
  updateShortcutConfig(id: string, accelerator: string): boolean {
    this.shortcutsConfig[id] = accelerator;
    this.saveShortcutsConfig();
    this.registerConfiguredShortcuts();
    return true;
  }
}
```

2. **快捷键装饰器**：
   - 使用 `@shortcut` 装饰器简化快捷键注册
   - 通过 IoC 容器管理快捷键映射

### 控制框架 (Control Framework)

控制框架实现了主进程和渲染进程之间的通信：

1. **ControllerModule 基类**：
   - 所有控制器的基础类
   - 提供生命周期钩子 (beforeAppReady, afterAppReady)
   - 注入 App 实例

```typescript
import { ControllerModule, IpcMethod } from '@/controllers';

export class ControllerModule implements IControllerModule {
  constructor(public app: App) {
    this.app = app;
  }
}

export class BrowserWindowsCtr extends ControllerModule {
  static override readonly groupName = 'windows'; // must be readonly

  @IpcMethod()
  openSettingsWindow(params?: OpenSettingsWindowOptions) {
    // ...
  }
}
```

2. **IoC 容器**：
   - 依赖注入容器管理控制器实例
   - 注册和解析 IPC 事件处理程序
   - 管理快捷键和控制器方法的映射

### 服务逻辑 (Service Logic)

服务层提供业务逻辑实现：

1. **ServiceModule 基类**：
   - 所有服务的基础类
   - 注入 App 实例
   - 提供业务逻辑封装

```typescript
// 服务模块基类
export class ServiceModule {
  constructor(public app: App) {
    this.app = app;
  }
}
```

2. **服务实现**：
   - fileSearchSrv：文件搜索服务
   - fileSrv：文件操作服务

### 数据存储 (Electron Settings)

Electron Settings 基于 electron-store 实现，提供类型安全的数据存储：

1. **存储配置**：
   - 使用 JSON 文件存储配置
   - 支持默认值设置
   - 自动创建存储目录

```typescript
// 存储初始化
this.store = new Store<ElectronMainStore>({
  defaults: STORE_DEFAULTS,
  name: STORE_NAME,
});

// 确保存储目录存在
const storagePath = this.store.get('storagePath');
makeSureDirExist(storagePath);
```

2. **存储操作**：
   - 类型安全的 get/set 方法
   - 支持删除和清除操作
   - 提供存储编辑器功能

### 主进程和渲染进程通信 (Main-Renderer Communication)

主进程和渲染进程通信基于 Electron IPC 机制：

1. **IPC 事件处理**：
   - 使用装饰器注册 IPC 事件处理程序
   - 支持客户端事件和服务器事件
   - 自动映射控制器方法到 IPC 事件

```typescript
import { ensureElectronIpc } from '@/utils/electron/ipc';

// 渲染进程中使用 type-safe proxy 调用主进程方法
const ipc = ensureElectronIpc();

await ipc.localSystem.readLocalFile({ path });
await ipc.system.updateLocale('en-US');
```

2. **事件广播**：
   - 主进程向渲染进程广播事件
   - 支持向所有窗口或特定窗口发送消息

### 日志系统 (Logging)

日志系统提供统一的日志记录接口：

1. **日志工具**：
   - 基于 debug 和 electron-log 实现
   - 支持不同日志级别 (debug, info, warn, error, verbose)
   - 根据环境自动调整日志行为

```typescript
// 创建日志记录器
export const createLogger = (namespace: string) => {
  const debugLogger = debug(namespace);

  return {
    debug: (message, ...args) => {
      debugLogger(message, ...args);
    },
    error: (message, ...args) => {
      if (process.env.NODE_ENV === 'production') {
        electronLog.error(message, ...args);
      }
      debugLogger(`ERROR: ${message}`, ...args);
    },
    // 其他日志级别...
  };
};
```

2. **日志配置**：
   - 开发环境显示详细日志
   - 生产环境记录到文件
   - 支持命名空间隔离日志

### 自动更新 (Auto Updates)

自动更新模块基于 electron-updater 实现：

1. **UpdaterManager 类**：
   - 检查更新
   - 下载更新
   - 安装更新
   - 支持立即安装或下次启动安装

```typescript
// 更新管理器示例
export class UpdaterManager {
  // 检查更新
  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (this.checking || this.downloading) return;

    this.checking = true;
    this.isManualCheck = manual;

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.error('Error checking for updates:', error.message);
    } finally {
      this.checking = false;
    }
  };

  // 下载更新
  public downloadUpdate = async (manual: boolean = false) => {
    if (this.downloading || !this.updateAvailable) return;

    this.downloading = true;

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.downloading = false;
      logger.error('Error downloading update:', error);
    }
  };
}
```

2. **更新配置**：
   - 支持多渠道发布 (stable, beta, nightly)
   - 自动检查更新
   - 更新事件通知

## 桌面端架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron Application                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐           ┌──────────────────────────┐    │
│  │   Main Process  │           │     Renderer Process     │    │
│  │                 │           │                          │    │
│  │  ┌─────────────┐│           │  ┌────────────────────┐  │    │
│  │  │    Core     ││           │  │                    │  │    │
│  │  │  Managers   ││           │  │                    │  │    │
│  │  └─────────────┘│           │  │     Next.js App    │  │    │
│  │        │        │           │  │                    │  │    │
│  │  ┌─────▼─────┐  │           │  │                    │  │    │
│  │  │Controllers│  │◄──────────┼──┤                    │  │    │
│  │  └─────┬─────┘  │  IPC      │  └────────────────────┘  │    │
│  │        │        │Communication                          │    │
│  │  ┌─────▼─────┐  │           │                          │    │
│  │  │ Services  │  │           │                          │    │
│  │  └─────┬─────┘  │           │                          │    │
│  │        │        │           │                          │    │
│  │  ┌─────▼─────┐  │           │                          │    │
│  │  │  Modules  │  │           │                          │    │
│  │  └───────────┘  │           │                          │    │
│  │                 │           │                          │    │
│  └─────────────────┘           └──────────────────────────┘    │
│                                                                 │
│                     ┌───────────────────┐                       │
│                     │   Preload Script  │                       │
│                     │  (Bridge between  │                       │
│                     │  Main & Renderer) │                       │
│                     └───────────────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
