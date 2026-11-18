# 二次开发功能清单与上游合并指南

这是本 Fork 所有二次开发的统一入口，后续不限于 TFS。每次增加、修改或移除定制功能，都在这里登记；复杂功能另有详细说明，并从本清单链接。合并上游前先读本文件，不能仅靠 Git 自动合并成功判断功能还在。

记录日期：2026-11-16；初始开发基线：`canary` / `871dce63b7`。历史项依据本地可见提交与当前代码核对；不把上游原有功能认作本 Fork 二开。TFS 及本轮部署补充随包含本文的代码提交交付；镜像发布状态以 Actions 为准，目标服务器部署及验收另行核实。

## 功能总表

| 编号     | 二开功能                            | 用户入口 / 行为                                                                             | 维护位置                                                                     | 状态                                                          |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| CUST-001 | 自定义 Docker 镜像发布              | main /canary 推送及手动 Actions 发布本 Fork 的 GHCR 镜像；当前 Linux amd64                  | `.github/workflows/publish-custom-image.yml`                                 | 历史已有；本轮增加 TFS curl 构建参数                          |
| CUST-002 | 单文件安装 / 更新管理器             | `bash deploy-custom-image.sh`；新机安装、切换 main/canary/ 自定义镜像、更新应用或恢复完整栈 | `scripts/deploy-custom-image.sh`、[部署说明](scripts/deploy-custom-image.md) | 历史已有；本轮增加 TFS 缺省地址、更新后结算并自动重跑中断会话 |
| CUST-003 | 部署脚本接入 Onlyboxes / Market     | 菜单切换、保留配置；从一次性应用容器真实探测 Onlyboxes JIT 与 terminalExec                  | 同上；`scripts/deploy-custom-image.test.py`                                  | 历史已有；仅登记脚本接入，Onlyboxes provider 本身不算本项新增 |
| CUST-004 | Fork 发布工作流隔离                 | 官方专用发布 / 同步任务在 Fork 默认跳过，防止误执行官方发布路径                             | 下方列出的五个 `.github/workflows/` 文件                                     | 历史已有                                                      |
| CUST-005 | 个人 TFS / Azure DevOps Server 接入 | 设置 → 集成绑定个人身份；从 TFS 建项目；环境 Git 来源；PR / 构建 / 发布 / TFVC 只读浏览     | 独立 `tfs` 模块及现有入口接点；[详细维护说明](TFS_CUSTOMIZATION.md)          | 本次新增，REST / 本机 Git 已实测，产品页面和部署验收待完成    |

## CUST-001：自定义镜像

- 镜像名称由 `ghcr.io/${{ github.repository }}` 生成；当前部署脚本默认 `ghcr.io/lichao0223/lobehub`。main/canary 和 SHA 标签支持复现与切换，手动运行可指定标签及是否移动 latest。
- 保留工作流的 GHCR 写入权限、登录、标签规则、Dockerfile 构建及缓存。目前平台为 `linux/amd64`，不能承诺 ARM 镜像。
- 本轮在本 Fork 发布工作流传入 `INSTALL_TFS_CURL=true`；根 `Dockerfile` 保留可选安装，复制 NTLM curl **及动态库到最终 distroless 运行层**。仅 builder 安装 curl 无效；不要求用户进入容器安装。
- curl 二进制、依赖和加载器放在独立 `/opt/tfs/`，`/usr/bin/curl` 入口通过该加载器启动。不能覆盖 BusyBox 的 `/lib/libc.so.6`，否则系统 shell 可能因 `GLIBC_2.38 not found` 无法启动；也不能用 `cp --parents` 生成顶层 `/lib64` 目录，与 BusyBox 的同名链接冲突。发布工作流先生成最小运行镜像，执行 Dockerfile 中实际的用户创建和权限设置命令，并以非 root 用户验证 Node 和 NTLM curl，再做完整构建。
- 历史依据：`e3c84a0ad6`、`991d1466f7`。上游重构 Docker 多阶段构建时，要重新确认安装参数、最终复制路径和非 root 用户执行权限。
- 检查：Actions 构建成功、目标标签指向正确 SHA；在目标镜像运行 `docker run --rm --entrypoint /usr/bin/curl <镜像:标签> --version`，输出含 `NTLM`。此镜像构建检查本机尚未执行。

## CUST-002：部署管理器

- 同时维护单文件脚本、Markdown 使用说明、Python 行为测试和 `.github/workflows/test-deploy-script.yml`。服务器只下载一个脚本，不依赖仓库 Python 模块。
- 首次安装下载同分支的 `docker-compose/deploy/` 配套文件；生成独立数据库 / S3 / 认证 / KeyVault 密钥和 RSA JWKS；已有部署不重新生成密钥、不重写 `.env`。
- 选择保存在脚本管理的标准 Compose override；保留其他环境变量、处理 `$` 插值；不覆盖用户自建的 override。更新前备份配置；拉取失败不切换，启动失败恢复旧 override。配置备份不包含数据库、卷或数据库迁移回滚。
- 本轮预制 `TFS_COLLECTION_URL=http://dev.tellhowsoft.com/DefaultCollection`、`TFS_API_VERSION=6.0`。首次安装写入 `.env`；更新已有部署仅在 Compose 有效环境未定义对应键时补进托管 override。已有自定义值和空字符串禁用值都保留，不生成共享 TFS 用户名 / 密码。
- 如果旧安装的缺省值已经写入托管 override，后续改 Collection / 禁用 TFS 要编辑该 override 的对应环境项，或删除这两个项后在 `.env` 配置；override 的优先级高于 `.env`。全程保留文件的托管标记和其他配置。
- `KEY_VAULTS_SECRET` 是 LobeHub 自己已有的加密密钥，不从 TFS 申请。首次安装脚本用 32 个随机字节生成并写入部署目录 `.env`；也可能来自原先的 `docker-compose/setup.sh`。更新时沿用原值。若缺失应先核查旧配置和备份，不能拿新密钥覆盖旧数据的密钥。
- 更新已有部署会在 `up -d --wait` 成功后自动结算运行中的任务（`SETTLE=1` 默认；`0` 关闭，`dry-run` 只预览）：把挂在运行中任务上的操作改为 `interrupted` 并回拨 `updated_at` 20 分钟，用 `KEY_VAULTS_SECRET` 自签内部回调触发 `/api/workflows/task/watchdog` 让任务转 `paused`，再逐个 `POST /api/agent/finalize-abandoned`（Bearer `AGENT_GATEWAY_SERVICE_TOKEN`）兜底残留聊天。依赖应用、Gateway 与 PostgreSQL 已就绪；结算失败只告警，不让部署失败，失败项保持 `running` 等下一次看护收敛。首次安装不执行。
- 更新后自动重跑被中断的会话（`RESUME_AFTER_DEPLOY`，默认 `1`；`0` / `off` / `false` / `no` 关闭，关闭时仍照常结算）：结算前先在 `deploy_resume_queue` 里登记「本次更新打断的会话」，新容器启动时由启动恢复器重跑。清单在把 op 标 `interrupted` **之前**写入，只登记真正在跑的（`agent_operations.status IN ('idle','running',…)`，任务侧还要求 `task_topics.status='running'`）；已 `waiting_for_human` 超过 24 小时的陈留运行不登记。`SETTLE=0` 与 `SETTLE=dry-run` 都不写清单。写入失败只告警，不影响结算与部署结果。
- 待恢复清单表 `deploy_resume_queue`（`packages/database/src/schemas/deployResumeQueue.ts`，迁移 `0221_nosy_tag.sql`）字段：`kind`(`task`/`chat`)、`status`(`pending`/`running`/`done`/`failed`/`skipped`)、`taskId`、`topicId`、`operationId`、`userId`、`workspaceId`、`payload`(jsonb：`lastUserMessage`、`settledAs`)、`attempts`、`error`、`resumedAt`。索引 `(status, created_at)`；**唯一索引 `topic_id`** 保证同一会话只恢复一次，重复部署用 `ON CONFLICT (topic_id) DO UPDATE` 就地重置为 `pending`（`attempts=0`、`error=NULL`、`resumed_at=NULL`）。`user_id` / `workspace_id` 故意不建外键，避免容器停机期间删用户 / 删工作区导致登记失败。
- 启动恢复器 `apps/server/src/services/deployResume/`（`resumePendingDeployResumes` → `resumeDeployInterruptedRuns`）：在 `src/instrumentation.ts` 的 `register()` 里挂载，条件 `NEXT_RUNTIME==='nodejs' && DATABASE_URL && !VERCEL_ENV && RESUME_AFTER_DEPLOY !== '0'`，写法与既有 `resumePendingAgentTransferJobs` 一致，**catch + log，绝不阻塞启动**。单次启动最多取 20 条（`MAX_PER_BOOT`），并发 5（`CONCURRENCY`），单行最多 3 次尝试（`MAX_ATTEMPTS`），退避 5s（`RETRY_DELAY_MS`），超过 24 小时的陈旧 `pending` / `running` 直接标 `skipped`（`STALE_AFTER_MS`）。跨进程互斥靠数据库 `claim`（`UPDATE … WHERE status='pending'`），同进程另有 `running` Set 防重入。
- 任务恢复复用它自己的服务层入口：`TaskRunnerService.runTask({ taskId, continueTopicId: topicId, extraPrompt: '上一轮因部署更新中断，请先检查已完成部分，再继续未完成的工作。', trigger: 'deploy-resume' })`。`trigger` 新增取值 `'deploy-resume'`（`packages/types/src/task/index.ts`、`task_topics.trigger`、`locales` 的 `taskDetail.runTrigger.deploy-resume`），语义同 `manual`：不消耗定时配额、失败不自动 pause。结算后 topic 已是 `canceled`，`runTask` 的「topic 非 running」前置校验因此放行；成功后往话题插一条「因部署更新中断，已自动继续。」提示（仅首次尝试写，避免重试刷屏）。
- 普通对话恢复走服务层 `startComposerRun`（`apps/server/src/services/aiAgent/composerRun.ts`），**不是** HTTP 自调用 `execAgent`；等价于 UI「重试」：重发 topic 最后一条 `role='user'` 消息（优先用清单里的 `payload.lastUserMessage` 快照，缺失才回查库）。跳过条件：topic 已不存在、关联 op 已是 `done`、topic 已有 live run、op 最后一条 assistant 已是完整回答（登记时 `settledAs` 已区分任务运行与残留聊天）。
- 上游改动需同步检查的接点：`scripts/deploy-custom-image.sh` 的 `reconcile_runs()` / `settle()` 顺序、`src/instrumentation.ts` 的启动块、`TaskRunnerService.runTask` 的签名与 `TaskRunTrigger` 联合类型、`startComposerRun` 的参数形态，以及 `agent_operations` 的 `IN_FLIGHT_STATUSES` 常量。上游若给 `task_topics` 加 `trigger` 枚举约束（当前是 `text().$type<>`），要补迁移。
- 尚未覆盖的边界：只重跑一轮，不做断点续传；多副本同时启动靠 `claim` 只会有一个容器跑；`SETTLE` 未开启的部署（`SETTLE=0`）不会登记；计划任务 / 心跳在下一次 tick 自然恢复，不走本清单；恢复计费不设防（自用部署，用户明确要求全开）。
- 历史依据：`e3c84a0ad6`、`d0b8fa56a2`、`20b371eeb8`、`ecd6a41479`、`a574f77ca9`。后两项分别修复 Compose `$` 反转义和终端不可 seek 的输入问题，合并时不要丢。
- 上游改变服务名、Compose 模板位置、启动命令或健康检查时，同步检查脚本的 `SERVICE`、模板清单和 `--wait` 流程。镜像发布与部署脚本更新是两件事：本地改源码后，服务器拉取旧标签不会得到新功能。

## CUST-003：Onlyboxes / Market 部署切换

- 菜单 5 填写 Console 基础 URL、与 Console 一致的 JIT 签名密钥、issuer；菜单 6 检查当前配置。菜单 7 可启动或恢复依赖服务。
- 通过待部署镜像的一次性容器、相同 Compose 网络与环境，签发 JIT 并执行真实 terminal 命令。探测失败不改配置，不重启应用；不是判断本机是否有同名容器。
- 切回 Market 清空托管的 Onlyboxes 参数。Onlyboxes Console /worker 要另行部署，脚本不安装它们；探测不覆盖文件导出所需的 terminalResource。
- 历史依据：`20b371eeb8`。上游修改 Onlyboxes 请求协议、JIT claim、签名、路径或启动参数时，同步修改脚本内 `ONLYBOXES_PROBE` 和协议测试；不能只更新应用 provider。

## CUST-004：Fork 工作流隔离

以下工作流保留 `github.repository == 'lobehub/lobehub' || vars.ENABLE_UPSTREAM_PUBLISH_WORKFLOWS == 'true'` 的执行条件及原有附加条件：

- `.github/workflows/sync-main-to-canary.yaml`
- `.github/workflows/deploy-workbench.yml`
- `.github/workflows/release-desktop-canary.yml`
- `.github/workflows/release-model-bank.yml`
- `.github/workflows/preview-cli.yml`

历史依据：`f0512669c3`、`2b97b25170`。上游重命名或拆分这些工作流时迁移条件；启用开关前配置相应发布凭据。不要把此限制加到本 Fork 自己的 Docker 镜像发布或常规代码测试上。

## CUST-005：TFS

完整功能、文件、配置、安全边界及实测记录见 [TFS\_CUSTOMIZATION.md](TFS_CUSTOMIZATION.md)。合并时至少保持：

1. 独立服务、RPC、前端 service /store/ UI 模块与共享类型；既有项目 / 环境表单中的接点和 en-US /zh-CN 文案。
2. 每位用户一个个人 TFS 身份，同一外部身份也只能绑定一位用户；身份由服务端确认并经既有 KeyVault 加密，不复用他人凭据。
3. 项目创建、绑定仓库、环境创建、环境更新及运行初始化均验证当前用户权限；固定 Collection、URL 校验、不跟重定向、日志脱敏和登出缓存清理。
4. 复用既有 SCM identity 表与唯一约束，当前无需 migration。上游如调整这些表和加密格式，需要迁移兼容方案，不能简单删字段。
5. 代码只初始化到个人工作目录或临时沙箱；公共网盘和旧实例构建入口尚不支持 TFS。详见 TFS 文档的使用限制，不能将 “可保存来源” 误当成 “所有执行方式都已支持”。
6. 本 Fork Docker 工作流的 NTLM curl 构建参数、部署脚本的缺省 Collection/API 配置。
7. TFS 独立的 agent 仓库上下文与云端 CLI 提示：普通服务端 / 浏览器运行、云端 CLI、连接设备 CLI 和桌面本地 CLI 都能读取当前作用域允许的地址、分支与环境；旧对话也按当前项目关联读取。GitHub 的 `GITHUB_REPOS`、预克隆和认证流程保持原逻辑。公开 TFS 项目来源的自动检出使用调用者个人盘，旧的自动项目目录在运行时纠正；手选公共目录仍禁止 TFS 检出。

### TFS 权限与后续 Git 操作补全（2026-11-16）

- 个人设备上的 TFS checkout 会把临时 Git credential helper 随本次 agent 请求传给设备 CLI，后续 `fetch`、`pull`、`push` 继承同一认证环境。设备必须运行包含该协议字段处理的本 Fork CLI，旧 CLI 会完成首次 checkout 但不会为后续 Git 操作注入凭据；共享设备和工作区设备仍不接收个人凭据。

- 共享 agent 仓库上下文排除调用者私有环境，覆盖 Topic 和无 Topic 任务；GitHub 上下文不改。
- 新增独立 `tfs.git/gitOperation`、`lh tfs git` 和随服务端交付的 TFS CLI shim。后续云端 fetch / 快进 pull / 非强制 push 按当前调用者重新授权，只操作当前 Topic 选中来源，凭据不返回 agent、不落 Git 配置；临时沙箱可用，实际公共盘和旧实例继续拒绝。
- 合并时保留 `services/tfs/{git,gitCommand,cliShim}.ts`、`routers/lambda/tfsGit.ts`、`apps/cli/src/commands/tfs.ts`，以及普通云端 `lh` 预处理和 TFS CLI 启动的派发接点。详细协议、测试和待验收项见 TFS 说明。

### TFS 仓库上下文补全（2026-11-16）

- 主要实现位于 `apps/server/src/services/tfs/{agentContext,cloudAgentContext,projectCheckout}.ts`；共享运行链路只增加调用接点。桌面 / 浏览器通过 workspace-aware 的 `tfs.agentContext` RPC 获取无凭据上下文，RPC 保留 topic 可见性和 agent-share 访客隔离检查。
- 上下文区分 “项目已关联来源”“对话选中环境” 和 “实际已检出代码”；不宣称元数据等于克隆成功，不把密码 / PAT 或环境变量发给模型。调用者自己的网关管理设备只在空工作目录首次调用时用一次性凭据初始化；共享设备、桌面直连和后续 fetch/push 继续使用设备自身凭据管理器。
- 尚无实际部署的页面 /agent 对话验收；自动化验证及当前边界见 TFS 详细说明。合并时保留浏览器上下文、桌面本地 CLI、服务端运行和云端 / 设备分发的所有接点。

## 上游合并统一流程

1. 提交或备份本地改动，记录本次上游起止提交、当前镜像 SHA，备份数据库 / 卷和 `.env` /override。不要重建加密密钥。
2. 按总表逐项标记 “未受影响 / 已迁移 / 已被上游替代 / 待解决”。Git 没有报冲突也要检查入口、配置和运行时调用链是否仍连通。
3. 逐个接点合并；不要对共享文件整体选 ours /theirs。上游有等价实现时迁移定制能力并删掉旧接点，更新本清单，避免保留两套逻辑。
4. 跑改动范围的 `bun run check [路径...]`；部署脚本变更跑 `bash -n scripts/deploy-custom-image.sh` 和 `python3 scripts/deploy-custom-image.test.py`。有 Docker 时再跑 `python3 scripts/deploy-custom-image.test.py --compose-check`，此命令只解析配置。
5. 镜像按目标平台实际构建；在部署本分支的环境验证受影响入口。TFS 至少验个人身份隔离、项目 / 环境来源保存与一次实际代码初始化。单测、原型和生产 debug proxy 不能代替真实产品验收。
6. 将合并日期、上游提交、迁移位置、检查结果及剩余限制补到相关条目。源码、脚本和镜像必须属于同一已发布版本，再用服务器脚本更新。

## 后续二开的登记格式

新增 `CUST-006` 起的条目，不复用已删除编号。每项至少写：功能 / 用户入口、涉及文件及共享接点、配置与密钥来源、数据库兼容性、权限与运行边界、回归命令 / 真实验收证据、上游合并保留点和当前发布状态。详细内容可分文件，但本总表必须有入口。

## 本轮检查记录

- 提交前已 rebase 到远端 `canary` / `124c7ebaed`，无冲突；补齐上游新增钉钉适配器的本机 workspace 依赖后，69 个提交文件的检查通过：208 项相关测试通过、全仓类型检查通过，lint 仅有既有 1 条导入风格 warning。依赖同步未修改受版本管理的清单。
- TFS 前轮：208 项测试通过，类型检查通过，lint 无错误、既有 1 条 warning；真实 NTLM REST 查询与本机 Git 克隆成功。细节见 TFS 文档。
- 本轮部署补充：15 项 Python 测试通过，覆盖首次安装密钥生成、老部署补缺省值、保留已有 / 禁用 / 托管的 TFS 设置、原密钥与 `.env` 不被更改，以及既有回滚和 Onlyboxes 协议测试。
- 本轮相关文件 `bun run check --lint --test` 通过，22 项部署相关 TypeScript 测试通过，lint 无错误；`bash -n` 和 `git diff --check` 通过。Python / Shell / Dockerfile 等没有对应 linter 的文件不计为已 lint。
- 本轮部署自动重跑（2026-11-17）：`python3 scripts/deploy-custom-image.test.py` 24 项通过（登记先于结算、只登记运行中会话、跳过 `waiting_for_human` 陈留、写入失败不阻塞结算、`RESUME_AFTER_DEPLOY=0` 不登记、dry-run 不登记、`RETURNING` 计数不被 psql 命令标签污染）；`pnpm exec vitest run apps/server/src/services/deployResume/index.test.ts` 19 项通过；`pnpm exec oxlint` 覆盖改动文件 0 warning / 0 error；`pnpm exec tsrs --noEmit -p tsconfig.type-check.json` 退出码 0；`bash -n scripts/deploy-custom-image.sh` 通过。本机没有 `bun`，`bun run check` 按其组成（lint + 相关测试 + 全仓类型检查）分别执行。迁移 `0221` 与 `queue_resumes()` 的真实 SQL 已在 `lobe-postgres` 的临时库 `deploy_resume_probe` 上跑通：建表建索引、3 行登记（2 任务 + 1 对话）、二次部署就地重新武装（总行数仍为 3）、`RESUME_AFTER_DEPLOY=0` 写 0 行、按 id 的 `claim` 只有一方成功、`listPending` 命中 `(status, created_at)` 索引。
- 同批修正一个既有类型错误：`apps/server/src/services/tfs/git.ts` 读取 `getUserSettings()` 返回的 `market` jsonb 时被推断为 `{}`，导致全仓 `type-check` 失败；按 `MarketAuthTokens` 收窄后再读 `accessToken`。与部署自动重跑无关，仅因阻塞类型检查门禁一并修复。
- 尚未执行：真实造一次中断（更新时正在跑的任务 / 对话）后由新容器启动自动重跑的端到端验收、Docker 镜像构建、目标服务器升级。线上容器镜像早于本次改动，单纯重启只会跑旧代码；真实验收要先构建并推送镜像再走一次更新。库表与脚本 SQL 已在真实 PostgreSQL 上验证，但这不等于产品级恢复验收。
- 尚未执行 Docker 镜像构建、真实 Compose 解析、目标服务器升级及真实页面验收；不能据此宣称已经上线或全链路通过。
