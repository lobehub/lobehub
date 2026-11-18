# TFS / Azure DevOps Server 二次开发维护说明

全仓二开总清单及通用合并流程见 [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md)。本文只维护 `CUST-005` 的详细实现和验收信息。

> 此文件是从上游合并时的保留清单。接入保持在独立 `tfs` 目录；只在项目、环境、集成注册和运行时认证处增加接点。不要整文件用 upstream/ours 覆盖。本文的验证记录仅代表明确列出的检查，不能代替部署环境验收。

- 开发基线：`canary`，提交 `871dce63b7`；记录日期：2026-11-16。
- 交付形式：随包含本文的代码提交交付源码、回归测试和维护说明；镜像发布状态以 Actions 为准，目标服务器部署及验收另行核实。
- 维护原则：复用已有 SCM identity 表、项目表单、环境 `git` source、local-replica 和初始化链路；没有新增数据库表、数据库迁移或 npm 运行依赖。

## 1. 功能和边界

- 设置 → 集成 → TFS：每个 LobeHub 用户绑定一个个人 TFS 身份，可更新凭据或解绑；支持 NTLM 用户名 / 密码及 PAT。
- 身份唯一性由现有 `scm_identities` 两个唯一约束保证：`(provider,userId)` 和 `(provider,externalUserId)`。外部身份由 Collection 摘要和 TFS 服务端返回的 identity ID 组成，不能靠填写用户名冒充。
- 新建项目 → 从 TFS 创建：保留现有项目创建表单，增加项目 → Git 仓库 → 分支选择，以及手填 Git URL 后验证读取的入口。
- 项目添加环境、环境新建及编辑：支持 TFS Git 来源。仍使用 `sources: [{kind:'git',url,ref}]`，不新增环境类型或数据库表。
- 保存项目 / 环境、绑定仓库以及云端初始化时，验证当前调用者自己的 TFS 凭据与读取权限。环境公开只共享代码来源配置，不共享创建者的 TFS 凭据。
- 集成详情提供 PR / 评审讨论、构建时间线、发布环境状态和 TFVC 固定变更集文件读取；这些都是只读。
- 不实现 PR 合并、CI 自动唤醒、Service Hooks 订阅、触发构建、发布审批、TFVC workspace/get/check-in。GitHub 的现有自动化闭环保持原有实现。TFVC 不能作为 Git 来源。

### 实际页面中的使用顺序

1. 打开「设置 → 集成 → TFS / Azure DevOps」，点击「绑定个人账号」。Collection 由管理员固定配置，用户不能自行填任意服务地址；弹窗录入 NTLM 的域名 \ 用户名及密码，或选择 PAT 后录入令牌。服务端通过 identity 接口确认真实身份再加密保存，不信任用户自己声明的身份。
2. 绑定后可更新同一身份的凭据、解绑、浏览只读资源。换账号先解绑；一个外部 TFS 身份不能被第二位 LobeHub 用户绑定。管理员更换 / 删除 Collection 配置后，旧绑定仍保留解绑入口。
3. 项目列表的新建菜单选择「从 TFS 创建」。沿用原项目名称、标识和主 Agent 表单；先选择 TFS 项目、Git 仓库、分支，也可填写 `Collection/Project/_git/Repository` 后点击「验证并选择」。切换项目或修改手填地址会撤销先前选择，防止误提交旧仓库。
4. 项目内「添加环境」可以选 TFS；环境管理的新建 / 编辑来源使用 GitHub / TFS 平台选择器。环境编辑页沿用现有的选仓库即保存行为；保存后可以在分支字段手填分支。新建项目 / 新建环境中的选择器可读取并选择分支。
5. 项目 / 环境保存代码来源 URL 和分支，不保存个人凭据。其他成员读取 TFS 元数据或初始化代码时，必须绑定自己的 TFS 账号且在 TFS 上有权限。
6. 使用个人工作目录或临时云沙箱初始化代码。为了避免把私有 TFS 代码检出到所有成员可读的位置，公共 drive 不执行 TFS 初始化，会提示改用个人工作目录。旧版「环境实例构建」接口也明确拒绝 TFS 来源，不能把 NTLM 凭据送进仅支持 GitHub header 的旧构建协议。

### Agent 仓库上下文（2026-11-16 补全）

- TFS 独立生成 `<tfs_repositories>`，按当前用户 /workspace/topic 权限读取项目关联和当前选中环境。包含规范化仓库 URL、Collection、项目 / 仓库名、短分支、环境 ID、选中状态、已保存目录及个人绑定状态；不包含密码、PAT、环境变量或 Git credential helper。
- 服务端普通 agent、任务运行、云端及连接设备 CLI 通过共享项目上下文接点获取；浏览器内运行与桌面直接启动的本地 CLI 通过独立的 `tfs.agentContext` RPC 获取。同一 agent 在不同项目 / 对话运行时，不继承上一个项目的仓库信息。agent-share 访客不获取所有者仓库元数据。
- 已有对话也会读取项目当前关联的 TFS 来源。未选中代码环境的旧对话只知道来源，并明确提示需要选中环境才能自动初始化；不会静默覆盖原有工作位置。调用者自己的连接设备在第一次工具调用前，会把来源检出到选中的空工作目录；凭据只通过一次性 Git 配置环境传给该调用者的设备，目录已有文件或设备属于其他用户时拒绝。共享设备继续使用设备自身的凭据管理器。
- 只有 TFS 来源、且未选择旧 GitHub 仓库列表的云端 CLI 使用独立 DevOps 提示词，不再要求 GitHub 预克隆、`gh repo fork` 或自动推送。GitHub-only 和混合来源仍保持原来的 GitHub 路径，同时模型可以获得允许读取的 TFS 来源。
- 公开 TFS 来源的项目自动检出目录使用调用者个人盘。旧对话中仍记录 public、但路径等于 `projects/<projectId>/<environmentId>` 的自动项目目录，运行时改为同一调用者个人盘上的相对目录；不移动 / 复制已有公共盘数据。手动选择的公共文件夹和旧实例不自动改位置，保留禁止 TFS 公共检出的防护。
- 运行时再次检查调用者个人 TFS 权限。上下文中的已绑定只表示存在当前 Collection 的绑定，不代表授权、网络或 Git 初始化已成功；agent 必须检查实际目录和 remote。初始化命令结束后，服务端只在同一设备运行上下文中保留临时 Git 配置，并将它注入后续普通 Git 命令；请求结束即丢弃，不写入设备 Git 配置。后续云端 fetch/pull/push 使用独立受控入口，每次重新核对当前用户的个人身份及来源权限。

### 权限与后续 Git 操作补全（2026-11-16）

- 团队公开 agent 的上下文排除调用者自己的私有 TFS 环境，与初始化的可见性限制保持一致。普通 Topic、无 Topic 的任务、浏览器 RPC 和 CLI 共用该过滤；执行 agent 与 Topic agent 不同时，只要其中一个公开就应用限制。
- `tfs.git` 按登录用户和 Topic USE 权限执行；`tfs.gitOperation` 重新验证活动 Operation Token、成员资格和操作状态，目标固定为该 operation 自己的 Topic。不能通过参数选择别的用户、Topic 或任意仓库。
- `lh tfs git` 只操作当前选中环境的 Git 来源，`sourceIndex` 在仓库上下文中给出；无分支配置时要求明确分支。只支持 fetch、快进 pull 和非强制 push；本地 commit 仍用普通 Git，推送依用户授权执行。
- `clone`、`init` 和 credential helper 不作为 CLI 子命令提供。云端沙盒首次调用由服务端初始化器完成检出，Onlyboxes 也会先切换到选中的沙盒工作目录；CLI 只负责已有检出目录的后续网络 Git 操作。
- 执行前校验工作目录真实路径、Git 元数据路径及 origin 与所选来源相符。临时凭据只用于明确 URL 的网络操作，禁止重定向、hooks、Git trace 和自动维护；pull 合并前清除凭据。错误输出脱敏，Git 进程退出码失败会传递到 RPC 和 CLI。
- 普通云端工具的 `lh` 预处理器与 TFS 云端 CLI 启动路径下发不含个人 TFS 凭据的命令 shim，避免依赖公共 npm CLI 已发布新子命令；其他 `lh` 命令仍走原入口。桌面 / 自行安装的 CLI 同时增加原生子命令，但它明确操作云端目录，不代表给设备 Git 注入服务端密码。
- 临时沙箱即使带有 workspace 默认的 public 盘标记也可以操作；实际公共盘仍禁止。旧环境实例构建协议仍不承接 NTLM，继续明确拒绝并引导到工作目录初始化，不把个人密码塞进共享构建协议。

### 本期能力边界

- 保存来源时验证仓库读取权限，未对每次手填分支做存在性检查；分支不存在会在 Git 检出阶段报告失败。
- 初始化和后续网络 Git 操作各自临时使用 credential helper，不把密码交给 agent 或写入 Git 配置。云端后续操作使用 `lh tfs git fetch|pull|push --topic <topicId> --source <sourceIndex> --branch <branch>`；原生云端 `git fetch/push` 不会自动继承服务端身份。个人设备完成 TFS 初始化后，同一运行上下文的原生 Git 命令会继承临时配置，其他设备和运行场景继续使用自身凭据管理器。
- 解绑会影响后续 TFS 读取 / 初始化，不删除已保存项目、环境或用户已经检出的本地代码；它不是远程擦除功能。
- 本期只自动初始化网关管理的调用者个人连接设备的空工作目录，不覆盖已有本地文件，也不把服务端凭据写入设备 Git 配置。桌面直接启动、共享设备和用户自行管理的本地目录仍使用各自的 Git 凭据管理器。
- PR、构建、发布和 TFVC 是集成页里的只读浏览，没有接入 GitHub 现有事件自动化或验收 PR 自动完成流程。PR checks /policy 使用 Server 兼容的 preview API；无法读取和空检查分别显示，均不表示通过。
- 项目、分支等分页遵循 TFS 返回的 continuation token；PR 列表每页 20 条，构建日志分段最多 100 行，REST 响应有大小与超时上限，TFVC 文件限制为文本和固定变更集读取。不是完整的 TFS 客户端。

## 2. 部署配置

| 配置                 | 用途                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `TFS_COLLECTION_URL` | 唯一允许访问的 Collection URL，例如公司部署的 `https://server/DefaultCollection`。不包含项目名、凭据、query 或 fragment。未设置时不允许绑定。 |
| `TFS_API_VERSION`    | 默认 `6.0`；与实际 Azure DevOps Server 版本匹配。不要直接设成只适用于新版云服务的版本。                                                       |
| `KEY_VAULTS_SECRET`  | 复用应用既有 KeyVault 加密密钥；必须配置。丢失 / 更换后旧凭据无法解密，需要用户重新绑定。                                                     |
| 服务端 `curl`        | 必须安装且编译支持 NTLM，用于 REST 的多轮认证。凭据经 stdin 配置传递，不进入进程 argv。不跟随重定向，不关闭 TLS 校验。                        |
| 执行环境 `git`       | Git/libcurl 必须支持服务端认证方式，并可访问 TFS 网络和信任其证书。服务端能查询不代表云沙箱能连通内网。                                       |

### 使用部署管理脚本（当前 Docker 部署方式）

继续使用 [scripts/deploy-custom-image.sh](scripts/deploy-custom-image.sh) 拉取本 Fork 镜像：

- 脚本预制 `TFS_COLLECTION_URL=http://dev.tellhowsoft.com/DefaultCollection` 和 `TFS_API_VERSION=6.0`。用户提供的 `http://dev.tellhowsoft.com/` 是站点地址，REST 接入还需要 `DefaultCollection` 路径。
- 首次安装将这两项写入部署目录 `.env`。已有部署更新时不重写 `.env`，仅在 Compose 有效环境缺少对应键时补入托管 override；自定义 Collection、API 版本和空字符串禁用值均保留。
- 老部署的缺省值一旦写入 override，后续更改需编辑 override 对应项，或删掉对应项后在 `.env` 配置，不能只改优先级更低的 `.env`。
- 本 Fork 的 `Publish custom Docker image` 工作流已增加 `INSTALL_TFS_CURL=true`，构建时从 Debian 软件源安装 curl，验证含 NTLM，再把程序及动态库复制到最终运行层。用户不需要进入容器安装，也不需要在宿主机另外提供 curl 给应用。
- 脚本拉取已发布镜像，不编译本地源码。必须先确认包含本次改动的分支镜像已发布，服务器下载新版脚本后更新才会生效；代码提交 / 推送本身不代表服务器已部署。

`KEY_VAULTS_SECRET` 是应用原有加密密钥，**不是 TFS 密码，也不是向 TFS 申请的密钥**。首次使用本脚本安装时，脚本自动生成 32 字节随机数，以 Base64 写入部署目录的 `.env`；原先使用 `docker-compose/setup.sh` 安装的部署也有自己的密钥。已有安装继续使用原值，不在更新时重新生成。密码 / PAT 用它加密后存数据库；密钥与数据库应配套备份。若缺失或丢失，先从原配置 / 备份恢复，不能直接换一个新值期待旧密文正常解密。

### 自行构建或使用其他部署方式

根 `.env.example` 只有配置示例，没有真实账号。绕过本 Fork 发布工作流自行构建时需要显式启用：

```bash
docker build --build-arg INSTALL_TFS_CURL=true -t lobehub-tfs .
```

此开关为 distroless 运行层复制 curl 及其动态库；默认关闭以减少对上游镜像的影响。其他镜像 / 独立 backend 部署需要在其运行环境自行安装 curl，不能仅给 builder 安装。可在相同运行层执行 `curl --version`，确认含 NTLM。不要为连接失败而加 `--insecure` 或全局关闭证书验证；有内网 CA 时按实际运行环境安装证书。若上游改为单独部署 Hono server，也要同步把 Collection、加密密钥和 curl 配到真正执行 TFS router 的服务。

可在宿主机运行 `docker run --rm --entrypoint /usr/bin/curl ghcr.io/lichao0223/lobehub:canary --version` 检查镜像是否包含 NTLM；标签应换成实际部署标签。宿主机 `curl --version` 不能证明容器内可用。

构建维护：curl 二进制放 `/opt/tfs/bin/`，`ldd` 得到的依赖放 `/opt/tfs/lib/`，加载器固定放 `/opt/tfs/ld.so`；`/usr/bin/curl` 是调用该加载器和私有库的入口脚本。不要覆盖 BusyBox 的 libc（曾导致 `/bin/sh` 报 `GLIBC_2.38 not found`），也不要用 `cp --parents` 生成与其链接冲突的顶层 `/lib64` 目录。发布工作流先合并相同运行文件系统，执行真实用户 / 权限初始化命令，并以非 root 用户检查 Node 和 NTLM curl，再运行完整构建。

每个用户的用户名 / 密码或 PAT 在「设置 → 集成 → TFS → 绑定个人账号」录入，不写到部署环境变量，不录入共享环境的 env。PAT 至少需要所读取资源的权限；读取代码与构建 / 发布可能需要不同权限。

推荐在 HTTPS 上部署；已有 HTTP Collection 的 NTLM 兼容性不等于链路加密。严禁在文档、截图、日志或仓库中保存真实密码 / PAT。

### “个人工作目录 / 公共 drive / 旧实例” 与 Docker 的区别

Docker 是 **LobeHub 服务怎么部署**；下表是 **Agent 运行时把代码放在哪里**。用 Docker 部署仍可使用这些工作方式，二者不冲突。

| 源码中的概念                       | 实际产品中的含义                                                             | 当前 TFS 行为                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| personal drive / working directory | 个人网盘中的持久工作目录；与自己电脑上的本地目录是两回事                     | 支持通过环境初始化克隆；需要执行环境有 Git/NTLM 和 TFS 网络访问能力                                 |
| ephemeral sandbox                  | 对话的临时工作目录，随沙箱清理                                               | 支持通过环境初始化克隆；不承诺文件跨沙箱保留                                                        |
| public drive                       | 团队空间的公共网盘，成员共享文件                                             | 拒绝 TFS 初始化，避免有仓库权限的人把私有代码复制给没有仓库权限的成员                               |
| legacy environment instance build  | 已有 “环境目录 / 实例” 的预构建接口 `startInstanceBuild`，不是旧 Docker 容器 | 当前执行协议只承接原有 GitHub 认证形式，没有接通 TFS NTLM/PAT，明确拒绝；不是 TFS 服务端禁止 Docker |

账号一对一只能控制 “用谁的身份向 TFS 读取”，不能给已经克隆到共享盘的普通文件继续套用 TFS 仓库权限。解绑也不会擦除已克隆文件，所以不把个人权限自动扩大成团队文件共享权限。

当前页面的入口是输入框下方的工作目录选择器，其中有 “临时工作目录”“云盘”“代码仓库”；存储页叫 “个人网盘 / 公共网盘”。项目中的私有仓库环境选择会落到个人盘；普通非项目对话选择仓库环境使用临时沙箱。团队项目选择已发布的 TFS 环境时，项目自动目录与仓库选择器现在使用个人盘；同一路径的旧项目对话在运行时纠正。公开 GitHub 来源仍沿用公共盘。手动选择公共文件夹不在纠正范围内，仍会被防护拦截；单独选择空文件夹还会清除仓库选择。上述改动仍需实际部署的两用户隔离与页面 /agent 对话验收，不能仅凭自动化检查宣称所有入口已验收。

## 3. 文件清单和合并接点

### 新增独立模块（合并时完整保留）

| 路径                                                                                      | 职责                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/utils/src/tfs.ts`                                                               | Collection / 仓库 URL 解析、分支前缀归一化与地址边界                     |
| `packages/types/src/tfs.ts`                                                               | 跨端 TFS 类型，不包含服务端逻辑                                          |
| `apps/server/src/services/tfs/transport.ts`                                               | curl NTLM/PAT 只读传输、超时、大小限制和错误脱敏                         |
| `apps/server/src/services/tfs/client.ts`                                                  | REST 映射：身份、项目、仓库、分支、PR、构建、发布、TFVC                  |
| `apps/server/src/services/tfs/connection.ts`                                              | 加密个人连接、稳定身份唯一性、解绑                                       |
| `apps/server/src/services/tfs/{git,gitCommand,cliShim}.ts`                                | 后续受控 Git 操作、临时认证命令和随服务端交付的 CLI shim                 |
| `apps/server/src/routers/lambda/tfsGit.ts`                                                | 登录态 / 活动 operation 的 TFS Git RPC                                   |
| `apps/cli/src/commands/tfs.ts`                                                            | 原生 lh tfs git 命令                                                     |
| `apps/server/src/services/tfs/source.ts`                                                  | 保存来源前的当前用户访问验证                                             |
| `apps/server/src/routers/lambda/tfs.ts`                                                   | 登录态 RPC，只使用 ctx.userId，不接受客户端指定用户                      |
| `src/services/tfs.ts`                                                                     | 客户端 RPC 入口                                                          |
| `src/store/tfs/`                                                                          | local-replica 内存缓存，按已验证用户作用域与绑定版本隔离，不落盘         |
| `src/features/Tfs/`                                                                       | TFS 仓库选择与 GitHub/TFS 来源选择                                       |
| `src/features/Integrations/Tfs/`                                                          | 真实集成页中的个人绑定弹窗与资源浏览                                     |
| `apps/server/src/services/tfs/{transport,client}.test.ts`、`__tests__/connection.test.ts` | 真实本机 HTTP 传输、REST 结果语义和真实测试数据库上的个人绑定 / 权限回归 |
| `packages/utils/src/tfs.test.ts`                                                          | URL / Collection / 分支解析边界回归                                      |

后续认证接点：`apps/cli/src/program.ts` 注册 TFS 命令；`services/toolExecution/preprocessLhCommand.ts` 仅在 TFS 命令时加入独立派发；`services/heterogeneousAgent/sandboxRunner.ts` 仅为已授权 TFS 初始化套不含个人 TFS 凭据的 CLI wrapper；GitHub 的 setup、token 和默认命令分支保持原行为。`services/sandbox/commandResult.ts` 从原 service 模块原样提取进程结果解析，原 service 导出路径保持兼容。

### 修改既有文件（逐个手工合并接点）

| 路径                                                                                                        | 必须保留的增量                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/types/src/index.ts`、`scm.ts`                                                                     | 导出 TFS 类型，SCM provider 增加 tfs，个人凭据增加可选 tfs 字段                            |
| `.env.example`、`Dockerfile`                                                                                | 部署配置示例、可选 NTLM curl 运行时；合并后检查最终运行层是否仍包含 curl 动态库            |
| `.github/workflows/publish-custom-image.yml`、`scripts/deploy-custom-image.sh`                              | 本 Fork 镜像启用 NTLM curl；新安装和旧部署更新补缺省 Collection/API，不覆盖既有配置或密钥  |
| `scripts/deploy-custom-image.test.py`、`scripts/deploy-custom-image.md`                                     | 部署缺省值 / 保留已有配置和密钥的回归，面向 Docker 用户的操作说明                          |
| `CUSTOMIZATIONS.md`、`AGENTS.md`                                                                            | 通用二开功能总清单及合并前阅读入口；本文保留为 TFS 详细说明                                |
| `packages/database/src/models/scm/identity.ts`                                                              | 按 provider + 当前用户删除绑定，不能扩大删除范围                                           |
| `packages/database/src/models/environment.ts`                                                               | TFS 来源规范化；GitHub 旧路径继续工作                                                      |
| `apps/server/src/routers/lambda/index.ts`                                                                   | 注册 tfsRouter                                                                             |
| `apps/server/src/routers/lambda/_schema/environment.ts`                                                     | 新来源仅接受配置 Collection 的无凭据 Git URL                                               |
| `apps/server/src/routers/lambda/project.ts`                                                                 | 创建带仓库项目时先验证个人 TFS 读取权限                                                    |
| `apps/server/src/routers/lambda/projectWorkingDirectory.ts`                                                 | attachRepository 保存前验证个人 TFS 读取权限                                               |
| `apps/server/src/routers/lambda/environment.ts`                                                             | create/update 来源权限校验；旧 GitHub 不发 TFS 请求                                        |
| `apps/server/src/services/scm/cloneCredential.ts`                                                           | 运行时解析当前调用者个人 TFS 凭据，不能用环境所有者的身份                                  |
| `apps/server/src/services/scm/changeRequestUrl.ts`                                                          | 原 GitHub PR parser 的结果继续限定为 github，不能因扩展 provider union 而误宣称处理 TFS PR |
| `apps/server/src/services/sandbox/environmentInit.ts`、`session.ts`                                         | TFS 临时 Git 认证及失败时停止初始化；不持久化凭据                                          |
| `apps/server/src/services/sandbox/providers/market.ts`                                                      | TFS 认证初始化命令整体脱敏，不能只遮住部分 shell 引号                                      |
| `apps/server/src/routers/lambda/sandboxStorage/instanceBuild.ts`                                            | 对 TFS 明确拒绝旧环境实例构建协议，改用工作目录初始化                                      |
| `src/features/Integrations/{registry,index,Overview}.tsx`                                                   | 注册卡片、详情和个人绑定状态（registry 实际为 .ts）                                        |
| `src/features/Projects/List/index.tsx`                                                                      | 从 TFS 创建入口                                                                            |
| `src/features/Projects/CreateFromGithub/{index,Content}.tsx`                                                | 可选 provider，复用原表单，不能删除 GitHub 默认值                                          |
| `src/features/Projects/AddEnvironmentModal.tsx`                                                             | TFS 环境来源入口                                                                           |
| `src/features/EnvironmentManager/{CreateEnvironmentModal,EnvironmentForm}.tsx`、`repository.ts`             | 平台选择、仓库显示和分支处理                                                               |
| `src/store/utils/userDataStores.ts`                                                                         | 登出时清理 TFS 内存数据                                                                    |
| `src/features/ChatInput/ControlBar/sandboxEnvironmentOptions.ts`                                            | 环境列表显示 TFS 的 project/repository，避免把 Collection/\_git 路径当仓库名               |
| `apps/server/src/services/sandbox/__tests__/{environmentInit,session}.test.ts`、`providers/market.test.ts`  | TFS 未授权 / 公共 drive 停止初始化、授权恢复重试、clone 后清除 helper 与日志整体脱敏       |
| `packages/database/src/models/scm/__tests__/identity.test.ts`、`src/store/utils/userDataStores.test.ts`     | 一对一和解绑用户隔离；登出清理新增内存 store，补齐原用例的 store 边界 mock                 |
| `packages/locales/src/default/{integration,project}.ts`、`locales/{en-US,zh-CN}/{integration,project}.json` | 新功能文案，两种语言同批维护                                                               |

无需新增数据库迁移：复用既有 SCM identity 表及其唯一索引。不要将 tfs provider 改成 github，否则会混淆授权和关联数据。

## 4. 合并上游的操作顺序

1. 合并前提交 / 备份本地二开改动，保留本文和 TFS 独立目录；记录当前 upstream 基线。
2. 阅读上面的共享接点。若上游重命名了表单、路由、环境初始化或凭据服务，将接点迁移到新调用链；不要恢复整个旧版本文件覆盖上游。
3. 优先合并共享类型和 DB 模型，再服务 / 路由，再 store/UI 和文案。不要靠忽略类型错误强行通过。
4. 检查 `tfsRouter` 注册、provider union、来源 schema、项目创建 / 添加仓库 / 环境创建 / 环境更新四个保存入口、运行时当前用户身份、公共 drive 防护、登出缓存清理和凭据日志脱敏是否仍齐全。环境更新不是所有修改都要访问 TFS：只有提交了来源配置时才检查。
5. 运行下方回归检查，再用两个 LobeHub 测试用户验证隔离。第二个用户看不到第一个用户的凭据，不能复用其绑定；同一个外部 TFS identity 不能同时绑定两位用户。
6. 在实际部署分支上验收新建项目、环境编辑及一次真实仓库初始化。不要用静态原型或生产 debug proxy 替代。

## 5. 必须保持的安全 / 行为约束

- Collection 由管理员配置，不允许用户任意输入服务端地址，不跟随重定向。
- 仓库 URL 不含用户名、密码、PAT、query 或 fragment。`refs/heads/` 要转为 Git clone 接受的短分支名。
- 只从服务端身份接口确定绑定对象；唯一性检查与数据库唯一约束都需要保留。
- 密码 / PAT 不回传状态接口，不缓存到本地磁盘，不进入 Git origin、项目 / 环境记录或日志。
- 运行凭据只供初始化阶段 Git 使用，随后 unset；共享环境运行使用调用者个人身份。
- 服务端状态仅返回是否已绑定、登录名和更新时间等元数据。即使 Collection 变更导致旧凭据不可用，也应允许当前用户解绑；不能把凭据或密文当状态返回。
- TFS 授权失败不能静默降级成其他人的凭据或成功空初始化。
- 未授权提示不能留下阻止恢复的永久 failed marker；绑定个人账号后应能在下一次初始化重试。真正执行 clone /bootstrap 失败仍沿用原来的失败记录语义，需要新工作目录或按现有产品流程重置。
- PR 没有 checks 不等于通过策略；build completion 不等于成功；release 的每个环境独立展示。TFVC cutoff changeset 与文件最后修改版本可不同。

## 6. 验证记录

自动化检查与真实 TFS 读取分开记录。早期研究脚本 / 静态原型不作为本次实现的产品验收证据。

### 当前实现验证结果（2026-11-16）

已用新 TypeScript `TfsClient` 和生成的 sandbox 初始化命令连接实际配置的 TFS（只读）：

- 身份认证成功；读取到 19 个项目、RSMP 155 个 Git 仓库、分支第一页 100 条，并验证 continuation token 能读取第二页。
- 读取 PR 20 条、构建 20 条、发布 19 条；PR 详情、状态检查及策略接口、构建时间线（11 条）、发布环境（5 条）成功。状态检查 / 策略的空结果不解释为通过。
- 以固定 changeset 48860 读取 TFVC 文件成功，返回文件版本 32906；读取构建日志指定区间成功（最多 100 行）。
- 生成初始化脚本对 `go-file-server` 做 NTLM 浅克隆成功；检查 `.git/config` 未发现账号或密码。
- 已新增 URL 解析回归测试，覆盖凭据、query/fragment、错误 Collection 和编码路径穿越。

### 自动化回归

本轮权限与后续 Git 操作补全：26 个改动文件的 `bun run check --lint` 通过；临时 Vitest 配置下 22 个文件、283 项针对性测试通过，包含真实 smart HTTP Basic/PAT Git push / 快进 pull、拒绝非快进推送、错误 origin、凭据不落 Git 配置、旧 CLI shim 的真实子进程 / HTTP 调用，以及原有非 TFS CLI 和沙箱初始化回归。共享 agent 私有元数据测试在修复前有 2 项预期失败；将受控 Git 的临时沙箱判断和退出码处理换回修复前版本后，新增测试同样出现 2 项预期失败，恢复后通过。沙箱命令结果解析原样提取并保持旧导出兼容，相应 5 项测试随模块迁移。

标准 `bun run check --test` 仍因工作区缺少 `vite-tsconfig-paths` 无法加载；全仓 `--type` 因未安装的 workspace 包和依赖失败，不能记录为完整质量门禁通过。独立验收预检确认本机没有 Docker、完整应用依赖或正在运行的 Web / Postgres / Redis，也无已有报告可复用，因此未执行真实页面、两用户共享会话和云端 NTLM/PAT 复测，未生成产品验收报告。这些缺项必须在实际运行交付分支的环境补齐，不能由模拟 HTTP 与单元回归替代。

仓库上下文补全这轮：25 个 TypeScript 文件与两份维护文档的 `bun run check --lint` 通过；12 个文件的 145 项针对性测试通过，包含实际临时本地 Git 仓库的初始化脚本测试。将四个关键实现临时换回修改前版本后，新增回归用例出现 5 个预期失败，恢复修改后全部通过。测试使用临时安装的 Vitest、指向仓库实际模块的独立配置，未改仓库依赖清单；普通 `bun run check --test` 因工作区未完整安装、缺少 `vite-tsconfig-paths` 无法启动，全仓 `--type` 同样因缺少工作区包和依赖未通过，不能将这轮结果记为完整质量门禁通过。本机无 Docker、运行中的完整应用或验收会话，真实页面、两用户运行隔离及云端 TFS 克隆仍待部署验收。

此前 TFS 接入首轮使用 Node 24.21.0、Bun 和已安装的 workspace 依赖：

```bash
bun run check --lint --test --type
git diff --check
```

本轮结果：208 项测试通过，全仓类型检查通过，lint 无错误；既有环境初始化测试文件的 `node:path` 导入风格有 1 条 warning。检查工具会自动修正格式，合并后应复核 diff。数据库测试使用仓库的 PGlite 测试设施，不代表部署的 PostgreSQL 已验收。

覆盖账号一对一、加密存储、不能借用其他用户身份、Collection 变更后解绑、未配置密钥拒绝绑定、受限 Collection、URL 穿越、PAT 本机 HTTP 传输、不跟随重定向、错误脱敏、分页、PR 检查失败与空结果区分、失败构建语义、TFVC 跨项目路径拒绝、日志行数限制、临时 Git helper 清理、未授权恢复重试、公共 drive 拒绝初始化和登出缓存重置。

后续 Docker 部署补充：`bash -n scripts/deploy-custom-image.sh` 与 15 项 Python 测试通过，覆盖首次安装自动生成加密密钥、预制公司地址、老部署补缺省值、保留原 Collection/API/ 禁用值、保留原密钥与 `.env`。相关文件 lint 无错误，22 项部署相关 TypeScript 测试通过。Docker 镜像构建和真实 Compose 解析仍未执行。

设计脚本扫描新增 / 相关页面：`lint-lobe.mjs` 无 FAIL，5 条 WARN 来自已有页面间距与 span 点击区域；`check-detail.mjs` 无 FAIL，提示空态 / 禁用说明 / 原表单 label 等启发式 WARN。脚本结果不是渲染验收。

### 下次部署时的只读连通性复测

在安全终端内给当前进程设置 `TFS_COLLECTION_URL`、`TFS_SMOKE_USERNAME`、`TFS_SMOKE_SECRET` 和 `TFS_SMOKE_PROJECT`；NTLM 用个人密码，PAT 时设置 `TFS_SMOKE_AUTH=pat`。这些 smoke 变量只供临时复测，不是服务部署用的共享账号配置。不要把值写进本文或 shell 历史。

```bash
bun --eval '
import { TfsClient } from "./apps/server/src/services/tfs/client";
const collection = process.env.TFS_COLLECTION_URL;
const secret = process.env.TFS_SMOKE_SECRET;
const project = process.env.TFS_SMOKE_PROJECT;
if (!collection || !secret || !project) throw new Error("Missing smoke configuration");
const client = new TfsClient(collection, {
  authType: process.env.TFS_SMOKE_AUTH === "pat" ? "pat" : "ntlm",
  username: process.env.TFS_SMOKE_USERNAME || "",
  secret,
});
await client.identity();
console.log("identity: authenticated");
console.log("projects:", (await client.projects()).items.length);
console.log("repositories:", (await client.repositories(project)).items.length);
'
```

此命令只测服务端 REST 身份 / 列表读取；部署后还需用页面完成以下验收：

1. 两个真实 LobeHub 用户分别绑定不同 TFS 身份；第二个用户不能绑定已占用的同一身份；状态 / 网络响应 / 日志中没有密码或 PAT。
2. 在真实项目菜单创建 TFS 项目；选择项目后再切换项目，不能提交旧仓库；手填无权限 / 错误 Collection URL 得到失败提示。新建、添加和编辑环境后刷新能读回来源。
3. 公共环境由另一个成员运行时使用其个人权限；未绑定 / 无权限不能检出；公共 drive 明确提示改用个人工作目录。
4. 在实际云沙箱内完成一次个人目录初始化，确认网络、NTLM/PAT、证书和 Git 兼容；检查 Git 配置、bootstrap 环境与日志均无凭据。故意拒绝授权后重新绑定能重试。
5. 明暗主题和窄屏下检查实际页面，验证失败后输入保留、更新凭据、解绑、登出 / 换用户缓存隔离、PR / 构建 / 发布 / TFVC 只读内容。

### 尚未验收的边界

本机没有 Docker，也没有可用的完整 Postgres/Redis 和 3010/9876 应用服务；acceptance 预检未通过，未登录实际页面、未生成真实产品截图 / 验收报告。真实云沙箱内网连通性、Docker 镜像构建、公司服务器 PAT 和 HTTPS 认证尚未实测。NTLM 的 TypeScript REST 与本机 Git 检出实测成功，不能代替这些门禁。正式部署前按上面的清单完成验收。
