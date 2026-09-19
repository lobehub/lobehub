# Core OTA 本地 E2E（打包态）

在本机打一个 arm64 的壳 + 内置 core（v1），再用本地 feed 依次发布 renderer-only（v2，reload）
和 main 变更（v3，relaunch），最后验证篡改拒绝和 boot 回滚。所有命令在 `apps/desktop/` 下执行。

产物都在 `release/core-ota-e2e/`：`priv.pem`/`pub.pem`、`app/`（打包结果）、`core-v1..v3/`、`feed/`。
app 名固定为 `lobehub-core-ota-e2e`，userData 在 `~/Library/Application Support/lobehub-core-ota-e2e`，
日志在 `~/Library/Logs/lobehub-core-ota-e2e/main.log`，与开发实例互不干扰。

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

期望：壳日志 `core 1.0.0-core.2 rejected: ... hash mismatch`，回退到 `previous`（1.0.0-core.1）。

## 5. boot 失败回滚

直接改 `cores/<v>/` 里的文件会被壳的 hash 校验拦下（等于第 4 步），所以发布一个签名有效但 renderer 永远不 mount 的 v4：

```bash
node scripts/core-ota-test/run.mjs v4 # index.html 只引一个 js 资源并 throw，seq 3，reload
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.checkNow')"
node scripts/core-ota-test/run.mjs eval "window.electronAPI.invoke('rendererOta.applyNow')"
```

期望：3 s 内 `Core OTA rolled back {coldBoot: false, reason: 'load-timeout'}`，pointer `blacklist` 含 `1.0.0-core.3`，
窗口回到 v3 的 renderer。冷启动检查：把 `pointer.current` 手动指回 `1.0.0-core.3`、删掉 `boot.json` 再 `launch`，
60 s 后 `Core OTA rolled back {coldBoot: true}` 并自动 relaunch 到上一版本。

## 辅助

`launch` 带 `--remote-debugging-port=9333`，`run.mjs eval "<js>"` 在主窗口里求值（`window.electronAPI.invoke('rendererOta.<applyNow|checkNow|getStatus>')`），
`run.mjs eval --shot <file.png>` 截主窗口。`tamper` 改 `cores/1.0.0-core.2/dist/main/index.js` 一行。
onboarding 页不挂 UpdateNotification，toast 要登录后才看得到；用 `eval` 触发 IPC 即可。

## 收尾

```bash
node scripts/core-ota-test/run.mjs kill
node scripts/core-ota-test/run.mjs restore
```
