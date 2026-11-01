# Core OTA 本地 E2E（打包态）

在本机打一个 arm64 的壳 + 内置 core（v1），再用本地 feed 依次发布 renderer-only（v2，reload）
和 main 变更（v3，relaunch），最后验证篡改拒绝和 boot 回滚。
默认使用 Canary 通道（macOS Stable 仅整包升级）；可用 `CORE_OTA_TEST_CHANNEL` 和 `CORE_OTA_TEST_PRODUCT` 隔离不同测试实例；`CORE_OTA_TEST_PORT` / `CORE_OTA_TEST_CDP_PORT` 可避开已有服务。
这里的 v1–v4 是测试版本号，传输协议均为 schemaVersion 4，使用 `<channel>/<appVersion>/core-v4/<platform>` feed 和 HTTP Range；内置业务位于 `core.asar`，CLI 位于 `core.asar.unpacked/cli/dist/index.js`。所有命令在 `apps/desktop/` 下执行。

产物都在 `release/core-ota-e2e/`：`priv.pem`/`pub.pem`、`app/`（打包结果）、`core-v1..v3/`、`feed/`。
app 名固定为 `lobehub-core-ota-e2e`，userData 在 `~/Library/Application Support/lobehub-core-ota-e2e`，
日志在 `~/Library/Logs/lobehub-core-ota-e2e/main.log`，与开发实例互不干扰。

## 手动 pack 集成验证

```bash
bun run test:core-ota
```

这组验证执行真实 zstd 压缩、打包和磁盘 staging，覆盖跨版本复用、401 个文件增量、Range、补丁和损坏拒绝。
仅在修改 OTA 协议或发布前手动运行，不纳入默认 `test` / PR CI；独立配置允许每项最多 30 秒。
它验证正确性，不测量性能指标，因此不作为 benchmark。

## 1. 构建 v1（一次，约 10 分钟）

```bash
node scripts/core-ota-test/run.mjs keys
node scripts/core-ota-test/run.mjs build # dist/ 已存在则跳过 build:main；打包用 --dir，不签名不公证
```

`build` 会把 `package.json` 的 name/version 临时改成 `lobehub-core-ota-e2e`/`1.0.0`（Electron 用 name 决定 userData），结束后 `run.mjs restore` 还原。
壳的 `abi.json`、内置 core 的签名 manifest（seq 0）由 `electron-builder.mjs` 的 `beforePack` 生成；
`feed/` 里的 r0 与内置 core 字节一致。

## 2. renderer-only 更新（reload）

```bash
node scripts/core-ota-test/run.mjs v2      # index.html 加一个红色 "CORE V2" 角标，seq 1
node scripts/core-ota-test/run.mjs serve & # http://127.0.0.1:8787
node scripts/core-ota-test/run.mjs reset   # 清 userData/日志
node scripts/core-ota-test/run.mjs launch  # RENDERER_OTA_CHECK_DELAY=3000
```

期望：日志 `Core OTA staged {"applyMode":"reload",...}`；toast 点「刷新」或等 5 分钟空闲后窗口右上角出现 `CORE V2`；
`run.mjs state` 显示 `current: "1.0.0-core.1"`。

## 3. main 变更（relaunch）

```bash
node scripts/core-ota-test/run.mjs v3 # dist/main/index.js 追加 console.log('core v3')，seq 2
```

app 内触发检查（或等 60 分钟定时）→ 日志 `applyMode":"relaunch"` → toast「立即重启」→
重启后日志开头出现 `core v3`，`state` 显示 `current: "1.0.0-core.2"`，壳日志 `source: external`。

## 4. 篡改拒绝

```bash
node scripts/core-ota-test/run.mjs kill
node scripts/core-ota-test/run.mjs tamper # 改 cores/1.0.0-core.2/dist/main/index.js
node scripts/core-ota-test/run.mjs launch
```

期望：壳日志 `core 1.0.0-core.2 rejected: size mismatch dist/main/index.js`，回退到 `previous`（1.0.0-core.1）。

## 5. boot 失败回滚

直接改 `cores/<v>/` 里的文件并改变大小会被壳的 size 校验拦下（等于第 4 步），所以发布一个签名有效但 renderer 永远不 mount 的 v4：

```bash
node scripts/core-ota-test/run.mjs v4 # index.html 只引一个 js 资源并 throw，seq 3，reload
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.checkNow')"
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.applyNow')"
```

期望：3 s 内 `Core OTA rolled back {coldBoot: false, reason: 'load-timeout'}`，pointer `blacklist` 含 `1.0.0-core.3`，
窗口回到 v3 的 renderer。冷启动检查：把 `pointer.current` 手动指回 `1.0.0-core.3`、删掉 `boot.json` 再 `launch`，
60 s 后 `Core OTA rolled back {coldBoot: true}` 并自动 relaunch 到上一版本。

## 6. 壳救援（内置 core 坏掉）

```bash
R=release/core-ota-e2e/app/mac-arm64/lobehub-core-ota-e2e.app/Contents/Resources
mv "$R/core.asar" "$R/core.asar.saved" # 仅限独立 E2E 应用，结束后移回
# --dir 打包没有 app-update.yml，救援靠它拿 feed 地址
printf 'provider: generic\nurl: http://127.0.0.1:8787/canary\n' > $R/app-update.yml
```

在 `feed/` 放一个 `canary/appcast-arm64.xml`（当前 buildVersion 走「已是最新」，更高版本走 Sparkle 下载和安装；包使用测试公钥对应的 EdDSA 签名）。

期望：`launch` 后出现救援窗口和对话框，`userData/logs/shell-rescue.log` 记录原始错误和检查结果；
`boot.json` 为 `builtin@1.0.0` failures 3，下一次启动不再加载 core 直接进救援；「重试启动」清掉计数并真正重新加载 core。
假 zip 会让 Sparkle 报 `Could not locate update bundle`，此时应回到失败对话框而不是卡在「正在安装」。

## 辅助

### 已暂存更新被新版本替换

完成第 1 步构建并启动本地 feed 后，用 `staged <b|c> <reload|relaunch>` 发布两份基于内置 v1 的签名更新。B 为 `1.0.0-core.10`，C 为 `1.0.0-core.11`；renderer 带有 `STAGED B/C` 标记，relaunch 版本还会输出对应的 main 日志。不要先应用 B。

每组从独立测试 App 的干净 userData 开始（`reset` 只用于该测试 App），依次验证下表三种组合：

| B        | C        | 应用 C 的预期                            |
| -------- | -------- | ---------------------------------------- |
| reload   | reload   | 原进程刷新到 C                           |
| relaunch | relaunch | 重启直接运行 C，B 不作为回滚目标且被清理 |
| relaunch | reload   | 原进程刷新到 C，退出后冷启动也不运行 B   |

以下以第三组为例，另两组替换 `staged` 的 mode 参数：

```bash
node scripts/core-ota-test/run.mjs kill
node scripts/core-ota-test/run.mjs reset
node scripts/core-ota-test/run.mjs staged b relaunch
node scripts/core-ota-test/run.mjs launch
# 等待日志确认 B staged；再次检查同一 B 应保留暂存状态
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.checkNow')"
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.getStatus')"
node scripts/core-ota-test/run.mjs state
node scripts/core-ota-test/run.mjs staged c reload
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.checkNow')"
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.getStatus')"
node scripts/core-ota-test/run.mjs state
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.applyNow')"
# 截图应显示 STAGED C reload；main 日志不应出现 STAGED B relaunch
node scripts/core-ota-test/run.mjs eval --shot /tmp/core-ota-staged-c.png
node scripts/core-ota-test/run.mjs kill
node scripts/core-ota-test/run.mjs launch
node scripts/core-ota-test/run.mjs state
```

记录 B/C manifest tree、暂存前后状态、pointer、main 日志和进程 PID，并打开截图确认实际加载的是 C。`relaunch → reload` 在应用前应恢复 `current/previous` 为内置基线、`staged` 为 C；`relaunch → relaunch` 应直接把 `current` 指向 C、`previous` 保留真正运行过的版本，不能指向 B。这里通过真实 IPC 加速检查，不修改更新逻辑，也不声称覆盖一小时定时器或已登录后的通知 UI。

`launch` 带 `--remote-debugging-port=9333`，`run.mjs eval "<js>"` 在主窗口里求值（`window.electronAPI.invoke('rendererOta.<applyNow|checkNow|getStatus>')`），
`run.mjs eval --shot <file.png>` 截主窗口。`tamper` 改 `cores/1.0.0-core.2/dist/main/index.js` 一行。
onboarding 页不挂 UpdateNotification，toast 要登录后才看得到；用 `eval` 触发 IPC 即可。

## 收尾

```bash
node scripts/core-ota-test/run.mjs kill
node scripts/core-ota-test/run.mjs restore
```
