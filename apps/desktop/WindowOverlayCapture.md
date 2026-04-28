# 桌面端全屏 Overlay 截图方案设计与集成说明

| 字段         | 内容                                                  |
| ------------ | ----------------------------------------------------- |
| 状态         | 已完成技术预研与 demo 验证                            |
| 最后更新     | 2026-04-14                                            |
| 适用范围     | Electron 桌面端全屏遮罩、窗口高亮、点击截窗、区域截图 |
| 当前验证载体 | `tmp/electron-window-overlay-demo`                    |
| 目标读者     | 后续将该能力接入 LobeHub Desktop 主业务的开发者       |

## 1. 文档目标

本文档用于沉淀以下内容：

| 目标                 | 说明                                                          |
| -------------------- | ------------------------------------------------------------- |
| 记录方案演进         | 保存从纯 Electron、native、自研、开源库到最终 demo 的决策过程 |
| 固化关键技术结论     | 明确哪些能力 Electron 可做，哪些能力必须借助额外库            |
| 提供业务接入蓝图     | 指出应修改的真实仓库文件、模块边界、IPC 设计与 UI 接入点      |
| 降低后续重复调研成本 | 使后续实现可以直接沿用本文档，不必重新验证底层假设            |

## 2. 需求回顾

| 需求项                              | 结论                                                |
| ----------------------------------- | --------------------------------------------------- |
| 新增一个 “全屏” 入口                | 需要，但本质上是一个覆盖整块屏幕的透明 overlay 窗口 |
| 覆盖用户整个 screen                 | 需要，且在 macOS 上要覆盖菜单栏与 Dock 所在区域     |
| 获取系统窗口几何信息                | 需要，至少需要 `appName + bounds + windowId`        |
| 在 overlay 上高亮窗口边框并显示 Tag | 需要                                                |
| 点击高亮窗口即截图该窗口            | 需要                                                |
| 拖拽任意区域截图                    | 需要                                                |
| 输出先写入剪贴板                    | 需要，作为 MVP                                      |
| 避免自研 native addon               | 明确要求避免                                        |
| 跨平台预留                          | 需要，至少不能被 macOS-only 自研方案锁死            |

## 3. 关键术语澄清

### 3.1 “压住 macOS 菜单栏与 Dock” 的准确含义

这里的含义不是 “调用系统 fullscreen API”，而是：

| 项目     | 含义                                                         |
| -------- | ------------------------------------------------------------ |
| 覆盖范围 | 窗口尺寸必须基于 `display.bounds`，而不是 `display.workArea` |
| Z 轴层级 | 窗口需要位于普通应用窗口之上，并且进入菜单栏所在区域         |
| 视觉效果 | 用户看到的是整块屏幕都被半透明遮罩覆盖                       |

必须区分以下两件事：

| 易混概念                            | 实际含义                                             |
| ----------------------------------- | ---------------------------------------------------- |
| `app.dock.hide()`                   | 仅隐藏应用在 Dock 中的图标，不会隐藏系统 Dock 栏本身 |
| `BrowserWindow.setFullScreen(true)` | 更接近原生全屏行为，未必适合作为截图 overlay         |

## 4. 预研结论总览

### 4.1 方案对比

| 方案                                  | 能否覆盖菜单栏 / Dock | 能否拿到系统窗口 bounds |     能否按窗口截图 | 跨平台性 | 结论                       |
| ------------------------------------- | --------------------: | ----------------------: | -----------------: | -------: | -------------------------- |
| 纯 Electron `desktopCapturer`         |                    是 |                      否 | 部分可做，但不精确 |       高 | 不足以满足需求             |
| 自研 native addon                     |                    是 |                      是 |                 是 |       中 | 能做，但被明确拒绝         |
| 参考 Claude.app 的 native quick entry |                    是 |                      是 |                 是 |   低到中 | 可借鉴思路，不适合直接照搬 |
| `node-screenshots` 单库               |                    是 |                      是 |                 是 |   中到高 | 核心方案成立               |
| `node-screenshots + get-windows`      |                    是 |                      是 |                 是 |   中到高 | 当前最终方案               |

### 4.2 最终选型

| 能力                  | 最终实现                   |
| --------------------- | -------------------------- |
| 全屏 overlay 窗口     | Electron `BrowserWindow`   |
| 系统窗口枚举          | `node-screenshots`         |
| 指定窗口截图          | `node-screenshots`         |
| 隐藏 / 伪关闭窗口过滤 | `get-windows` 作为白名单   |
| 区域截图              | Electron `desktopCapturer` |
| 输出介质              | `clipboard.writeImage()`   |

## 5. 对 Claude.app 的观察结论

本轮曾直接检查过本机解包后的 Claude.app 产物，结论如下：

| 观察对象           | 结论                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `quick_window`     | 不是全屏 overlay；它是小尺寸 `panel` 弹窗                                                        |
| `nativeQuickEntry` | Claude.app 存在原生 quick entry 能力，说明其真实覆盖式入口并不完全依赖纯 Electron                |
| `cu-glow`          | 这是最接近本需求的 Electron overlay 实现：使用 `display.bounds`、透明窗、`screen-saver` 置顶层级 |

据此可以得出两个重要判断：

| 判断                                         | 含义 |
| -------------------------------------------- | ---- |
| Electron 可以做 “整屏遮罩”                   | 成立 |
| Claude 的 “整屏入口” 并不等于 `quick_window` | 成立 |

## 6. 当前 demo 的最终方案

### 6.1 架构图

```text
┌──────────────────────────────┐
│ Tray / Menu / Future Action  │
└──────────────┬───────────────┘
               │ startOverlaySession
               ▼
┌────────────────────────────────────────────┐
│ Main Process                               │
│                                            │
│ 1. 选定当前光标所在 display                 │
│ 2. 枚举窗口：node-screenshots              │
│ 3. 过滤隐藏窗口：get-windows 白名单        │
│ 4. 创建整屏 overlay BrowserWindow          │
└──────────────┬─────────────────────────────┘
               │ preload / IPC
               ▼
┌────────────────────────────────────────────┐
│ Overlay Renderer                           │
│                                            │
│ 1. 渲染窗口高亮框与左上角 tag              │
│ 2. 点击窗口 => captureWindow(windowId)     │
│ 3. 拖拽区域 => captureRect(rect)           │
└──────────────┬─────────────────────────────┘
               │ IPC
               ▼
┌────────────────────────────────────────────┐
│ Main Process Capture Path                  │
│                                            │
│ Window: node-screenshots.captureImage()    │
│ Region: desktopCapturer + crop             │
│ Output: clipboard.writeImage()             │
└────────────────────────────────────────────┘
```

### 6.2 demo 文件职责

| 文件                                                                                                                 | 作用                                         |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`tmp/electron-window-overlay-demo/main.mjs`](../../tmp/electron-window-overlay-demo/main.mjs)                       | 主进程入口；创建 overlay，枚举窗口，执行截图 |
| [`tmp/electron-window-overlay-demo/preload.cjs`](../../tmp/electron-window-overlay-demo/preload.cjs)                 | 为 overlay renderer 暴露 IPC bridge          |
| [`tmp/electron-window-overlay-demo/renderer/index.html`](../../tmp/electron-window-overlay-demo/renderer/index.html) | overlay 渲染宿主页                           |
| [`tmp/electron-window-overlay-demo/renderer/app.js`](../../tmp/electron-window-overlay-demo/renderer/app.js)         | 窗口高亮、点击截窗、拖拽截区交互             |
| [`tmp/electron-window-overlay-demo/renderer/styles.css`](../../tmp/electron-window-overlay-demo/renderer/styles.css) | 遮罩视觉样式                                 |
| [`tmp/electron-window-overlay-demo/README.md`](../../tmp/electron-window-overlay-demo/README.md)                     | demo 的运行说明                              |

## 7. 全屏 overlay 的关键实现参数

### 7.1 必要窗口参数

| 参数 / 调用                         | 用途                               | 必要性 |
| ----------------------------------- | ---------------------------------- | ------ |
| `x/y/width/height = display.bounds` | 覆盖整块屏幕，包括菜单栏区域       | 必需   |
| `transparent: true`                 | 允许渲染半透明遮罩                 | 必需   |
| `frame: false`                      | 去除系统边框                       | 必需   |
| `skipTaskbar: true`                 | 避免出现在任务栏 / Dock 窗口列表中 | 建议   |
| `hasShadow: false`                  | 避免覆盖层产生自身投影             | 建议   |
| `focusable: true`                   | 允许接收鼠标交互                   | 必需   |
| `fullscreenable: false`             | 避免进入原生 fullscreen 流程       | 建议   |
| `enableLargerThanScreen: true`      | 提升跨平台稳健性                   | 建议   |
| `type: 'panel'`（macOS）            | 更接近工具层窗口行为               | 建议   |

### 7.2 必要层级调用

| 调用                                                             | 作用                              |
| ---------------------------------------------------------------- | --------------------------------- |
| `setAlwaysOnTop(true, 'screen-saver')`                           | 让窗口位于更高层级                |
| `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` | 避免 Space / 全屏窗口场景下不可见 |
| `setHiddenInMissionControl(true)`                                | 降低该窗口对系统窗口管理的干扰    |

### 7.3 重要结论

| 结论                      | 说明                                        |
| ------------------------- | ------------------------------------------- |
| `display.workArea` 不可用 | 它会排除菜单栏 / Dock 区域                  |
| `display.bounds` 必须使用 | 只有它能覆盖整个 display                    |
| `screen-saver` 层级有效   | 这是当前 macOS 上最接近需求的 Electron 方案 |

## 8. 系统窗口枚举与过滤策略

### 8.1 为什么不能只用 Electron

| Electron 能力                                       | 缺口                                                      |
| --------------------------------------------------- | --------------------------------------------------------- |
| `desktopCapturer.getSources({ types: ['window'] })` | 能列出可捕获源，但没有稳定的窗口 bounds 用于 overlay 画框 |
| `DesktopCapturerSource.thumbnail`                   | 可截图缩略图，但不适合 “按原窗口精确高亮 + 点击即截”      |

因此，纯 Electron 不足以完成 “系统窗口高亮 + 点击截窗”。

### 8.2 `node-screenshots` 的职责

| API                               | 用途           |
| --------------------------------- | -------------- |
| `Window.all()`                    | 枚举系统窗口   |
| `window.id()`                     | 稳定识别窗口   |
| `window.appName()`                | 获取应用名     |
| `window.title()`                  | 获取标题       |
| `window.x()/y()/width()/height()` | 获取几何信息   |
| `window.captureImage()`           | 截取该窗口图像 |

### 8.3 `get-windows` 的职责

`get-windows` 在当前方案中不负责截图，而只负责 “第二层白名单过滤”。

| 问题                                       | 处理方式                                                      |
| ------------------------------------------ | ------------------------------------------------------------- |
| 某些应用逻辑上已隐藏，但底层枚举仍可能残留 | 只保留同时出现在 `get-windows` 与 `node-screenshots` 中的窗口 |
| Electron 自身的假关闭 /hide 行为           | 该白名单对这类情况更稳                                        |

### 8.4 当前过滤规则

| 规则                                             | 目的                         |
| ------------------------------------------------ | ---------------------------- |
| `isMinimized() === false`                        | 排除最小化窗口               |
| 最小尺寸阈值：`80x60`                            | 排除菜单栏控件、过小悬浮面板 |
| 排除 `Dock` / `Window Server` / `Control Centre` | 排除系统 UI                  |
| 排除 demo 自身窗口                               | 避免 overlay 自我高亮        |
| 必须与目标 display 相交                          | 只画当前屏幕可见窗口         |
| 必须出现在 `get-windows` 白名单中                | 排除隐藏 / 伪关闭残留窗口    |

## 9. 截图路径设计

### 9.1 点击窗口截图

```text
点击高亮框
  └───> renderer 发送 windowId
          └───> main 查找对应 node-screenshots Window
                  └───> overlay.hide()
                          └───> captureImage()
                                  └───> PNG Buffer
                                          └───> nativeImage
                                                  └───> clipboard.writeImage()
```

### 9.2 拖拽区域截图

```text
拖拽区域
  └───> renderer 发送全局 rect
          └───> main 隐藏 overlay
                  └───> desktopCapturer 获取目标 display 图像
                          └───> 按 scaleFactor 计算 cropRect
                                  └───> clipboard.writeImage()
```

### 9.3 为什么两条路径采用不同技术

| 路径       | 技术               | 原因                              |
| ---------- | ------------------ | --------------------------------- |
| 按窗口截图 | `node-screenshots` | 它天然理解 “窗口” 这一对象        |
| 按区域截图 | `desktopCapturer`  | 区域本质上是 display 上的矩形裁剪 |

## 10. 权限与平台边界

### 10.1 macOS 权限

| 权限             | 是否需要         | 用途                                                  |
| ---------------- | ---------------- | ----------------------------------------------------- |
| Screen Recording | 需要             | 窗口截图、区域截图                                    |
| Accessibility    | 当前方案不强依赖 | `get-windows` 已使用 `accessibilityPermission: false` |

### 10.2 当前已知平台边界

| 平台 / 场景   | 状态     | 说明                                                                  |
| ------------- | -------- | --------------------------------------------------------------------- |
| macOS         | 已验证   | 当前主要验证平台                                                      |
| Windows       | 理论可行 | `node-screenshots` / `get-windows` 均支持，但尚未在本仓库内做实机验证 |
| Linux X11     | 理论可行 | 需要单独验证打包与权限                                                |
| Linux Wayland | 风险较高 | 上游库虽宣称支持，但必须做专项验证                                    |

### 10.3 特殊窗口风险

| 风险类型               | 当前处理                                                       |
| ---------------------- | -------------------------------------------------------------- |
| 菜单栏状态窗 / 面板    | 通过尺寸阈值与排除名单降低噪音                                 |
| 系统 UI                | 通过应用名黑名单排除                                           |
| 某些应用截图结果为黑图 | 已观察到个别状态面板存在此现象，应在业务层继续限制候选窗口类别 |

## 11. 已完成验证

| 验证项                              | 结果 | 产物                                                                                                                                                     |
| ----------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| overlay 覆盖整屏                    | 通过 | [`tmp/electron-window-overlay-demo/.cache/window-overlay-visual.png`](../../tmp/electron-window-overlay-demo/.cache/window-overlay-visual.png)           |
| `node-screenshots` 直接截图普通窗口 | 通过 | [`tmp/electron-window-overlay-demo/.cache/cursor-direct.png`](../../tmp/electron-window-overlay-demo/.cache/cursor-direct.png)                           |
| 点击高亮窗口后写入剪贴板            | 通过 | [`tmp/electron-window-overlay-demo/.cache/window-capture-probe-final.png`](../../tmp/electron-window-overlay-demo/.cache/window-capture-probe-final.png) |
| 拖拽区域截图                        | 通过 | [`tmp/electron-window-overlay-demo/.cache/self-test-clipboard-final.png`](../../tmp/electron-window-overlay-demo/.cache/self-test-clipboard-final.png)   |

## 12. 推荐的业务接入方式

### 12.1 总体建议

| 维度                 | 建议                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| overlay 窗口生命周期 | 不建议直接挂进现有 `BrowserManager` 的常规窗口体系                                 |
| 原因                 | overlay 是瞬态、全屏、平台特化、不可持久化的工具窗口，与主业务窗口生命周期明显不同 |
| 推荐做法             | 新增独立主进程模块管理 overlay；渲染内容仍建议走现有 SPA 路由体系                  |

### 12.2 为什么不直接复用 `BrowserManager`

| 观察                                      | 影响                            |
| ----------------------------------------- | ------------------------------- |
| `Browser` 默认承担普通业务窗口职责        | overlay 并非普通业务窗口        |
| `WindowStateManager` 倾向保存窗口状态     | overlay 不应持久化位置与大小    |
| `BrowserManager` 以 “可复用业务窗口” 建模 | overlay 更接近 “一次性工具会话” |

因此，更合理的做法是：

```text
┌────────────────────────────┐
│ BrowserManager             │ 负责常规业务窗口
└────────────────────────────┘

┌────────────────────────────┐
│ CaptureOverlayManager      │ 负责全屏截图 overlay 会话
└────────────────────────────┘
```

## 13. 建议的生产代码落点

### 13.1 主进程

| 建议文件                                                               | 作用                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/desktop/src/main/modules/screenCapture/CaptureOverlayManager.ts` | 创建 / 销毁 overlay 窗口；管理一次截图会话                         |
| `apps/desktop/src/main/modules/screenCapture/WindowSourceService.ts`   | 封装 `node-screenshots + get-windows` 的窗口枚举与过滤             |
| `apps/desktop/src/main/modules/screenCapture/CaptureService.ts`        | 封装窗口截图、区域截图、剪贴板输出                                 |
| `apps/desktop/src/main/modules/screenCapture/permission.ts`            | 封装 macOS 屏幕录制权限检查                                        |
| `apps/desktop/src/main/controllers/ScreenCaptureCtr.ts`                | 对 renderer 暴露 `start / captureRect / captureWindow / close` IPC |
| `apps/desktop/src/main/controllers/registry.ts`                        | 注册 `ScreenCaptureCtr`                                            |

### 13.2 IPC 类型

| 建议文件                                                  | 作用                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| `packages/electron-client-ipc/src/types/screenCapture.ts` | 定义 overlay 会话、窗口元数据、截图参数与返回结果 |
| `packages/electron-client-ipc/src/types/index.ts`         | 导出新类型                                        |

建议定义的核心类型：

| 类型名                     | 用途                                                |
| -------------------------- | --------------------------------------------------- |
| `ScreenCaptureDisplayInfo` | display id / bounds / scaleFactor                   |
| `ScreenCaptureWindowInfo`  | `windowId/appName/title/bounds/overlayBounds/order` |
| `ScreenCaptureSession`     | `display + windows`                                 |
| `CaptureRectParams`        | 全局屏幕坐标的矩形                                  |
| `ScreenCaptureStartResult` | 权限状态、会话状态、错误信息                        |
| `ScreenCaptureOutput`      | `clipboard`、后续可扩展 `file`、`attachment`        |

### 13.3 Preload 与 renderer service

| 建议文件                                  | 作用                                               |
| ----------------------------------------- | -------------------------------------------------- |
| `apps/desktop/src/preload/electronApi.ts` | 通常无需特殊改造；沿用统一 `invoke` 即可           |
| `src/services/electron/screenCapture.ts`  | 前端统一调用 `ensureElectronIpc().screenCapture.*` |

### 13.4 Renderer 路由

生产环境存在两种可选实现：

| 方案               | 优点                             | 缺点                             | 建议             |
| ------------------ | -------------------------------- | -------------------------------- | ---------------- |
| 独立静态 HTML 页面 | 轻量、与业务隔离、最接近 demo    | 与现有 React/i18n / 业务状态脱节 | 仅适合 spike     |
| 独立桌面 SPA 路由  | 可复用现有构建、i18n、业务事件链 | 需要维护 desktop router 双配置   | **推荐生产使用** |

若采用 SPA 路由，建议新增：

| 建议文件                                                | 作用                                 |
| ------------------------------------------------------- | ------------------------------------ |
| `src/routes/(desktop)/screen-capture-overlay/index.tsx` | overlay 页面入口；仅负责挂载 UI 组件 |
| `src/features/DesktopScreenCaptureOverlay/*`            | 业务组件、hooks、样式                |
| `src/spa/router/desktopRouter.config.tsx`               | 动态路由配置                         |
| `src/spa/router/desktopRouter.config.desktop.tsx`       | 同步路由配置                         |

必须注意：

| 规则                             | 说明                                 |
| -------------------------------- | ------------------------------------ |
| 两份 desktop router 必须同时更新 | 否则 Electron 本地构建可能出现空白页 |
| overlay route 应保持极薄         | 不在 route 文件中堆叠业务逻辑        |

## 14. 托盘入口的真实接入点

若要从托盘启动 overlay，会涉及以下文件：

| 文件                                            | 作用                 |
| ----------------------------------------------- | -------------------- |
| `apps/desktop/src/main/menus/impls/macOS.ts`    | macOS 托盘菜单模板   |
| `apps/desktop/src/main/menus/impls/windows.ts`  | Windows 托盘菜单模板 |
| `apps/desktop/src/main/menus/impls/linux.ts`    | Linux 托盘菜单模板   |
| `apps/desktop/src/main/locales/default/menu.ts` | 托盘菜单文案         |

推荐新增文案键：

| Key                        | 语义                     |
| -------------------------- | ------------------------ |
| `tray.captureScreen`       | 启动截图 overlay         |
| `tray.captureScreenWindow` | 启动窗口截图模式（可选） |

## 15. 业务接入分阶段计划

### 阶段一：桌面主进程能力落地

| 步骤 | 目标                                                                               |
| ---- | ---------------------------------------------------------------------------------- |
| 1    | 将 `node-screenshots`、`get-windows` 加入 `apps/desktop/package.json#dependencies` |
| 2    | 新建 `screenCapture` 主进程模块与 controller                                       |
| 3    | 跑通托盘菜单触发 overlay                                                           |
| 4    | 继续以剪贴板为唯一输出                                                             |

### 阶段二：接回现有业务 UI

| 步骤 | 目标                                               |
| ---- | -------------------------------------------------- |
| 1    | 新增桌面专用 overlay route /feature                |
| 2    | 将截图结果从 “仅写剪贴板” 升级为 “回传 attachment” |
| 3    | 支持从 chat 输入区触发                             |
| 4    | 支持截图后自动插入当前会话                         |

### 阶段三：体验完善

| 步骤 | 目标                                 |
| ---- | ------------------------------------ |
| 1    | 多 display 支持                      |
| 2    | Hover 高亮 / 文案优化                |
| 3    | 保存文件、编辑器标注、OCR 等增强能力 |
| 4    | 平台差异补齐（尤其 Windows / Linux） |

## 16. 依赖落点与版本建议

### 16.1 应加入的位置

| 文件                        | 说明                              |
| --------------------------- | --------------------------------- |
| `apps/desktop/package.json` | Electron 桌面运行时的真实依赖落点 |

### 16.2 建议依赖

| 包名               | 用途                        | 当前 demo 使用版本 |
| ------------------ | --------------------------- | ------------------ |
| `node-screenshots` | 枚举窗口 + 窗口截图         | `^0.2.8`           |
| `get-windows`      | 白名单过滤隐藏 / 伪关闭窗口 | `^9.3.0`           |

说明：

| 项目                         | 结论 |
| ---------------------------- | ---- |
| 这不是 “纯 Electron” 方案    | 成立 |
| 这也不是 “自研 native addon” | 成立 |
| 当前依赖的是开源原生库       | 成立 |

## 17. 测试建议

建议避免写 “窗口列表快照” 这类低信号测试，优先做行为测试。

| 测试层级       | 建议内容                                                   |
| -------------- | ---------------------------------------------------------- |
| 单元测试       | 过滤逻辑：尺寸阈值、系统应用排除、自身窗口排除、白名单交集 |
| 主进程集成测试 | 权限失败、overlay 会话生命周期、错误分支                   |
| 手工验证       | 菜单栏覆盖、点击截窗、拖拽截区、隐藏窗口过滤               |

建议手工验证清单：

| 检查项                   | 期望                     |
| ------------------------ | ------------------------ |
| 当前活动屏幕启动 overlay | 只覆盖当前目标 display   |
| 已隐藏的 Electron 子窗口 | 不再出现边框             |
| 点击普通应用窗口         | 剪贴板中得到该窗口图像   |
| 拖拽区域截图             | 剪贴板中得到对应裁剪区域 |
| 取消操作                 | `Esc` 可关闭 overlay     |

## 18. 当前已确认的非目标

| 非目标                              | 说明                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------- |
| 当前阶段支持全平台一致体验          | 尚未完成                                                                |
| 当前阶段支持窗口标题绝对准确        | `get-windows` 在无额外权限时标题可为空；当前主要依赖 `node-screenshots` |
| 当前阶段支持多 display 同时 overlay | 尚未实现                                                                |
| 当前阶段支持标注编辑器              | 未实现                                                                  |

## 19. 后续实现时的推荐决策

| 决策点                                          | 推荐                     |
| ----------------------------------------------- | ------------------------ |
| overlay 窗口是否复用 `BrowserManager`           | 不推荐                   |
| renderer 是否走 SPA route                       | 推荐                     |
| 主进程是否继续保留 “剪贴板优先” 输出            | 推荐，先保持最小可用闭环 |
| 是否继续保留 `desktopCapturer` 作为区域截图路径 | 推荐                     |
| 是否用 `get-windows` 继续做白名单过滤           | 推荐                     |

## 20. 实施摘要

```text
┌──────────────────────────────────────────────┐
│ 已验证的技术事实                             │
├──────────────────────────────────────────────┤
│ 1. Electron 可以创建覆盖整块 display 的窗体  │
│ 2. 纯 Electron 无法独立完成系统窗口高亮      │
│ 3. node-screenshots 可完成窗口枚举与截窗     │
│ 4. get-windows 可帮助过滤隐藏 / 残留窗口     │
│ 5. 最终可形成“点击窗口即截图 + 拖拽截区”闭环 │
└──────────────────────────────────────────────┘
```

本文档可视为后续将该能力正式接入 `apps/desktop` 主业务的实施基线。
