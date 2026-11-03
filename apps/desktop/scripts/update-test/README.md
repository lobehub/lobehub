# 本地更新测试指南

本目录包含用于在本地测试 Desktop 应用更新功能的工具和脚本，支持 stable/nightly/canary 三渠道切换测试。

## 目录结构

```
scripts/update-test/
├── README.md                    # 本文档
├── setup.sh                     # 一键设置脚本
├── run-test.sh                  # 一键启动测试（推荐）
├── start-server.sh              # 启动本地更新服务器
├── stop-server.sh               # 停止本地更新服务器
├── generate-manifest.sh         # 生成 manifest 和目录结构
├── dev-app-update.local.yml     # 本地测试用的更新配置模板
└── server/                      # 本地服务器文件目录 (自动生成)
    ├── stable/                  # stable 渠道
    │   ├── stable-mac.yml
    │   └── {version}/
    │       ├── xxx.dmg
    │       └── xxx.zip
    ├── nightly/                 # nightly 渠道
    │   ├── nightly-mac.yml
    │   └── {version}/
    │       └── ...
    └── canary/                  # canary 渠道
        ├── canary-mac.yml
        └── {version}/
            └── ...
```

## 快速开始

### 一键测试（推荐）

```bash
cd apps/desktop/scripts/update-test
chmod +x *.sh
./run-test.sh
```

此脚本会自动：为三个渠道生成不同版本号的 manifest → 启动本地服务器 → 配置应用 → 启动应用。

### 手动步骤

#### 1. 首次设置

```bash
cd apps/desktop/scripts/update-test
chmod +x *.sh
./setup.sh
```

#### 2. 构建测试包

```bash
cd ../..
# 构建 DMG + ZIP (macOS 自动更新需要 ZIP)
bun run package:mac:local
```

> **注意**: 不要使用 `package:local`，它只输出目录结构不产出 DMG/ZIP 安装包。

#### 3. 生成更新文件

```bash
cd scripts/update-test

# 为所有渠道生成（推荐，会自动分配不同版本号）
./generate-manifest.sh --from-release --all-channels

# 或指定单个渠道
./generate-manifest.sh --from-release -c nightly -v 2.1.0-nightly.1
```

#### 4. 启动本地服务器

```bash
./start-server.sh
# 服务器默认在 http://localhost:8787 启动
```

#### 5. 启动应用

```bash
cd ../..
UPDATE_SERVER_URL=http://localhost:8787 bun run dev
```

**重要**: 必须设置 `UPDATE_SERVER_URL` 环境变量，否则 channel 切换时 `configureUpdateProvider()` 会回退到 GitHub。

#### 6. 测试 Channel 切换

1. 进入 **设置 > Beta**
2. 在 **Update Channel** 下拉框中选择不同渠道
3. 切换后应用会自动检查对应渠道的更新
4. 查看日志确认 feed URL 切换正确：`tail -f ~/Library/Logs/lobehub-desktop-dev/main.log`

#### 7. 测试完成后

```bash
cd scripts/update-test
./stop-server.sh

# 恢复默认的 dev-app-update.yml（可选）
cd ../..
git checkout dev-app-update.yml
```

---

## generate-manifest.sh 用法

```bash
用法: ./generate-manifest.sh [选项]

选项:
  -v, --version VERSION    指定版本号 (例如: 2.0.1)
  -c, --channel CHANNEL    指定渠道 (stable|nightly|canary, 默认: stable)
  -a, --all-channels       为所有渠道生成 manifest (stable/nightly/canary)
  -d, --dmg FILE           指定 DMG 文件名
  -z, --zip FILE           指定 ZIP 文件名
  -n, --notes TEXT         指定 release notes
  -f, --from-release       从 release 目录自动复制文件
  -h, --help               显示帮助信息

示例:
  ./generate-manifest.sh --from-release --all-channels
  ./generate-manifest.sh -v 2.0.1 -c stable --from-release
  ./generate-manifest.sh -v 2.1.0-nightly.1 -c nightly --from-release
```

---

## 测试场景

| 场景                 | 操作                                                    |
| -------------------- | ------------------------------------------------------- |
| 有新版本可用         | manifest 中 `version` 大于当前应用版本                  |
| 无新版本             | `version` 小于或等于当前版本                            |
| Channel 切换（升级） | 从 Stable 切到 Nightly/Canary，应检测到更高版本         |
| Channel 切换（降级） | 从 Canary 切到 Stable，`allowDowngrade` 应自动设为 true |
| 下载失败             | 删除 server/{channel}/{version}/ 中的 DMG 文件          |
| 网络错误             | 停止本地服务器                                          |
| Manifest 不存在      | 删除对应的 {channel}-mac.yml                            |

---

## 关于 macOS 签名验证

### Gatekeeper

本地测试的包未经签名和公证，macOS 会阻止运行。解决方法：

```bash
# 临时禁用 Gatekeeper（推荐，测试完成后务必重新启用）
sudo spctl --master-disable

# 测试完成后
sudo spctl --master-enable
```

或手动移除隔离属性：

```bash
xattr -cr /path/to/YourApp.app
```

### Squirrel.Mac 更新安装限制

**本地未签名构建无法完成更新的安装步骤。** Squirrel.Mac 要求更新包的签名与当前运行 app 的 designated requirement 匹配。ad-hoc 签名的 DR 包含 `cdhash`（二进制哈希），不同构建的哈希必定不同，因此校验必然失败。

这意味着本地测试能验证到 **下载完成** 为止，但无法安装。CI 中有真实 Apple Developer 证书，不存在此问题。

**可验证的部分（通过日志）：**

```bash
tail -f ~/Library/Logs/lobehub-desktop-dev/main.log | grep -E 'Switching|Configuring|channel|checking'
```

- Channel 切换: `Switching update channel: stable -> canary`
- Feed URL 切换: `Configuring generic provider for canary channel`
- Manifest 匹配: `Channel set to: canary (will look for canary-mac.yml)`
- 更新检测: `Update available: x.y.z` 或 `Update not available`

---

## 故障排除

### 1. Channel 切换后仍请求旧渠道

- 确认启动应用时设置了 `UPDATE_SERVER_URL=http://localhost:8787`
- 查看日志确认 `configureUpdateProvider` 被调用：`grep 'Configuring generic' ~/Library/Logs/lobehub-desktop-dev/main.log`

### 2. 更新检测不到

- 确认对应渠道的 manifest 存在：`curl http://localhost:8787/stable/stable-mac.yml`
- 确认 manifest 中的版本号大于当前版本

### 3. 服务器启动失败

```bash
# 检查端口是否被占用
lsof -i :8787

# 使用其他端口
PORT=9000 ./start-server.sh
```

---

## 注意事项

⚠️ **安全提醒**：

1. 测试完成后务必重新启用 Gatekeeper
2. 这些脚本仅用于本地开发测试
3. 不要将未签名的包分发给其他用户
