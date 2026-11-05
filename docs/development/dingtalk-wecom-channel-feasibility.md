# 钉钉 / 企业微信 IM 渠道接入：可行性结论与接入方案

> 文档日期：2026-11-05｜官方文档核对日期：**2026-11-05**（以下链接均于当日打开核对）
> 状态：**结论待 维护者 拍板**，适配器实现尚未开始。
> 标注约定：
> - 「已核对」：官方文档原文写明。
> - 「未核实」：官方文档没写，或页面打不开。
> - 「未实测」：还没有在真实企业里验证。本文所有结论目前都是「未实测」，还没有拿到测试企业。

---

## 0. 一句话结论

| | 钉钉 | 企业微信 |
|---|---|---|
| 推荐通道 | 企业内部应用机器人 + **Stream 模式**（出站 WebSocket） | **智能机器人 API 模式 + 长连接**（出站 WebSocket） |
| 单聊收发 | ✅ 可行（文档） | ✅ 可行（文档） |
| 群聊 @ 收发 | ✅ 只限内部群；群里 @ 时收不到语音、视频、文件 | ✅ 只限企业内部群；群里只收文本、图文、引用 |
| 流式回复 | 有，需用 AI 卡片（`card/streaming`） | 原生支持（`stream` 消息，`<think>` 会显示为思考过程） |
| 需要公网回调 / 备案域名 | 否 | 否（长连接模式） |
| 企业资质 | 只需企业或团队账号；内部应用发布**无审核**；未认证组织能否创建：未核实 | 未认证企业最多 100 人使用；创建智能机器人是否需认证：未核实（官方未列为前提） |
| 最大风险 | **免费标准版：Webhook 和 Stream 推送合计 5000 次/月，超出后机器人收不到消息内容** | **每个机器人同一时间只能有 1 条长连接**，新连接会把旧连接踢掉 |
| 推荐接入形态 | per-agent bot（用户填写应用凭证） | per-agent bot（用户填写 BotID + Secret） |

两个平台的群机器人 webhook 都**只能发、不能收**，不能作为对话渠道。企微群机器人已核对。钉钉自定义机器人的 Outgoing 机制还列在文档里，但是否仍可用未核实。企微「自建应用回调」要求配置可信 IP，回调域名的备案主体还必须和客户企业一致，**多租户 SaaS 基本没法用**，所以不推荐。

---

## 1. 钉钉

### 1.1 能做到什么

- **收消息**（已核对）
  - 企业内部应用机器人在单聊和群聊里都能收消息。群聊只推送 @ 机器人的消息。
  - 来源（核对 2026-11-05）：[机器人概述](https://open.dingtalk.com/document/orgapp/robot-overview)、[接收消息](https://open.dingtalk.com/document/orgapp/receive-message)
  - 可收的类型：text、richText、picture、audio、video、file。群里 @ 时收不到 audio、video、file。
- **两种接收模式**（已核对）
  - HTTP 回调：需要公网 HTTPS 地址，用 HmacSHA256 签名，时间戳偏差超过 1 小时就会被拒。来源（核对 2026-11-05）：[配置机器人](https://open.dingtalk.com/document/orgapp/configure-the-robot-application)
  - **Stream 模式**（官方推荐）：「不需要公网服务器、IP、域名等资源」。一个应用默认最多 50 条连接；有多条连接时，消息随机推送到其中一条。机器人消息采用 fire-and-forget，不会重推。
  - 建连方式：`POST https://api.dingtalk.com/v1.0/gateway/connections/open` 换取 endpoint 和 ticket（ticket 90 秒有效，只能用一次），然后建立 WebSocket 连接，并原样回 ping。
  - 来源（核对 2026-11-05）：[Stream 模式介绍](https://open.dingtalk.com/document/resourcedownload/introduction-to-stream-mode)、[Stream 协议说明](https://open.dingtalk.com/document/direction/stream-mode-protocol-access-description)、[developerpedia/protocol.md](https://github.com/open-dingtalk/developerpedia/blob/main/docs/learn/stream/protocol.md)
  - 官方提供 Java、Go、Python、Node.js 的 Stream SDK（核对 2026-11-05）：[github.com/open-dingtalk](https://github.com/open-dingtalk)
- **回复**（已核对）
  - `sessionWebhook`：回调里自带，可以直接回复，并且支持 @。有效期**文档没写**（未核实）；官方示例推算约 90 分钟。来源（核对 2026-11-05）：[回复消息](https://open.dingtalk.com/document/orgapp/robot-reply-and-send-messages)
  - 单聊主动发送：`/v1.0/robot/oToMessages/batchSend`，每次最多 20 个用户。来源（核对 2026-11-05）：[单聊批量发送](https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches)
  - 群聊主动发送：`/v1.0/robot/groupMessages/send`，msgParam 不超过 15000 字节，**不支持 @**。来源（核对 2026-11-05）：[群聊发送](https://open.dingtalk.com/document/orgapp/the-robot-sends-a-group-message)
  - 消息类型：text、markdown、image、link、actionCard、audio、file、video。来源（核对 2026-11-05）：[消息类型](https://open.dingtalk.com/document/orgapp/types-of-messages-sent-by-robots)
  - **流式**：先用 `createAndDeliver` 投放一张 AI 卡片，再反复调 `PUT /v1.0/card/streaming` 更新。markdown 字段每次都要传全量内容；单次更新建议不超过 1 KB，总大小建议不超过 3 KB；需要 `Card.Streaming.Write` 权限。
    - 来源（核对 2026-11-05）：[创建并投放卡片](https://open.dingtalk.com/document/orgapp/create-and-deliver-cards)、[流式更新](https://open.dingtalk.com/document/orgapp/api-streamingupdate)、[打字机效果](https://open.dingtalk.com/document/orgapp/typewriter-effect-streaming-ai-card)
    - 「总大小 3 KB」对 agent 的长回复偏紧，可能要分卡或降级成最终 markdown 消息（未实测）。
- **身份与文件**（已核对）
  - 用 `senderStaffId` 作为企业内的 userId，机器人发布后才生效。`conversationType` 为 1 表示单聊，2 表示群聊。
  - 文件下载：用 downloadCode 调 `robot/messageFiles/download`，换取临时 URL。来源（核对 2026-11-05）：[下载文件](https://open.dingtalk.com/document/orgapp/download-the-file-content-of-the-robot-receiving-message)
- **话题 / 线程**：在机器人相关文档里没找到话题群或线程的开放能力（未核实，目前看没有）。

### 1.2 资质与审核

- **前提**（已核对）：要有钉钉企业或团队账号，并且管理员授予开发者权限。来源（核对 2026-11-05）：[开发流程](https://open.dingtalk.com/document/orgapp/overview-of-development-process)、[获取开发者权限](https://open.dingtalk.com/document/orgapp/obtain-developer-permissions)
- **企业内部应用**（已核对）：「创建新版本 → 保存 → 直接发布」，**流程里没有审核环节**；发布后可设置可见范围。机器人还能「点击调试」生成测试群。来源（核对 2026-11-05）：[发布应用](https://open.dingtalk.com/document/orgapp/publish-dingtalk-application)
- **审核周期**：企业内部应用和机器人发布无需平台审核，发布后立即生效（文档已核对，未实测）。
- 未认证组织能否创建内部应用和机器人：**未核实**。免费测试组织的政策：**未核实**。
- **第三方企业应用（ISV，对应 System Bot 形态）**（已核对）：要先完成方案商认证；上架门槛包括钉钉指数不低于 1000、至少 3 家客户共创等（2025-04 起生效）；审核时长没写。来源（核对 2026-11-05）：[成为钉钉开发者](https://open.dingtalk.com/document/orgapp/become-a-dingtalk-developer)、[ISV 合作指南](https://open.dingtalk.com/document/isvapp/isv-cooperation-guide)。**短期内不现实。**

### 1.3 限流与用量（重点风险）

- **用量配额**（已核对，来源（核对 2026-11-05）：[计费模型](https://open.dingtalk.com/document/orgapp/dingtalk-application-development-platform-billing-model)）

| 客户组织的版本 | API 调用量/月 | Webhook 和 Stream 推送/月 | QPS | 价格 |
|---|---|---|---|---|
| 标准版 | 1 万 | **5000** | 20 | 免费 |
| 专业版 | 50 万 | 5 万 | 40 | 9800 元/年 |
| 专属版 | 550 万 | 10 万 | 60 | 联系销售 |

- **超额后果**（已核对）：机器人只收到错误码 20001（「当前我的消息服务已经暂停」），消息内容为空。来源（核对 2026-11-05）：[接收消息](https://open.dingtalk.com/document/orgapp/receive-message)
  - **这个配额按客户组织计算，不由我们承担**，但会直接影响体验：一个 20 人团队每人每天发 10 条，一个月大约 4000 条，已经接近上限。
  - 产品上要做三件事：把 20001 识别出来，在频道状态里提示；在接入指引里写明这个限制；回复尽量走 sessionWebhook，节省 API 调用量（sessionWebhook 是否计入 API 调用量：未核实）。
- **QPS 限流**（已核对）：单应用单接口，标准版 20 QPS；单 IP 20 秒内超过 1 万次，封 5 分钟。来源（核对 2026-11-05）：[限流处理](https://open.dingtalk.com/document/orgapp/how-to-process-api-throttling-on-the-dingtalk-server)
- 机器人发送接口、`card/streaming` 的具体频率上限：**未核实**（错误码表里只有 `send.too.fast`，没给阈值）。流式更新要做节流，例如每 300–500 ms 合并一次（工程建议，未实测）。
- 自定义群机器人：每分钟 20 条，超过会被限流 10 分钟（已核对）。来源（核对 2026-11-05）：[自定义机器人](https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages)

### 1.4 私有化

- 专属钉钉支持混合云部署和数据私有化存储，有一批专属 OpenAPI（已核对）。来源（核对 2026-11-05）：[专属钉钉概述](https://open.dingtalk.com/document/orgapp/dedicated-dingtalk-overview)
- 专有钉钉（政务等完全私有部署）的开发接口与公有云是否一致：**未核实**。

---

## 2. 企业微信

### 2.1 推荐通道：智能机器人（API 模式）

- **创建**（已核对）
  - 管理后台路径：智能专区 → 智能机器人 → 创建 → API 模式。成员在客户端也能创建（v5.0 起），但只有可见范围内的成员能用。
  - 每个企业最多 300 个机器人，每个成员最多 20 个。
  - 来源（核对 2026-11-05）：[帮助中心](https://open.work.weixin.qq.com/help2/pc/21663)、[概述](https://developer.work.weixin.qq.com/document/path/101039)
- **收消息**（已核对）
  - 单聊能收文本、图文、引用、图片、语音、文件、视频。
  - 群里 @ 机器人只能收文本、图文、引用，并且「仅支持添加至企业内部群」（外部群、互联群不行）。
  - 同一用户和同一机器人之间，最多同时有 3 条消息在处理中。
  - 来源（核对 2026-11-05）：[接收消息](https://developer.work.weixin.qq.com/document/path/100719)
- **长连接模式**（已核对）
  - 连接 `wss://openws.work.weixin.qq.com`，发送 `aibot_subscribe`，带上 BotID 和长连接 Secret。不需要公网 IP，也不需要加解密；每 30 秒发一次 ping。
  - **每个机器人同一时间只能有 1 条有效连接**：新连接订阅成功后，旧连接会收到 `disconnected_event` 并被踢掉。
  - 回复用 `aibot_respond_msg`，同一个 `req_id` 下按 `stream.id` 持续推送；必须在 **10 分钟**内发出 `finish=true`。
  - 主动推送用 `aibot_send_msg`，前提是用户先在这个会话里给机器人发过消息。
  - 来源（核对 2026-11-05）：[长连接](https://developer.work.weixin.qq.com/document/path/101463)
- **URL 回调模式**（已核对）
  - 回调是加密的 JSON。首次回复 `stream`，之后企微会发「流式刷新」回调来拉取最新内容，最长 6 分钟。
  - `response_url` 1 小时内有效，只能用一次。
  - 来源（核对 2026-11-05）：[被动回复](https://developer.work.weixin.qq.com/document/path/101031)、[主动回复](https://developer.work.weixin.qq.com/document/path/101138)、[加解密](https://developer.work.weixin.qq.com/document/path/101033)
  - 这个模式要用公网 URL，域名主体规则是否适用于智能机器人：未核实。**建议只做长连接。**
- **流式内容**（已核对）：总长不超过 20480 字节，支持常用 markdown，`<think>` 会显示为思考过程。图片只能在最后一包里发（base64，不超过 10 MB，最多 10 张）。
- **身份**（已核对）
  - 只有当机器人创建者是超级管理员时，`from.userid` 才是明文；否则是加密的 open_userid，需要再配一个自建应用的 access_token 调接口转换。
  - 来源（核对 2026-11-05）：[userid 转换](https://developer.work.weixin.qq.com/document/path/101521)
  - 对我们来说，按会话做上下文时，open_userid 就是稳定标识，不必转换；只有需要明文 UserID 时才要转（未实测）。
- **媒体**（已核对）：入站媒体给的是 URL，5 分钟内有效，下载下来是密文，要用 AES-256-CBC 解密（长连接模式每个 URL 带一个 `aeskey`）。文件上限 100 MB。
- **官方 Node SDK**：`@wecom/aibot-node-sdk`。来源（核对 2026-11-05）：[官方教程](https://open.work.weixin.qq.com/spnews?uuid=ooGgQDz7VYBQoJBERbYoLS)。这一条来自搜索摘要，SDK 本身没有拉下来验证（未核实）。

### 2.2 其他通道

- **自建应用回调**（已核对）
  - 能收单聊消息。回调 5 秒不响应就重试 3 次。来源（核对 2026-11-05）：[概述](https://developer.work.weixin.qq.com/document/path/90238)、[消息格式](https://developer.work.weixin.qq.com/document/path/90239)
  - 群消息：文档里**没有**接收途径（未核实，没有官方明确否定的原文）。`appchat/send` 只能往应用自己建的群里发。来源（核对 2026-11-05）：[应用推送消息](https://developer.work.weixin.qq.com/document/path/90248)
  - **可信 IP**：2022-06-20 之后新建的自建应用，必须配置可信 IP 才能调接口。来源（核对 2026-11-05）：[开发前必读](https://developer.work.weixin.qq.com/document/path/90664)
  - **域名**：「配置域名的备案主体需要与企业认证主体相同，或具有关联关系」。来源（核对 2026-11-05）：[域名主体说明](https://open.work.weixin.qq.com/wwopen/common/readDocument/40754)
  - 是否需要 corpId 和应用 Secret：需要，用 corpId + Secret 换取 access_token（已核对）。来源（核对 2026-11-05）：[开发前必读](https://developer.work.weixin.qq.com/document/path/90664)
- 结论：在 Cloud 上，客户无法把 lobehub.com 配置成他们的回调域名，所以这条路**不适合 SaaS**，只适合私有化部署。自建应用也没有流式能力。
- **群机器人 webhook**（「消息推送」）：**只能发**，每分钟 20 条（已核对）。来源（核对 2026-11-05）：[消息推送](https://developer.work.weixin.qq.com/document/path/91770)

### 2.3 资质与审核

- **人数上限**（已核对）：未认证企业最多 100 人使用，通讯录上限 1000 人。来源（核对 2026-11-05）：[帮助中心 14936](https://open.work.weixin.qq.com/help2/pc/14936)
- **认证费用**（已核对）：审核费 300 元/次，每年年审。来源（核对 2026-11-05）：[帮助中心 19734](https://open.work.weixin.qq.com/help2/pc/19734)
- 未认证企业能否创建智能机器人：**未核实**。帮助中心没有把认证列为前提，测试时需要实测确认。
- **审核周期**：智能机器人的创建和发布，文档里没有提到审核环节，创建后在可见范围内即可使用（未核实，未实测）；自建应用在本企业内部使用也不需要平台审核。企业认证本身的审核时长官方没写（未核实）。来源（核对 2026-11-05）：[帮助中心 21663](https://open.work.weixin.qq.com/help2/pc/21663)
- **第三方应用 / 服务商**（对应 System Bot 形态）：要先做服务商认证，上线还要审核，搜索摘要说需要 1–3 个工作日（未核实）。

### 2.4 限流（已核对）

- 智能机器人：每个会话回复加主动推送合计 **30 条/分钟、1000 条/小时**；收到消息后 24 小时内可以回复；上传素材每个机器人 30 次/分钟。来源（核对 2026-11-05）：[长连接](https://developer.work.weixin.qq.com/document/path/101463)
  - 流式更新是否每次都计入这 30 条/分钟：**未核实**。这一点必须实测；如果计入，流式推送要节流到每 2 秒 1 包以内。
- 通用 API：每个企业单接口 1 万次/分钟、15 万次/小时；应用消息对同一成员 30 次/分钟。来源（核对 2026-11-05）：[频率限制](https://developer.work.weixin.qq.com/document/path/90312)
- 没有类似钉钉的月度免费配额（文档没看到，未核实）。

### 2.5 私有化

企业微信私有部署版和政务微信都存在，但两者的 API 能力、是否支持智能机器人：**未核实**（只看过产品页摘要）。

---

## 3. 接入形态建议

### 3.1 per-agent bot（推荐两个平台都先走这条）

和现有的飞书、QQ、Slack Socket Mode 一样：用户在 Agent → Channel 里填写自己企业的应用凭证，消息由 message gateway 维持长连接后转发到 webhook 管线。

| 平台 | 凭证字段 | connectionMode | 参照实现 |
|---|---|---|---|
| 钉钉 | Client ID（AppKey）、Client Secret、RobotCode（可选，默认等于 AppKey，未核实） | `websocket`（Stream） | `feishu/gateway.ts`：长连接收到事件后 POST 到 webhookPath |
| 企微 | BotID、Secret | `websocket`（长连接） | 同上 |

代码落点（参照现有的平台）：

- `lobehub/packages/chat-adapter-dingtalk` 和 `chat-adapter-wecom`：实现 chat SDK adapter。
- `lobehub/apps/server/src/services/bot/platforms/{dingtalk,wecom}`：definition、schema、client，以及 `protocol-spec.md`。
- 在 `platforms/index.ts` 和 `messageCapabilities.ts` 中注册。
- 前端 `src/features/AgentChannel` 增加平台入口、快速接入指引和 i18n。
- 这些都是通用渠道能力，全部落在开源仓库。

两个需要提前设计的点：

1. **企微单连接限制**：gateway 存在多主机或双主机部署（`gateway/index.dualHost.test.ts`）。必须保证每个 BotID 全局只有一个 owner，否则两条连接会互相踢掉，造成抖动。另外，**同一个机器人不能同时接到 Cloud 和自部署（或开发环境）**，接入指引里要写清楚。
2. **钉钉流式输出**：AI 卡片要额外申请权限，总大小建议不超过 3 KB。第一版可以先用 sessionWebhook 发最终 markdown，配合「思考中」占位，验证主链路后再加卡片流式输出。

### 3.2 System Bot（workspace 安装）：暂不建议

- 钉钉需要 ISV 方案商认证并满足上架门槛；企微需要服务商认证和上线审核。
- 两者都要求我们以服务商主体去申请，周期和门槛都不可控。
- 建议放在 per-agent bot 跑通、确认有客户需求之后，再作为第二阶段立项。

### 3.3 私有化 / 自建部署

- 两个平台的推荐通道都只需要**出站连接**，自部署的 LobeHub 不需要公网 IP 或备案域名就能用。
- 这和 Cloud 用的是同一套代码，**不需要为自部署单独开发**。
- 私有化下可能缺失的能力：
  - 企微自建应用回调只能用于私有化部署：客户用自有的备案域名、配置可信 IP 后，才能接入。这一条不适用于 Cloud。
  - 钉钉的 Stream 模式只适用于「企业内部开发和第三方企业应用」，在专属钉钉或专有钉钉上是否可用：未核实。
  - 企微私有版或政务微信是否提供智能机器人和长连接：未核实。如果不提供，只能退回自建应用回调，届时只有单聊、没有流式。
- 真正的「平台侧私有化」（专属钉钉、专有钉钉、企微私有版、政务微信）接口是否兼容：未核实，要有具体客户后再评估。

### 3.4 群聊 / 话题

- 群里 @ 机器人：两个平台都支持（只限内部群），可以和单聊一起交付。
- 话题 / 线程：两个平台都没找到对应的开放能力（未核实）。**无法对齐飞书话题群那条线**，群聊只能按「整群一个会话」或「按发送者分会话」处理。

---

## 4. 需要 维护者 拍板

1. **平台优先级**
   - 建议**先做企微、再做钉钉**，两者串行。
   - 理由：企微原生支持流式输出、没有月度免费配额的坑、主链路更短。钉钉免费版每月 5000 条的上限对试用客户影响大，而且流式输出要额外接卡片。
   - 如果目标客户集中在钉钉，可以对调顺序。
2. **目标客户是否要求私有化**
   - 只要求 LobeHub 自部署：现有方案已覆盖。
   - 要求专属钉钉、企微私有版等平台侧私有化：需要客户提供环境，单独评估。
3. **是否需要群聊 / 话题**
   - 群里 @ 建议第一版就带上，成本低。
   - 话题线程平台本身不支持，需要确认是否接受「不对齐飞书话题群」。
4. **钉钉 5000 条/月的限制**：是否接受只在接入指引里提示，由客户自行升级钉钉专业版。
5. **测试企业**：需要提供或申请钉钉、企微的测试企业，以及管理员账号（注册需要真实手机号或实名）。这是跑通实测收发的前置条件，目前**阻塞在这里**。

## 5. 「未实测」清单

截至 2026-11-05，**下列各项都没有在真实企业里验证过**；上文标「已核对」的结论，也只代表官方文档原文这么写。

| # | 平台 | 未实测项 |
|---|---|---|
| U1 | 钉钉 | 企业内部机器人用 Stream 模式能否在单聊和群里 @ 收到消息 |
| U2 | 钉钉 | sessionWebhook 回复是否可用、实际有效期多长（文档没写有效期） |
| U3 | 钉钉 | AI 卡片流式更新的实际频率上限、3 KB 总大小对长回复的影响 |
| U4 | 钉钉 | 未认证组织能否创建内部应用和机器人 |
| U5 | 钉钉 | 超出 5000 次/月后 20001 错误的实际表现 |
| U6 | 钉钉 | 自定义机器人 Outgoing 机制是否仍可用（目前按「只推不收」处理） |
| U7 | 企微 | 未认证企业能否创建 API 模式智能机器人 |
| U8 | 企微 | 长连接单聊、群里 @ 收发，以及流式回复 |
| U9 | 企微 | 流式包是否计入每个会话 30 条/分钟 |
| U10 | 企微 | 第二条连接接入时旧连接是否被踢，gateway 能否恢复 |
| U11 | 企微 | 非超级管理员创建的机器人，open_userid 能否作为稳定的会话标识 |
| U12 | 企微 | 群机器人 webhook 只能发（文档已核对，未实测；文档里没有任何接收机制） |
| U13 | 两者 | 平台侧私有化版本的接口兼容性 |
| U14 | 两者 | 话题 / 线程能力（文档没找到） |

## 6. 实测计划（结论确认、拿到测试企业后执行）

- [ ] 企微：用未认证测试企业创建 API 模式智能机器人，验证不认证也能创建（目前未实测）。
- [ ] 企微：长连接单聊发 text，agent 流式回复；观察流式包是否计入 30 条/分钟。
- [ ] 企微：第二条连接接入时，旧连接是否被踢，gateway 能否恢复。
- [ ] 钉钉：标准版组织创建内部应用机器人，用 Stream 模式单聊，经 sessionWebhook 回复。
- [ ] 钉钉：sessionWebhook 的实际有效期；20001 超额提示的表现（可能无法实际触发，就记为未实测）。
- [ ] 两个平台：群里 @ 机器人收发；入站图片下载。

证据：机器人对话截图，加上 gateway 和 webhook 日志。按 acceptance 流程发布。
