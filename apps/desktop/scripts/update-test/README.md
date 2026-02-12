# 本地更新测试指南

本目录包含用于在本地测试 Desktop 应用更新功能的工具和脚本。

## 目录结构

```
scripts/update-test/
├── README.md                    # 本文档
├── setup.sh                     # 一键设置脚本
├── start-server.sh              # 启动本地更新服务器
├── stop-server.sh               # 停止本地更新服务器
├── generate-manifest.sh         # 生成 manifest 和目录结构
├── dev-app-update.local.yml     # 本地测试用的更新配置模板
└── server/                      # 本地服务器文件目录 (自动生成)
    ├── stable/                  # stable 渠道
    │   ├── latest-mac.yml
    │   └── {version}/
    │       ├── xxx.dmg
    │       └── xxx.zip
    ├── beta/                    # beta 渠道
    │   └── ...
    └── nightly/                 # nightly 渠道
        └── ...
```

## 快速开始

### 1. 首次设置

```bash
cd apps/desktop/scripts/update-test
chmod +x *.sh
./setup.sh
```

### 2. 构建测试包

```bash
# 回到 desktop 目录
cd ../..

# 构建未签名的本地测试包
bun run build:main
bun run package:local
```

如果需要模拟 CI 的渠道构建（Nightly / Beta / Stable），可以使用根目录脚本：

```bash
# 回到仓库根目录
cd ../../..

# 指定渠道与版本号
npm run desktop:build-channel -- nightly 2.1.0-nightly.1
npm run desktop:build-channel -- beta 2.1.0-beta.1
npm run desktop:build-channel -- stable 2.1.0

# 保留 package.json 与 icon 变更
npm run desktop:build-channel -- stable 2.1.0 --keep-changes
```

### 3. 生成更新文件

```bash
cd scripts/update-test

# 从 release 目录自动检测并生成 (默认 stable 渠道)
./generate-manifest.sh --from-release

# 指定版本号 (用于模拟更新)
./generate-manifest.sh --from-release -v 0.0.1

# 指定渠道
./generate-manifest.sh --from-release -c beta -v 2.1.0-beta.1
```

### 4. 启动本地服务器

```bash
./start-server.sh
# 服务器默认在 http://localhost:8787 启动
```

### 5. 配置应用使用本地服务器

```bash
# 复制本地测试配置到 desktop 根目录
cp dev-app-update.local.yml ../../dev-app-update.yml

# 或者直接编辑 dev-app-update.yml，确保 URL 指向正确的渠道:
# url: http://localhost:8787/stable
```

### 6. 运行应用测试

```bash
cd ../..
bun run dev
```

### 7. 测试完成后

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
  -c, --channel CHANNEL    指定渠道 (stable|beta|nightly, 默认: stable)
  -d, --dmg FILE           指定 DMG 文件名
  -z, --zip FILE           指定 ZIP 文件名
  -n, --notes TEXT         指定 release notes
  -f, --from-release       从 release 目录自动复制文件
  -h, --help               显示帮助信息

示例:
  ./generate-manifest.sh --from-release
  ./generate-manifest.sh -v 2.0.1 -c stable --from-release
  ./generate-manifest.sh -v 2.1.0-beta.1 -c beta --from-release
```

---

## 详细说明

### 关于 macOS 签名验证

本地测试的包未经签名和公证，macOS 会阻止运行。解决方法：

#### 方法 1：临时禁用 Gatekeeper（推荐）

```bash
# 禁用
sudo spctl --master-disable

# 测试完成后务必重新启用！
sudo spctl --master-enable
```

#### 方法 2：手动移除隔离属性

```bash
# 对下载的 DMG 或解压后的 .app 执行
xattr -cr /path/to/YourApp.app
```

#### 方法 3：系统偏好设置

1. 打开「系统偏好设置」→「安全性与隐私」→「通用」
2. 点击「仍要打开」允许未签名的应用

### 自定义 Release Notes

编辑 `server/{channel}/latest-mac.yml` 中的 `releaseNotes` 字段：

```yaml
releaseNotes: |
  ## 🎉 v2.0.1 测试版本

  ### ✨ 新功能
  - 功能 A
  - 功能 B

  ### 🐛 修复
  - 修复问题 X
```

### 测试不同场景

| 场景         | 操作                                                  |
| ------------ | ----------------------------------------------------- |
| 有新版本可用 | 设置 manifest 中的 `version` 大于当前应用版本 (0.0.0) |
| 无新版本     | 设置 `version` 小于或等于当前版本                     |
| 下载失败     | 删除 server/{channel}/{version}/ 中的 DMG 文件        |
| 网络错误     | 停止本地服务器                                        |
| 测试不同渠道 | 修改 dev-app-update.yml 中的 URL 指向不同渠道         |

### 环境变量

也可以通过环境变量指定更新服务器：

```bash
UPDATE_SERVER_URL=http://localhost:8787/stable bun run dev
```

---

## 故障排除

### 1. 服务器启动失败

```bash
# 检查端口是否被占用
lsof -i :8787

# 使用其他端口
PORT=9000 ./start-server.sh
```

### 2. 更新检测不到

- 确认 `dev-app-update.yml` 中的 URL 包含渠道路径 (如 `/stable`)
- 确认 manifest 中的版本号大于当前版本 (0.0.0)
- 查看日志：`tail -f ~/Library/Logs/lobehub-desktop-dev/main.log`

### 3. 请求了错误的 yml 文件

- 如果请求的是 `stable-mac.yml` 而不是 `latest-mac.yml`，说明代码中设置了 channel
- 确保在 dev 模式下运行，代码不会设置 `autoUpdater.channel`

### 4. 下载后无法安装

- 确认已禁用 Gatekeeper 或移除隔离属性
- 确认 DMG 文件完整

---

## 注意事项

⚠️ **安全提醒**：

1. 测试完成后务必重新启用 Gatekeeper
2. 这些脚本仅用于本地开发测试
3. 不要将未签名的包分发给其他用户
