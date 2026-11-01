# Desktop OTA Renderer Overlay Spec

状态：设计待评审。依赖 #20211（启动时按大小校验），两者都修改 `verifyCandidate`，本改动叠在其分支上。

## 1. 目标与决策

OTA 版本不再在用户数据目录里展开完整的 renderer。renderer 的每个文件按内容哈希解析：未变化的内容直接从内置 `core.asar` 读取，变化的内容从已校验的对象缓存 `store/<sha256>` 读取。

- 只对 `dist/renderer/` 做 overlay。主进程、preload、CLI、`node_modules`、`resources` 仍按现有方式组装为真实文件，`require()`、CLI 和子进程不受影响。
- 不 hook Node 模块解析，不引入虚拟文件系统，不修改 `core.asar`。
- v4 manifest、pack、发布流程不变；服务端无改动。
- shell 目录属于 shellAbi 输入，本改动随完整安装包发布。

不在本次范围：主进程 overlay、跨版本 pack 去重、ASAR 形式的 OTA 版本。

## 2. 现状与数据

`CoreStore.assemble` 把目标 tree 的每个文件写入 `core-ota/cores/<version>/`：来自内置 `core.asar` 的文件整份复制，来自对象缓存或当前外部版本的文件优先硬链接。硬链接无法指向 ASAR 内部，所以装机后的首次 OTA 会把几乎所有内容从 `core.asar` 复制出来。

以 canary `2.2.19-canary.33-core.2` 为例（1,706 个文件，111.6 MB）：

| 部分                                                              | 文件数 | 大小    |
| ----------------------------------------------------------------- | ------ | ------- |
| `dist/renderer`                                                   | 1,609  | 95.5 MB |
| 其余（main、preload、CLI、node_modules、resources、package.json） | 97     | 16.1 MB |

实测：Windows（i5-13600KF、NVMe、Defender 关闭）一次首次 OTA，下载 10.3 MB（635 个对象）并组装 1,707 个文件，端到端 4.19 s。macOS 冷缓存下首次 OTA 组装 1.8–3.3 s。

## 3. 布局

```text
core-ota/
├── store/<sha256>          已校验的下载内容（含变化的 renderer 文件）
├── cores/<version>/        manifest.json + 非 renderer 文件（真实文件）
├── pointer.json
└── boot.json
```

`cores/<version>/dist/renderer/` 不再存在。版本的 renderer 由该版本 manifest 的 tree 定义，按哈希在内置 `core.asar` 或 `store/` 中找到内容。

## 4. Renderer 解析

新增 renderer 来源（source）的概念，替代 `RendererUrlManager` 里的目录字段：

- 目录来源：现有行为，用于内置 core 和开发模式，根目录为 `rendererDir`。
- tree 来源：由 manifest tree、`store/` 路径、内置 `core.asar` 路径及内置 manifest 构建。
  - 建立 `dist/renderer/` 下逻辑路径 → sha256 的映射，以及内置 manifest 的 sha256 → `core.asar` 内路径的映射。
  - 解析顺序：内置 `core.asar` 中相同哈希的文件优先（安装包内容，不受杀毒软件隔离影响），否则 `store/<sha256>`。
  - 不在 tree 中的路径返回空，保持现有 404 与 SPA 入口回退行为。

`ResolveRendererFilePath` 改为返回 `{ filePath, name }`：`filePath` 用于读取，`name` 为逻辑文件名，用于 MIME 推断和 `404.html` 判断。`store/<sha256>` 没有扩展名，不能再按读取路径推断 MIME。

启动时 `RendererUrlManager` 的默认来源：内置启动用目录来源；外部启动用 `__SHELL__.manifest` 构建的 tree 来源。`rendererDir` 在外部启动时指向不存在的目录，不再作为外部版本的读取根。

reload 应用、回滚和 “取消卸载的窗口继续加载上一版本 chunk” 的逻辑保持不变，只是把 `activeRendererDir` / `previousRendererDir` 换成来源对象。应用前的入口检查改为：三个入口 HTML 在该来源中都能解析。

## 5. 暂存（staging）

`CoreStore.stageCore` 的下载计划不变：缺失内容写入 `store/`，写入前已校验哈希。

`assemble` 调整：

- `dist/renderer/` 条目不写入版本目录；每个条目的哈希必须在 `store/` 中存在或在内置 manifest 中出现，否则暂存失败。
- 其余条目按现有方式硬链接或复制，并逐个校验 sha256。
- 入口资源检查改为：入口 HTML 引用的资源在 tree 中存在且可解析。
- `indexLocal(current)` 跳过 `dist/renderer/` 条目；这些内容由 `store/` 或内置索引提供。

对象缓存中 renderer 内容的完整性在写入 `store/` 时校验；复用内置内容前沿用现有的读取并校验。

## 6. 启动校验（shell）

`verifyCandidate` 在 #20211 的基础上区分两类条目：

- 非 renderer 条目：版本目录中的真实文件，检查存在且大小一致（#20211 现状）。
- renderer 条目：内置 manifest 中存在相同 sha256 即通过；否则 `store/<sha256>` 必须存在且大小一致。

内置 manifest 已由 `resolveCore` 读取。签名、shellAbi、路径安全、主入口检查不变。

## 7. GC、回滚与兼容

- GC 不变：保留 current、previous、staged、运行版本 manifest 引用的全部 `store/` 对象，renderer 内容随之保留。
- 回滚不变：previous 的 manifest 仍引用其 renderer 对象；回退到内置 core 使用目录来源。
- 完整安装包升级会替换 `core.asar`。新 shell 的 ABI 不同，旧指针失效；同一渠道内完整发布的 seq 高于已发布的 OTA，旧 OTA 版本也会被拒绝。即使两者都未触发，第 6 节的启动校验也会因为内置 manifest 中找不到哈希、且 store 中没有对象而拒绝该版本。
- 旧 shell 展开的完整版本目录不会被新 shell 使用（ABI 变化后指针失效，GC 清理）。

## 8. 风险

| 风险                                   | 处理                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 主进程其他代码直接读取 `dist/renderer` | 已排查：只有 `RendererUrlManager`、`CoreUpdateManager` 和 `CoreStore` 读取，均在本次改动范围内 |
| 从 `core.asar` 读取 renderer 文件失败  | 内置 renderer 当前已从 `core.asar` 提供，读取路径相同                                          |
| MIME 或 404 判断错误                   | 使用逻辑文件名，单测覆盖                                                                       |
| `store/` 对象被外部删除                | 启动校验拒绝该版本并回退；运行中缺失的资源返回 404，与当前缺文件行为一致                       |
| reload 后旧窗口加载旧 chunk            | 保留上一来源回退逻辑                                                                           |

## 9. 测试与验收

单测：

- tree 来源：内置优先、store 回退、tree 外路径、MIME 使用逻辑文件名。
- `assemble`：不写 renderer 条目；缺少内容时失败；入口资源检查。
- `verifyCandidate`：renderer 条目在内置 manifest 或 store 中通过；两者都没有时拒绝；store 对象大小不符时拒绝。
- `CoreUpdateManager`：reload 应用和回滚切换来源。

产品验收（打包态，macOS 和 Windows）：

- 装机后首次 OTA（reload 与 relaunch 各一次），主窗口、overlay、popup 均正常显示新内容。
- 连续 OTA、跳级 OTA、坏版本回滚到 previous 和内置 core。
- 记录改动前后：首次 OTA 写入文件数、写入字节、组装耗时、`core-ota` 磁盘占用，以及启动时 `resolveCore` 耗时。
