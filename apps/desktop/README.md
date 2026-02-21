# 🤯 LobeHub Desktop Application

LobeHub Desktop is a cross-platform desktop application for [LobeChat](https://github.com/lobehub/lobe-chat), built with Electron, providing a more native desktop experience and functionality.

## ✨ Features

- **🌍 Cross-platform Support**: Supports macOS (Intel/Apple Silicon), Windows, and Linux systems
- **🔄 Auto Updates**: Built-in update mechanism ensures you always have the latest version
- **🌐 Multi-language Support**: Complete i18n support for 18+ languages with lazy loading
- **🎨 Native Integration**: Deep OS integration with native menus, shortcuts, and notifications
- **🔒 Secure & Reliable**: macOS notarized, encrypted token storage, secure OAuth flow
- **📦 Multiple Release Channels**: Stable, beta, and nightly build versions
- **⚡ Advanced Window Management**: Multi-window architecture with theme synchronization
- **🔗 Remote Server Sync**: Secure data synchronization with remote LobeChat instances
- **🎯 Developer Tools**: Built-in development panel and comprehensive debugging tools

## 🚀 Development Setup

### Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Electron** compatible development environment

### Quick Start

```bash
# Install dependencies
pnpm install-isolated

# Start development server
pnpm dev

# Type checking
pnpm type-check

# Run tests
pnpm test
```

### Environment Configuration

Copy `.env.desktop` to `.env` and configure as needed:

```bash
cp .env.desktop .env
```

> \[!WARNING]
> Backup your `.env` file before making changes to avoid losing configurations.

### Build Commands

| Command                    | Description                                 |
| -------------------------- | ------------------------------------------- |
| `pnpm build:main`          | Build main/preload (dist output only)       |
| `pnpm package:mac`         | Package for macOS (Intel + Apple Silicon)   |
| `pnpm package:win`         | Package for Windows                         |
| `pnpm package:linux`       | Package for Linux                           |
| `pnpm package:local`       | Local packaging build (no ASAR)             |
| `pnpm package:local:reuse` | Local packaging build reusing existing dist |

### Development Workflow

```bash
# 1. Development
pnpm dev # Start with hot reload

# 2. Code Quality
pnpm lint       # ESLint checking
pnpm format     # Prettier formatting
pnpm type-check # TypeScript validation

# 3. Testing
pnpm test # Run Vitest tests

# 4. Build & Package
pnpm build:main    # Production build (dist only)
pnpm package:local # Local testing package
```

## 🎯 Release Channels

| Channel     | Description                      | Stability | Auto-Updates |
| ----------- | -------------------------------- | --------- | ------------ |
| **Stable**  | Thoroughly tested releases       | 🟢 High   | ✅ Yes       |
| **Beta**    | Pre-release with new features    | 🟡 Medium | ✅ Yes       |
| **Nightly** | Daily builds with latest changes | 🟠 Low    | ✅ Yes       |

## 🛠 Technology Stack

### Core Framework

- **Electron** `37.1.0` - Cross-platform desktop framework
- **Node.js** `22+` - Backend runtime
- **TypeScript** `5.7+` - Type-safe development
- **Vite** `6.2+` - Build tooling

### Architecture & Patterns

- **Dependency Injection** - IoC container with decorator-based registration
- **Event-Driven Architecture** - IPC communication between processes
- **Module Federation** - Dynamic controller and service loading
- **Observer Pattern** - State management and UI synchronization

### Development Tools

- **Vitest** - Unit testing framework
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **electron-builder** - Application packaging
- **electron-updater** - Auto-update mechanism

### Security & Storage

- **Electron Safe Storage** - Encrypted token storage
- **OAuth 2.0 + PKCE** - Secure authentication flow
- **electron-store** - Persistent configuration
- **Custom Protocol Handler** - Secure callback handling

## 🏗 Architecture

The desktop application uses a sophisticated dependency injection and event-driven architecture:

### 📁 Core Structure

```
src/main/core/
├── App.ts                    # 🎯 Main application orchestrator
├── IoCContainer.ts           # 🔌 Dependency injection container
├── window/                   # 🪟 Window management modules
│   ├── WindowThemeManager.ts     # 🎨 Theme synchronization
│   ├── WindowPositionManager.ts  # 📐 Position persistence
│   ├── WindowErrorHandler.ts     # ⚠️  Error boundaries
│   └── WindowConfigBuilder.ts    # ⚙️  Configuration builder
├── browser/                  # 🌐 Browser management modules
│   ├── Browser.ts               # 🪟 Individual window instances
│   └── BrowserManager.ts        # 👥 Multi-window coordinator
├── ui/                       # 🎨 UI system modules
│   ├── Tray.ts                  # 📍 System tray integration
│   ├── TrayManager.ts           # 🔧 Tray management
│   ├── MenuManager.ts           # 📋 Native menu system
│   └── ShortcutManager.ts       # ⌨️  Global shortcuts
└── infrastructure/           # 🔧 Infrastructure services
    ├── StoreManager.ts          # 💾 Configuration storage
    ├── I18nManager.ts           # 🌍 Internationalization
    ├── UpdaterManager.ts        # 📦 Auto-update system
    └── StaticFileServerManager.ts # 🗂️ Local file serving
```

### 🔄 Application Lifecycle

The `App.ts` class orchestrates the entire application lifecycle through key phases:

#### 1. 🚀 Initialization Phase

- **System Information Logging** - Captures OS, CPU, RAM, and locale details
- **Store Manager Setup** - Initializes persistent configuration storage
- **Dynamic Module Loading** - Auto-discovers controllers and services via glob imports
- **IPC Event Registration** - Sets up inter-process communication channels

#### 2. 🏃 Bootstrap Phase

- **Single Instance Check** - Ensures only one application instance runs
- **IPC Server Launch** - Starts the communication server
- **Core Manager Initialization** - Sequential initialization of all managers:
  - 🌍 I18n for internationalization
  - 📋 Menu system for native menus
  - 🗂️ Static file server for local assets
  - ⌨️ Global shortcuts registration
  - 🪟 Browser window management
  - 📍 System tray (Windows only)
  - 📦 Auto-updater system

### 🔧 Core Components Deep Dive

#### 🌐 Browser Management System

- **Multi-Window Architecture** - Supports chat, settings, and devtools windows
- **Window State Management** - Handles positioning, theming, and lifecycle
- **WebContents Mapping** - Bidirectional mapping between WebContents and identifiers
- **Event Broadcasting** - Centralized event distribution to all or specific windows

#### 🔌 Dependency Injection & Event System

- **IoC Container** - WeakMap-based container for decorated controller methods
- **Typed IPC Decorators** - `@IpcMethod` wires controller methods into type-safe channels
- **Automatic Event Mapping** - Events registered during controller loading
- **Service Locator** - Type-safe service and controller retrieval

##### 🧠 Type-Safe IPC Flow

- **Async Context Propagation** - `src/main/utils/ipc/base.ts` captures the `IpcContext` with `AsyncLocalStorage`, so controller logic can call `getIpcContext()` anywhere inside an IPC handler without explicitly threading arguments.
- **Service Constructors Registry** - `src/main/controllers/registry.ts` exports `controllerIpcConstructors` and `DesktopIpcServices`, enabling automatic typing of renderer IPC proxies.
- **Renderer Proxy Helper** - `src/utils/electron/ipc.ts` exposes `ensureElectronIpc()` which lazily builds a proxy on top of `window.electronAPI.invoke`, giving React/Next.js code a type-safe API surface without exposing raw proxies in preload.
- **Shared Typings Package** - `apps/desktop/src/main/exports.d.ts` augments `@lobechat/electron-client-ipc` so every package can consume `DesktopIpcServices` without importing desktop business code directly.

#### 🪟 Window Management

- **Theme-Aware Windows** - Automatic adaptation to system dark/light mode
- **Platform-Specific Styling** - Windows title bar and overlay customization
- **Position Persistence** - Save and restore window positions across sessions
- **Error Boundaries** - Centralized error handling for window operations

#### 🔧 Infrastructure Services

##### 🌍 I18n Manager

- **18+ Language Support** with lazy loading and namespace organization
- **System Integration** with Electron's locale detection
- **Dynamic UI Refresh** on language changes
- **Resource Management** with efficient loading strategies

##### 📦 Update Manager

- **Multi-Channel Support** (stable, beta, nightly) with configurable intervals
- **Background Downloads** with progress tracking and user notifications
- **Rollback Protection** with error handling and recovery mechanisms
- **Channel Management** with automatic channel switching

##### 💾 Store Manager

- **Type-Safe Storage** using electron-store with TypeScript interfaces
- **Encrypted Secrets** via Electron's Safe Storage API
- **Configuration Validation** with default value management
- **File System Integration** with automatic directory creation

##### 🗂️ Static File Server

- **Local HTTP Server** for serving application assets and user files
- **Security Controls** with request filtering and access validation
- **File Management** with upload, download, and deletion capabilities
- **Path Resolution** with intelligent routing between storage locations

#### 🎨 UI System Integration

- **Global Shortcuts** - Platform-aware keyboard shortcut registration with conflict detection
- **System Tray** - Native integration with context menus and notifications
- **Native Menus** - Platform-specific application and context menus with i18n
- **Theme Synchronization** - Automatic theme updates across all UI components

### 🏛 Controller & Service Architecture

#### 🎮 Controller Pattern

- **Typed IPC Decorators** - Controllers extend `ControllerModule` and expose renderer methods via `@IpcMethod`
- **IPC Event Handling** - Processes events from renderer with decorator-based registration
- **Lifecycle Hooks** - `beforeAppReady` and `afterAppReady` for initialization phases
- **Type-Safe Communication** - Strong typing for all IPC events and responses
- **Error Boundaries** - Comprehensive error handling with proper propagation

#### 🔧 Service Pattern

- **Business Logic Encapsulation** - Clean separation of concerns
- **Dependency Management** - Managed through IoC container
- **Cross-Controller Sharing** - Services accessible via service locator pattern
- **Resource Management** - Proper initialization and cleanup

### 🔗 Inter-Process Communication

#### 📡 IPC System Features

- **Bidirectional Communication** - Main↔Renderer and Main↔Next.js server
- **Type-Safe Events** - TypeScript interfaces for all event parameters
- **Context Awareness** - Events include sender context for window-specific operations
- **Error Propagation** - Centralized error handling with proper status codes

##### 🧩 Renderer IPC Helper

Renderer code uses a lightweight proxy generated at runtime to keep IPC calls type-safe without exposing raw Electron objects through `contextBridge`. Use the helper exported from `src/utils/electron/ipc.ts` to access the main-process services:

```ts
import { ensureElectronIpc } from '@/utils/electron/ipc';

const ipc = ensureElectronIpc();
await ipc.windows.openSettingsWindow({ tab: 'provider' });
```

The helper internally builds a proxy on top of `window.electronAPI.invoke`, so no proxy objects need to be cloned across the preload boundary.

#### 🛡️ Security Features

- **OAuth 2.0 + PKCE** - Secure authentication with state parameter validation
- **Encrypted Token Storage** - Using Electron's Safe Storage API when available
- **Custom Protocol Handler** - Secure callback handling for OAuth flows
- **Request Filtering** - Security controls for web requests and external links

## 🧪 Testing

### Test Structure

```bash
apps/desktop/src/main/controllers/__tests__/ # Controller unit tests
tests/                                       # Integration tests
```

### Running Tests

```bash
pnpm test       # Run all tests
pnpm test:watch # Watch mode
pnpm type-check # Type validation
```

### Test Coverage

- **Controller Tests** - IPC event handling validation
- **Service Tests** - Business logic verification
- **Integration Tests** - End-to-end workflow testing
- **Type Tests** - TypeScript interface validation

## 🔒 Security Features

### Authentication & Authorization

- **OAuth 2.0 Flow** with PKCE for secure token exchange
- **State Parameter Validation** to prevent CSRF attacks
- **Encrypted Token Storage** using platform-native secure storage
- **Automatic Token Refresh** with fallback to re-authentication

### Application Security

- **Code Signing** - macOS notarization for enhanced security
- **Sandboxing** - Controlled access to system resources
- **CSP Controls** - Content Security Policy management
- **Request Filtering** - Security controls for external requests

### Data Protection

- **Encrypted Configuration** - Sensitive data encrypted at rest
- **Secure IPC** - Type-safe communication channels
- **Path Validation** - Secure file system access controls
- **Network Security** - HTTPS enforcement and proxy support

## 🤝 Contribution

Desktop application development involves complex cross-platform considerations and native integrations. We welcome community contributions to improve functionality, performance, and user experience. You can participate in improvements through:

### How to Contribute

1. **Platform Support**: Enhance cross-platform compatibility and native integrations
2. **Performance Optimization**: Improve application startup time, memory usage, and responsiveness
3. **Feature Development**: Add new desktop-specific features and capabilities
4. **Bug Fixes**: Fix platform-specific issues and edge cases
5. **Security Improvements**: Enhance security measures and authentication flows
6. **UI/UX Enhancements**: Improve desktop user interface and experience

### Contribution Process

1. Fork the [LobeChat repository](https://github.com/lobehub/lobe-chat)
2. Set up the desktop development environment following our setup guide
3. Make your changes to the desktop application
4. Submit a Pull Request describing:

- Platform compatibility testing results
- Performance impact analysis
- Security considerations
- User experience improvements
- Breaking changes (if any)

### Development Areas

- **Core Architecture**: Dependency injection, event system, and lifecycle management
- **Window Management**: Multi-window support, theme synchronization, and state persistence
- **IPC Communication**: Type-safe inter-process communication between main and renderer
- **Platform Integration**: Native menus, shortcuts, notifications, and system tray
- **Security Features**: OAuth flows, token encryption, and secure storage
- **Auto-Update System**: Multi-channel updates and rollback mechanisms

## 📚 Additional Resources

- **Development Guide**: [`Development.md`](./Development.md) - Comprehensive development documentation
- **Architecture Docs**: [`/docs`](../../docs/) - Detailed technical specifications
- **Contributing**: [`CONTRIBUTING.md`](../../CONTRIBUTING.md) - Contribution guidelines
- **Issues & Support**: [GitHub Issues](https://github.com/lobehub/lobe-chat/issues)
