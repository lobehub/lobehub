# Renderer OTA 本地 E2E 测试

在本地完整走通 V2 协议：检查 → 下载一个 full/delta pack → staged toast → 刷新应用 → boot ping 提交，以及坏增量包自动改下 full pack。全程 dev 模式，不需要打包。

所有命令在 `apps/desktop/` 下执行。

## 协议边界

- V2 客户端只访问 `/<channel>/<appVersion>/renderer/v2`，本地状态只写入 `renderer-ota-v2`。
- `latest.json` / `versions/rN.json` 只负责选择 pack；目标文件 tree 与 delta 重建信息放在所选 ZIP 的 `meta.json` 中。
- 新构建不包含 V1 manifest/CAS 解析、URL fallback 或 pointer 迁移。
- 发布流程不会删除或覆盖远端既有 V1 feed/object；旧客户端继续停留在冻结的 V1 数据上。

## 0. 生成测试密钥 (一次)

```bash
node scripts/buildRendererManifest.mjs --gen-key > /tmp/ota-keys.pem
# 拆成两个文件:第一段 PRIVATE KEY 存 /tmp/ota-priv.pem,第二段 PUBLIC KEY 存 /tmp/ota-pub.pem
```

## 1. 构建 v0 renderer (内置基线)

```bash
npm run build:renderer
rm -rf /tmp/lobehub-ota-r0
cp -R dist/renderer /tmp/lobehub-ota-r0
```

## 2. 以「生产形态」启动 dev 应用

静态 renderer (不走 Vite 代理)+ 强制启用 OTA + 5 秒后首查:

```bash
DESKTOP_RENDERER_STATIC=1 \
  RENDERER_OTA_FORCE=1 \
  RENDERER_OTA_CHECK_DELAY=5000 \
  RENDERER_OTA_PUBLIC_KEY="$(cat /tmp/ota-pub.pem)" \
  UPDATE_SERVER_URL=http://127.0.0.1:8787 \
  npm run dev
```

此时 feed 还没起，日志应出现 `Renderer OTA check failed`(fetch 拒连) 或 404 —— 属预期。

## 3. 做一个肉眼可见的 renderer 改动并发布 r1

改任意 renderer 侧文案 (例如 `src/features/` 下某个标题), 然后:

```bash
npm run build:renderer
RENDERER_OTA_PRIVATE_KEY="$(cat /tmp/ota-priv.pem)" \
  node scripts/buildRendererManifest.mjs \
  --renderer=dist/renderer --out=/tmp/ota-feed --channel=stable --version=r1 \
  --from-dir=/tmp/lobehub-ota-r0 --from-version=r0
node scripts/renderer-ota-test/serveOta.mjs /tmp/ota-feed 8787
```

注意 `--channel` 要和应用实际渠道一致 (dev 默认 stable; feed 路径为
`/<channel>/<appVersion>/renderer/v2`)。

## 4. 验收 happy path

- 等下一轮检查，或在 DevTools console 手动触发:
  `await window.electronAPI.invoke('rendererOta.checkNow')`
- serveOta 日志：每次检查只下载一个 `packs/<sha256>.zip`；pack 内 `meta.json` 携带目标 tree，增量 pack 另含新增对象与 zstd dictionary patch
- 应用左下角出现「新版本已就绪，刷新即可使用」toast
- 点「立即刷新」: 窗口 reload (应用不重启), 改动的文案出现
- `~/Library/Application Support/<dev userData>/renderer-ota-v2/stable/pointer.json`:
  `current: "r1"`, 收到 boot ping 后 `pendingBootCheck: false`
- `versions/` 只留 current (+previous)

## 5. 验收回退路径

发布一个必挂的 r2: 构建后把 `dist/renderer/assets/entry-*.js` 的内容整体替换为
`throw new Error('boom')`(bundle 求值即抛 → 发不出 loaded ping; 注意不能删
script 引用 —— 没有 script 的 index.html 会被 staging 期完整性检查直接拒掉),
再按步骤 3 发布 `--version=r2`。

- `checkNow` → toast → 刷新：白屏 / 报错页
- **约 3 秒**自动回退 (loaded ping 未到); 若 bundle 能求值但挂不上，则 15 秒兜底
- `pointer.json`:`current: "r1"`,`blacklist: ["r2"]`
- 再次 `checkNow`:r2 被拉黑，不再下载

## 6. 验收 mainHash 门禁

改一行 `src/main/` 下的代码 (不重启应用), 重新按步骤 3 发布 r3:
manifest 的 mainHash 会与运行中应用注入的不一致 → 日志
`Manifest mainHash mismatch`, 拒绝更新。

## 已知差异 (dev vs 打包)

- dev 的 `MAIN_HASH` 在 vite 启动时计算；启动后改 main 源码不会让运行中的
  应用变 hash (打包产物没有这个问题)。
- `RENDERER_OTA_FORCE` / `RENDERER_OTA_CHECK_DELAY` 是运行时 env, 打包产物
  不设置即无效，不影响生产行为。
