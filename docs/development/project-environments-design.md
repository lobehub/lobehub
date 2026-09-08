# Project Environment 表设计草案

状态：本 PR 实现环境登记与项目关联的 schema、共享配置类型及迁移；其余内容是后续设计边界。

## 本 PR 的实际范围

- 新增 environments 与 project\_environments，使用独立 UUID 主键。
- Environment 使用 enabled 表达登记是否可用；本轮不加 desired\_state、删除状态或实例控制字段。
- 配置支持 container/image、virtualMachine/templateId、attached/resourceId，附带可选资源请求、工作目录、初始化命令和空闲超时；只是类型契约，不代表 Provider 已接入。
- 平台内部设备外键、凭据绑定、存储、实例、Topic 选择与执行定位后续接入。attached.resourceId 仅为外部 Provider 的资源引用，不能代替内部 devices 外键。
- API / 模型本轮不新增；JSONB 深层配置验证、跨资源同租户校验、配置版本递增和环境 enabled 与关联有效性的联合判断，须在写入 / 执行服务接入时实现。SQL FK 只保证引用存在，不提供权限隔离。
- 用户与 Workspace 删除被环境 FK RESTRICT 阻止，直到显式清理环境记录；未来云资源启用前必须接入对应删除流程。项目删除仅级联关联表。
- 以下候选字段与生命周期讨论以本节的交付范围为准。

## 目标与边界

Environment 是可跨 Topic 使用、在运行实例重建后仍保持身份的工作环境。
目标覆盖代码开发、日常文件工作和模型训练；普通 Topic sandbox 和已有设备目录继续兼容。
Environment 提供工作条件，不定义工作流程；不引入 Jobs / Attempts 表。
Environment 不等同于代码仓库、工作目录、一次 Agent Operation 或应用 Deployment。

本稿先讨论数据契约。字段进入生产 schema 时必须同时有明确的读写方；不预留无消费者的 metadata/config 大杂烩。

## 已确定：项目通过关联接入 Environment

Environment 独立于 Project 存在；Project 与 Environment 使用关联表建模。
一个 Project 可关联多个 Environment，一个 Environment 可被多个 Project 关联。
环境授权独立于项目关联，移除关联不销毁环境。
以下个人 / Workspace 归属与同租户限制是首版建议，尚待确定跨范围共享需求。

## 核心主表：environments

| 字段                                     | 类型 / 可空性                 | 语义与写入方                                                                                          |
| ---------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| id                                       | uuid PK，默认生成             | 稳定环境 ID，与 Provider 实例 ID 分开                                                                 |
| user\_id                                 | text NOT NULL FK              | 遵循仓库资源 scope 约定：个人模式用于归属，Workspace 模式记录创建者；删除策略须与外部资源清理一起设计 |
| workspace\_id                            | text NULL FK                  | 环境自身的租户范围；NULL 表示个人资源，不从关联项目改变归属                                           |
| name                                     | varchar(255) NOT NULL         | 展示名称，创建 / 编辑写入                                                                             |
| description                              | text NULL                     | 用户说明                                                                                              |
| provider                                 | text NOT NULL                 | Provider 选择，由创建服务验证支持情况；不建 pgEnum                                                    |
| enabled                                  | boolean NOT NULL DEFAULT true | 登记是否可用，不表示实例正在运行                                                                      |
| configuration                            | typed jsonb NOT NULL          | 实际支持的启动配置，字段契约见下文                                                                    |
| configuration\_version                   | integer NOT NULL DEFAULT 1    | 配置更新递增；实例记录启动时版本                                                                      |
| created\_at / updated\_at / accessed\_at | 仓库 timestamps               | 遵循现有 helpers                                                                                      |

configuration 必须能表达不同运行后端，而非要求全部环境提供容器 image。
候选契约包含 runtime（容器镜像、VM 模板或已有运行端引用的判别联合）、工作目录、初始化步骤、资源请求和回收策略。
资源请求需能扩展 CPU、内存、GPU 型号 / 数量 / 显存要求；运行端实际分配结果保存在实例侧。
每个字段随具体 Provider 消费方落地；不把不支持的字段先做成空占位。
仓库 URL、秘密值、实际实例 ID、实时健康状态不放 configuration。
配置应使用共享领域类型；跨 Provider 字段不同则使用带判别字段的类型并在服务边界验证。

约束与索引：

- user\_id 和 workspace\_id 查询索引；名称去空白后不能为空。
- configuration\_version > 0。
- 名称首版不强制唯一，以 ID 标识环境，避免重命名引入额外产品限制。
- 环境销毁影响所有关联项目，必须由环境管理权限控制；项目管理权限不自动赋予销毁权。
- 环境硬删除前需完成云端清理；用户 / Workspace 删除不得直接级联抹掉尚未清理的资源依据。

## 项目关联表：project\_environments

| 字段                | 类型 / 可空性                  | 语义                                                  |
| ------------------- | ------------------------------ | ----------------------------------------------------- |
| id                  | uuid PK，默认生成              | 关联自身的稳定 ID                                     |
| project\_id         | text NOT NULL FK               | 项目，ON DELETE CASCADE 只删除关联                    |
| environment\_id     | uuid NOT NULL FK               | 被关联环境；建议 RESTRICT，显式处理解绑后再硬删除环境 |
| workspace\_id       | text NULL FK                   | 从项目派生，用于项目范围查询；不作为独立授权依据      |
| added\_by\_user\_id | text NULL FK                   | 谁建立关联，ON DELETE SET NULL                        |
| is\_default         | boolean NOT NULL DEFAULT false | 该项目内是否默认，与环境自身无关                      |
| enabled             | boolean NOT NULL DEFAULT true  | 是否允许该项目继续使用此关联                          |
| sort\_order         | integer NOT NULL DEFAULT 0     | 项目内显示顺序                                        |
| timestamps          | 仓库 timestamps                | 关联创建与更新时间                                    |

- unique (project\_id, environment\_id) 防止重复关联。
- unique (project\_id) WHERE is\_default = true，保证每个项目最多一个默认关联。
- CHECK (NOT is\_default OR enabled)，停用默认关联时同事务清除或切换默认值。
- environment\_id 反向索引，用于查询影响哪些项目；项目列表使用 (project\_id, sort\_order) 索引。
- 首版建议只允许同 Workspace 或同一个人的个人范围内关联；跨范围共享需要显式授权模型。
- 创建关联时校验项目管理权限与环境使用权限；执行时重新校验环境状态及有效权限。
- 项目内可用能力不能超过环境授予的权限。首版不预建没有执行端消费者的 permission JSON。
- 环境逻辑删除时事务性停用所有关联并清除默认值；单表 CHECK 无法检查另一张表的生命周期。
- 项目 scope 迁移时重新校验所有关联，不能顺带更改共享环境的归属。
- 共享 Environment 表示共享同一个资源，不会自动产生独立文件或进程隔离；项目隔离能力由后续 checkout /instance 模型明确提供。

## 运行接入时增加：environment\_instances

若本次只完成环境登记 CRUD，可先不建实例表；在真正创建云端实例的同一批变更中加入它。

| 字段                                             | 语义                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| id                                               | uuid PK                                                                   |
| environment\_id                                  | 环境 FK，历史记录存在时限制直接硬删除环境                                 |
| provider / provider\_scope\_key                  | 启动时的 Provider 与非秘密账户 / 部署范围快照                             |
| provider\_instance\_id                           | 外部实例 ID；创建完成前允许 NULL                                          |
| provisioning\_key                                | 调用外部创建前持久化的幂等键                                              |
| configuration\_version / configuration\_snapshot | 启动时实际配置，不含凭据                                                  |
| status                                           | provisioning / running / stopping / stopped / failed / deleting / deleted |
| last\_heartbeat\_at                              | 最近一次被控制服务确认存活的时间                                          |
| started\_at / stopped\_at                        | 实际生命周期时间                                                          |
| error                                            | 明确类型的错误 code、message，写入前脱敏                                  |
| timestamps                                       | 创建与更新时间                                                            |

外部唯一性使用 (provider, provider\_scope\_key, provider\_instance\_id)，不假设实例 ID 跨账户全局唯一。
provisioning\_key 唯一；不对 environment\_id 施加全局 “一个非终结实例” 唯一约束。
首版可以按 Provider 的运行模式限制单实例；同一 Environment 的历史实例与当前实例分开，不预建分布式调度能力。
环境拥有 / 创建的实例与仅连接的外部运行端必须区分，后者解除连接不代表销毁底层机器。
用条件状态更新 / 版本控制防止旧回调覆盖新状态。
先持久化创建意图，再调用 Provider；失败重试复用幂等键，控制服务负责对账。
DB 状态不等于云端事实，删除完成必须以外部资源释放确认作为依据。

## Topic 和 Operation 关联

- topics.project\_id 保持业务归属语义。
- Topic 接入环境选择时增加 environment\_id（可空）；NULL 表示继承项目默认环境。
  因此修改项目默认值会影响未显式绑定的 Topic 的未来运行；此行为需要在产品设计中明确。
- 若用户选择了显式环境，必须存在当前项目到该环境的有效关联，并通过租户和环境权限校验。
- Topic 首版建议仍保存 environment\_id：关联删除后保留显式选择，下一次运行因缺少有效关联而拒绝，不把它误当作默认继承。
- 显式绑定失效时停止执行并提示修复，不静默换到另一个环境。
  因此优先保留逻辑删除环境行，避免 SET NULL 将 “失效绑定” 误解释为 “继承默认”。
- 不向全部旧 Topic 回填环境；Topic 不属于项目时保持现有 sandbox 路径。
- agent\_operations 在运行接入时记录实际 instance\_id 和必要的执行配置快照；历史不能通过 Topic 当前配置反推。
- 当前 project\_working\_directories 的 device\_id = NULL 表示设备已移除，不用于表示云端。
- 同时存在本地目录绑定和云端环境选择时，启动入口必须明确选定目标，不按字段是否非空随意猜测。

## 三场景推演后的模型补充（提案，尚未实现）

结论：现有主表与项目关联方向成立，但 image + workingDirectory + 单实例不足以完整支持三个场景。
Environment 表保存稳定身份和配置；存储与实际实例通过独立实体关联，不能把三类业务全塞入 configuration。

### 场景一：代码仓库开发

项目关联开发 Environment → 创建实例 → 准备持久目录及代码 checkout → Topic 执行修改 / 测试 → 保存未提交变更与产物 → 停止并重新启动后继续工作。

- 仓库是文件来源，工作目录是运行时位置，两者分开。
- 多 Topic 并行修改需要明确 checkout/worktree 或实例隔离策略。
- 同一路径在不同实例上并不代表同一份数据，实例必须关联实际存储。
- Operation 记录执行实例与代码版本；新 Topic 不要求重新创建 Environment。
- 浏览器预览等服务端点随实例发布，不是环境永久 URL。

### 场景二：日常工作文件夹

项目关联办公 Environment → 挂载文档、图纸或视频素材 → 工具或用户打开应用处理 → 保存输出与版本 → 关闭实例后保留工作文件。

- Git、仓库字段均可缺省；持久存储是独立能力。
- 脚本处理文档与操作完整 GUI 应用是不同执行能力，不能仅凭文件扩展名判定所需环境。
- runtime 需支持适用的 OS / 架构与容器、VM、已有设备等后端；声明配置不等于 Provider 已支持。
- CAD / 视频等具体应用的 OS、授权、图形能力和远程桌面兼容性需按选定产品验证，本稿不承诺软件兼容性。
- 文件访问需要区分只读素材、可写成果与可丢弃缓存；恢复、锁和冲突策略由存储与应用层实现。
- 仅将对象上传到文件表不代表已具备可供应用读写的文件系统。

### 场景三：模型训练

项目关联训练 Environment → 获取适用算力与存储 → 执行工具启动训练进程 → 查询日志 / 保存 checkpoint → 完成后释放算力。

- Environment 保存资源请求和运行配置；实例记录实际 GPU/CPU 等分配结果。
- Task 表达业务工作，Operation 表达 Agent 执行；训练进程或外部平台任务标识由工具返回、查询和取消，不增加 Environment Jobs。
- Agent 回合结束不代表训练进程结束；环境不得仅按聊天活跃度自动回收。
- 首版若不能可靠检测后台工作，使用显式停止策略；后续可由运行端提供进程活跃检测或保活机制。
- 数据集、checkpoint 和输出模型放持久存储；恢复逻辑属于训练程序和执行工具。

### 需要明确的公共关系

| 实体                           | 关键职责 / 候选字段                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| environments                   | 稳定身份、租户、Provider、runtime 与资源请求配置及其版本                       |
| project\_environments          | 项目关联、启用与默认选择                                                       |
| environment\_instances         | 实际后端引用、生命周期、已解析配置、实际资源、观测到的能力                     |
| 存储资源实体（命名待复用检查） | 租户、后端及外部引用、生命周期 / 保留策略；独立于实例存在                      |
| environment\_mounts            | environment\_id、storage\_id、源子路径、目标位置、读写模式；同环境目标位置唯一 |

存储访问方式必须明确：文件系统挂载、对象 API 或下载同步不能被当作同一种能力。
存储绑定与挂载需要独立鉴权；Environment 的访问权不能自动授予任意存储资源权限。
project\_environments 的默认选择只是一项用户偏好，调度还需匹配此次任务的运行能力和资源要求。
Environment 不添加 code /office/training 互斥类型；一个环境可以同时承担文档处理与代码开发。
同一环境关联多个项目表示共享同一资源。若只想复用安装配置但隔离数据，应由模板创建不同 Environment。
Provider 能力不满足请求时明确拒绝；不得悄悄删除 GPU、GUI 或持久化等要求后运行。

这部分定义的是支持边界，不要求本轮一次性创建所有表。首批两张表仅能宣称完成环境登记与项目关联，完整支持三场景需对应执行与存储链路验收。

## 后续实现顺序

- 代码来源与 checkout：多仓库、commit/branch、挂载路径、Task/worktree 隔离。
- 持久存储与 mounts：是三个场景的公共基础，优先于特定 Git checkout 扩展。仅登记 Environment 不承诺实例重建后文件可恢复。
- 凭据绑定：复用现有加密凭据系统，保存授权引用，不保存明文环境变量秘密。
- 运行端访问：终端、端口预览、远程桌面等随 Provider 真实能力接入，连接地址和短期令牌不放静态配置。
- 后台进程：由执行工具管理；环境层只确保回收行为与后台运行承诺一致。
- 长期 Deployment：按真实产品能力单独接入。

## 首次实现验收项

1. 环境 CRUD 与项目关联 CRUD 的个人和 Workspace 隔离，以及两者权限分离。
2. 并发设置默认环境仍最多保留一个默认值。
3. 同一环境可关联两个有权限的项目；重复关联和未授权跨租户关联被拒绝。
4. 删除项目或解绑仅移除关联，不销毁共享环境；显式绑定已失效的 Topic 不静默回退。
5. 运行接入后补充并发启动幂等、旧回调拒绝、实际执行实例溯源的测试。
6. 销毁共享环境时所有关联项目正确失效；父级用户 / Workspace 删除不会留下不可追踪的云端资源。

项目关联方式已确定；环境租户归属和最小创建流程确定后，再写共享类型、Drizzle schema、模型 / 测试并生成迁移。

## 收敛后的必要补充

1. 运行绑定：区分平台创建的资源与已有设备 / 外部资源，保存可解析的运行端引用；Provider 名称不足以定位资源。引用不用自由字符串假装本地外键。
2. 配置契约：runtime、资源请求、工作目录、初始化步骤、非秘密变量与秘密引用，均按实际消费者定义；不是互斥的业务场景类型。
3. 存储契约：独立资源身份、访问方式、挂载位置和读写模式；声明临时 / 持久属性以及环境删除时的保留行为。
4. 生命周期：环境定义启用 / 停用 / 删除与实例运行状态分开；外部设备不可启动时不承诺平台可自动开机，解除连接不销毁外部资源。
5. 使用与管理权限：关联不是授权；管理共享环境会影响所有关联项目。对获得 shell 的用户，不能用调用工具层的只读标志假装已经隔离底层文件和凭据。
6. 执行定位：Topic 选择环境，运行时固定实际实例和 cwd；新配置只影响后续启动，历史记录保存实际配置版本。

本轮建表重点是 environments 与 project\_environments 的稳定契约；实例和存储按具体接入实现，不再增加工作流实体。
