# Desktop 内置 ASAR 与 Pack Range OTA Spec

状态：已实现，本地打包态与真实 R2 测试桶验证通过；发布前待自定义域名 CDN、完整安装包与安装性能验收。v4 使用独立 feed；旧 v3 协议保留。

## 1. 目标与决策

将安装分发格式和 OTA 传输协议分开：

- 安装包内用小型 `app.asar` 引导器和 `core.asar` 业务归档，减少安装时的小文件创建。
- OTA 继续按文件内容哈希复用，保留已有文件级 Zstd 字典补丁能力。
- R2 使用不可变 `.pack`：将独立 Zstd frame 原样拼接，通过签名 manifest 记录偏移和长度。
- 客户端只下载缺失内容对应的 Range，在用户数据目录组装完整散文件版本。
- 不使用 ZIP，不对整个 ASAR 做二进制差分，不对整个 pack 再整体压缩。
- 跳级直接构建目标版本，不依赖中间版本或连续补丁链。
- 取消 “缺失对象超过 400 个就全量下载”；依据传输大小与合并后的请求数选择下载计划。

不在本次范围：运行时将 ASAR 与增量文件叠加为虚拟文件系统、修改正在使用的归档、跨版本全局 pack 去重服务、自定义归档压缩算法。

## 2. 改造前实现与问题

相关入口：

| 入口                                                  | 当前行为                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `apps/desktop/electron-builder.mjs`                   | `core-dist` 通过 `extraResources` 作为散文件进入安装包          |
| `apps/desktop/shell/main.js`、`core-loader.js`        | 选择内置或外部 core，处理启动健康检查与回退                     |
| `apps/desktop/scripts/buildCore.mjs`                  | 生成独立 `.zst` 对象、文件补丁和 ZIP 全量包                     |
| `apps/desktop/scripts/buildCoreManifest.mjs`          | 生成文件树及签名 manifest                                       |
| `.github/actions/desktop-publish-core-ota/action.yml` | 用 `aws s3 sync --size-only` 上传 CAS 和全量包，最后发布 latest |
| `coreOta/manifest.ts`                                 | schemaVersion 3，严格 schema                                    |
| `coreOta/store.ts`                                    | 按哈希复用，8 路并发，缺失超过 400 或下载失败时回退 ZIP         |
| `coreOta/zstdPatch.ts`                                | 以旧文件为字典解压补丁                                          |
| `coreOta/CoreUpdateManager.ts`                        | 校验更新条件、ABI、灰度，决定 reload 或 relaunch                |

上述 `coreOta/` 位于 `apps/desktop/src/main/core/infrastructure/`。

400 是请求数量兜底，不反映实际传输成本：401 个很小的文件也会触发全量下载。独立对象便于复用，但增加对象数量和发布请求开销。当前 sync 支持并发和跳过已有对象，不能将其描述为每次串行重传所有文件。

## 3. 安装与运行布局

```text
安装目录 / Resources
├── app.asar              引导器及其依赖
├── core.asar             内置业务 core 和 manifest
└── 外置运行资源          原生模块、CLI 或需真实路径的资源

用户数据目录 / core-ota
├── store/<sha256>        已校验、解压后的文件内容
├── cores/<version>/     完整外部版本，散文件布局
├── pointer.json         current / previous / staged
└── boot.json            启动健康状态
```

内置 manifest 的逻辑文件路径不因 ASAR 包装而变化。内置 core 的读取根改为 `core.asar`，Electron 通过 ASAR-aware 文件 API 读取内容。首次安装启动不先展开整个 core。

不能假设所有消费者都支持 ASAR。实施前必须核对主进程入口、preload、renderer 自定义协议、CLI wrapper、独立 Node 进程和子进程 `cwd`。需真实路径的资源保留外置，并显式定义其读取位置；不得把 CLI 或原生运行能力藏在首次启动全量解包中。

安装布局变化属于 shell 能力变化，通过完整应用发布交付，并纳入 shell ABI 输入。新的 shell 必须能验证 v4 manifest；旧 shell 不应被切换到无法理解的外部 core。

完整升级首次启动时，旧 ABI 的 OTA 指针失效，应用使用新的内置 core。启动 GC 删除旧 core 版本目录、staging 和未被保留版本引用的对象缓存；不再跨 ABI 保留缓存。已有 `renderer-ota` / `renderer-ota-v2` 目录也会清理。正在运行的外部 core 及 `current`、`previous`、`staged` 引用仍受保护，应用设置和业务数据不属于清理范围。

## 4. Pack 格式和 manifest v4

### 4.1 Pack 字节布局

```text
┌────────────────┬────────────────┬────────────────┐
│ 独立 Zstd A    │ 独立 Zstd B    │ 独立 Zstd C    │
└────────────────┴────────────────┴────────────────┘
0                offset B         offset C
```

pack 是字节容器，不内嵌文件系统，不要求客户端扫描 frame 边界。位置只由签名索引确定。每个 frame 可独立解码；文件补丁 frame 则要求精确的旧文件字典。

首版每个目标版本、平台提供一个包含全部唯一文件内容的 objects pack，按内容 SHA-256 排序。可选的 patches pack 按 `(fromSha256, toSha256)` 排序。固定压缩参数，不包含时间戳，保证相同输入可复现。

pack 使用自身完整字节的 SHA-256 命名，例如 `packs/<sha256>.pack`，不可原地覆盖。首版每次发布上传完整目标 objects pack：减少上传对象数量，但不承诺减少上传字节或跨版本远端存储量。不同版本的相同文件仍可能重复存储；客户端本地哈希复用不受影响。

### 4.2 签名数据

保留版本、channel、platform、seq、shellAbi、rollout、applyMode、tree 等语义，新增 v4 传输描述，替换 v3 的 ZIP `full` 和独立对象定位约定。

| 字段            | 内容                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `schemaVersion` | `4`                                                                            |
| `packs`         | pack 描述列表：`sha256`、相对 `path`、完整 `size`                              |
| `objects`       | 按内容哈希索引：`packSha256`、`offset`、`length`、`compressedSha256`           |
| `patches`       | `fromSha256`、`toSha256`、`packSha256`、`offset`、`length`、`compressedSha256` |
| `tree`          | 每个逻辑文件的 `path`、解压后 `sha256`、解压后 `size`                          |

v4 中 objects 的编码固定为独立 Zstd，patches 固定为当前 Zstd 字典补丁，不增加不需要的可插拔编码机制。索引直接放在 manifest 中，并随所有定位信息一起参与现有 canonical JSON 签名。

必须满足：

- 每个 tree 内容哈希都有完整 object 描述；补丁只是优化，不能成为获取目标内容的唯一方式。
- 相同内容哈希只有一个 object frame，多个目标路径可以共享它。
- offset、length、size 为安全整数；offset 非负，length 为正，范围不可溢出或越过 pack。
- pack 引用必须存在，路径必须符合受限的相对路径格式；沿用可信更新源策略，不从未验证数据任意构造下载地址。
- frame 范围不重叠，解压后大小与 tree 声明一致；重复路径、非法路径、大小矛盾必须拒绝。
- 部分下载验证 `compressedSha256`，解码后验证内容 SHA-256 和大小。不能用完整 pack 哈希冒充片段校验。
- 完整下载额外验证 pack SHA-256。限制 manifest、响应、解压输出的资源消耗，不能先无限分配再检查大小。

## 5. 更新和跳级流程

```text
┌─────────────────────────────────┐
│ 验证目标 manifest、ABI、更新条件 │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│ 建立内置 ASAR + 当前 core + 缓存 │
│ 的可复用内容索引                │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│ 找出缺失内容，选择补丁或完整块  │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│ 规划 Range / 全包下载并校验     │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│ 组装临时目录，校验并标记 staged │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│ 按现有 reload / relaunch 应用   │
│ 健康检查失败则回退              │
└─────────────────────────────────┘
```

以 v1 直接升级 v5 为例：

1. 只读取 v5 目标清单，不遍历 v2、v3、v4。
2. v5 文件哈希在 v1 内置 ASAR、当前外部版本或缓存中存在时直接复用。
3. 本地存在精确 `fromSha256`，且目标 manifest 提供适用补丁时，补丁参与下载计划；没有匹配字典则选择目标完整 object。
4. 所需完整 object 都能从 v5 objects pack 获得，因此缺少历史版本不会阻断更新。
5. 目标清单中已删除的路径不进入新目录；重命名但内容相同的文件不需下载。

不追逐补丁链。跳级可能降低补丁命中率、增加下载量，但不改变可达性。shellAbi 不兼容仍需完整应用更新。

本地对象只有通过内容校验才可作为有效复用来源；缓存存在不等于内容正确。发现损坏后重新获取目标内容，不能循环复用坏缓存。

## 6. 下载计划：替换 400 阈值

不再通过文件数量直接触发全量下载。

1. 剔除已验证的本地内容，按哈希去重。
2. 对缺失内容生成完整 object 计划；另生成包含可用、较小补丁的候选计划。
3. 按 pack 和 offset 排序，将重叠、连续范围合并。
4. 非连续范围仅在多下载间隙字节的成本小于节省请求的收益时合并，且不得超过单次请求的内存 / 流式处理预算。
5. 比较完整 object Range、补丁混合 Range、完整 objects pack 三类可行计划，选择估计成本最低者。全包候选只下载 objects pack，不必下载 patches pack。

使用可测试的估算：

```text
预计下载耗时 ≈ 传输字节数 / 估计吞吐量
             + ceil(请求数 / 并发数) × 估计请求延迟
```

这是启发式估算，不是 SLA。复用本次会话已完成请求的观测值；冷启动用明确的内部默认值。实施时根据目标网络基准确定默认值并记录，不引入长期遥测服务或用户配置项。并发初始沿用现有 8 路。下载大小必须使用压缩片段大小，并包含合并间隙；不能用 tree 的解压大小替代。

单个 Range 失败只重试该范围，有限重试后报告失败；补丁获取或应用失败时可改取对应完整 object。不得因一个失败请求直接隐式下载全量包。重新规划只针对尚缺内容。

## 7. HTTP Range 与错误处理

- 每次请求一个连续范围：`Range: bytes=<offset>-<offset+length-1>`；不依赖 multipart multi-range。
- pack 使用二进制 Content-Type，不设置整体 gzip/br Content-Encoding；下载端和 CDN 必须保持索引所指向的原始字节表示。
- 对部分请求要求正确的 `206`、`Content-Range`、返回长度及总对象大小；错误、截断、越界响应不得进入对象缓存。
- 对 Range 返回 `200` 时，不把响应当片段解码。停止未受控的全包消费，明确重新规划一次受大小限制的全包下载；不能每个 Range 都重复接收整包。
- `416`、错误总长度或压缩块哈希不匹配按协议 / 完整性失败处理，不自动接受新的偏移或对象内容。
- 全量下载以流式方式写临时文件或有界解析，验证后再使用；不把整个 pack 与所有解压文件同时堆在内存中。
- 对象写入临时路径，校验通过后原子提交。应用退出或网络中断后可复用已提交对象，未校验片段可丢弃；首版不要求持久化 Range 断点续传。

上线前必须在真实分发域名验证冷缓存与热缓存 Range 行为。客户端收到片段不代表 CDN 也只回源该片段，必须分别记录客户端传输量与可观测的回源情况。

## 8. 本地组装、应用和回退

外部版本仍是完整目录，不是只包含修改文件的覆盖层：

- 内置 ASAR 中的复用文件必须读取并写出，不能硬链接归档内的虚拟路径。
- 当前外部版本、对象缓存的文件可优先硬链接，失败时复制；共享 inode 的已提交内容不得原地修改。
- 在新临时目录组装并检查入口资源及全部目标内容，再提交为版本目录和 staged 指针。
- 不删除或覆盖正在运行的 current/previous。相同版本已存在时验证后复用，损坏且被使用时拒绝危险替换。
- 保留现有 renderer-only reload 与业务主进程变更 relaunch 行为，校验各入口均切换到同一目标资源版本。
- 应用失败回退 previous，必要时回退内置 core；内置 ASAR 始终保持不变。
- GC 不得删除被 current、previous、staged 或正在下载 / 组装任务引用的内容。

首次 OTA 会将所需内置内容写成散文件，因此网络增量不等于磁盘增量。需评估内置 ASAR、外部版本、缓存、下载临时文件共同产生的峰值空间；磁盘不足必须安全失败，保留当前可运行版本。

## 9. 发布与兼容迁移

v3 为严格 schema，不能直接向原 `latest.json` 塞入 v4 字段。

- 旧客户端继续使用现有 v3 feed、独立 CAS 对象、补丁和 ZIP 全量包。ZIP 仅为旧协议兼容保留，不用于 v4。
- v4 使用单独路径，例如 `<channel>/<appVersion>/core-v4/<platform>/latest.json` 和 `versions/<version>.json`；pack 位于该协议空间下的 `packs/<sha256>.pack`。
- 第一版通过完整应用发布交付 ASAR 布局、新 loader 和 v4 客户端。旧客户端通过原完整应用更新链路迁移；不要求旧 loader 直接启动 v4 core。
- 兼容期同一业务构建可同时生成 v3/v4 产物，分别使用其适用的 ABI 和 manifest，不混用严格 schema。
- 发布顺序：全部 pack → 不可变版本 manifest → latest。保留现有 seq 防倒退、发布互斥与 channel/platform 隔离。
- 发布前验证所有引用的 pack 已完整可读，Range 与哈希正确；上传失败不得推进 latest。
- 停止 v3 发布及删除对象必须有明确的支持周期决策，不以新版本上线为删除依据。
- 新构建生成补丁时，旧内容获取也必须支持上一版 v4 索引和 Range，不能继续依赖已停止上传的 `/cas/objects/<sha>.zst`。
- pack 保留按仍受支持的版本 manifest 引用决定，保证下载中的版本及可回退版本不因清理失效。

## 10. 实施顺序

1. 实现 v4 schema、确定性 pack 构建、索引与签名，保留 v3 发布能力。
2. 实现 Range 获取、校验、有界解码、下载计划与逐文件失败处理；复用现有对象缓存和 Zstd 补丁。
3. 接入 ASAR 内置布局及各真实路径消费者，更新 loader 和 ABI 输入。
4. 接入 v4 发布与完整应用迁移，验证真实 R2/CDN 链路。
5. 完成性能对比与产品验收后灰度启用；旧协议退役单独决策。

## 11. 验收条件

行为测试必须验证结果与边界，不以静态索引快照替代：

| 场景                 | 必须满足                                                   |
| -------------------- | ---------------------------------------------------------- |
| 确定性构建           | 相同内容生成相同 pack 字节及偏移，所有 frame 可独立还原    |
| 部分更新             | 本地内容有效时不下载相应 frame；新目录与目标 tree 完全一致 |
| 跳级 v1 → v5         | 不请求中间 manifest；无适用补丁仍可通过目标完整块完成      |
| 补丁                 | 正确字典成功，错误字典或损坏补丁只回退对应 object          |
| 大量小文件           | 超过 400 个缺失但 Range 估算更便宜时仍选择 Range           |
| 接近全量             | 全包估算更便宜时选择 objects pack，不额外下载补丁包        |
| Range 合并           | 多余字节计入成本，按索引准确拆出各 frame                   |
| HTTP 异常            | 200/416、截断、错位、错误总长度和哈希失败不污染缓存        |
| 不可信索引           | 签名错误、越界、重复路径、输出超限均被拒绝                 |
| 损坏本地内容         | 坏缓存 / 复用文件被识别，重新获取后能完成更新              |
| 中断与空间不足       | 当前版本保持可用，重试复用已验证对象                       |
| 首次 ASAR → 外部版本 | 不下载未变内容，真实完成虚拟路径读取与散文件写出           |
| 外部版本 → 外部版本  | 复用不修改旧 inode；回退版本仍完整                         |
| 兼容                 | v3 继续读取原 feed；v4 不要求旧客户端理解新格式            |
| 发布失败             | pack 不完整或校验失败时 latest 不前移                      |

性能与产品证据：

- 使用相同业务产物对比散文件安装与内置 ASAR 安装；Windows 启用默认安全软件，macOS 使用真实分发包。
- 分别测安装 / 拷贝时间、首次可交互时间，不能把后台展开延迟隐藏到首次启动。
- 至少覆盖连续版本、跨多个版本、401+ 小文件变更、接近全量变更四种更新数据集。
- 记录发布对象数、上传字节、上传耗时；客户端请求数、补丁命中、下载字节、下载耗时、组装耗时、峰值内存和磁盘空间。
- 真实域名冷 / 热缓存验证 206 与字节边界；不以本地 mock 代替 R2/CDN 验收。
- 实际打开更新后的主窗口及相关入口，完成至少一次 relaunch、renderer reload 和失败回退验证。
- 不预先承诺性能倍数。默认计划参数和发布结论必须附真实测量依据。

本文为文档交付，不改产品行为，不要求本次运行产品 acceptance；实施交付时按仓库 acceptance 流程完成上述产品验证。

## 12. 协议参考

- [Electron ASAR 文件读取与限制](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [R2 S3 API 与 Range 支持](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 Workers API range 参数](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Range 请求与缓存行为](https://developers.cloudflare.com/cache/reference/range-requests/)

### R2 发布目录与清理边界

- 安装包与 OTA 统一归属于 `<channel>/<appVersion>/`。`appVersion` 是壳的 `shellVersion`，不是 OTA 的 `<appVersion>-<seq>`。客户端即使运行外置 core，也始终使用壳版本定位 feed。
- 每个 App 版本的 `core-v4/<platform>/` 下保存 `latest.json`、`versions/<otaVersion>.json`、`packs/<sha256>.pack`；补丁只使用同一 App 版本的前序 manifest，seq 也仅在该版本所有平台中递增。pack 路径保持相对 feed，不跨 App 版本引用。
- `<channel>/shell.json` 与完整安装包 updater manifest 是发现最新完整版本的固定入口，继续放在渠道根目录；`shell.json` 另存一份至 `<channel>/<appVersion>/shell.json`。v3 旧路径仅为已安装旧客户端保留，v4 不再向渠道根级 core 或全局 CAS 写入。
- 本次上线不自动删除线上历史对象。完整版本上线并确认新客户端使用版本目录后，再盘点渠道根级旧 `core/`、`core-v4/`、历史 renderer OTA、全局 `cas/` 等引用；明确保留版本、回滚窗口和下载宽限期后单独执行清理。仍受支持的旧客户端所需对象不得仅因层级过时删除。
- 淘汰某个 App 版本可整体删除 `<channel>/<appVersion>/`，同时检查渠道根级入口不再指向它。当前 App 版本内的 pack 不能按单个 OTA manifest 随意删除，需保留仍被支持快照引用的 pack。
