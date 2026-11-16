# 企业微信智能机器人（API 模式・长连接）通信协议规范

> 适用对象：`@lobechat/chat-adapter-wecom` 与 `platforms/wecom` 的实现与维护者。
>
> 整理依据（均于 2026-11-05 核对）：企业微信开发者文档 [长连接](https://developer.work.weixin.qq.com/document/path/101463)、[接收消息](https://developer.work.weixin.qq.com/document/path/100719)、[userid 转换](https://developer.work.weixin.qq.com/document/path/101521)，以及官方 Node SDK `@wecom/aibot-node-sdk@1.0.7`（MIT）的帧格式与行为。
>
> **全部未实测**：截至 2026-11-05 没有企微测试企业与管理员账号，本文和实现都只对照了官方文档与 SDK 源码，真实收发尚未跑通。标注「工程选择」的是本仓库的实现决定，不是平台规定。

## 1. 概述

| 项目     | 说明                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 接入形态 | per-agent bot：用户在 Agent → Channel 填 BotID + Secret                  |
| 连接     | 出站 WebSocket `wss://openws.work.weixin.qq.com`，无需公网 IP / 回调域名 |
| 收消息   | 单聊；企业内部群里 @ 机器人（外部群、互联群不支持）                      |
| 回复     | 同一条连接上的 `aibot_respond_msg`（被动）/ `aibot_send_msg`（主动）     |
| 限制     | **每个机器人同一时间只有 1 条有效连接**，新连接订阅成功会踢掉旧连接      |

和飞书 / QQ 的关键差异：企微智能机器人**没有 REST 发送接口**，回复、流式、主动推送都必须走持有连接的那条 WebSocket。所以：

- 回复只能由持有连接的一方发出。定义上标 `repliesOverConnection: true`，由 `gateway/replyConnectionHost.ts` 的 `resolveReplyConnectionHost()` 判定当前部署由谁持有连接：

  | 持有方            | 条件                                                                                            | 出站路径                                                                                                                                                      |
  | ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `in-process`      | 没有外部 message gateway、也不是 Vercel：单个长驻服务进程自己维持连接                           | 连接把自己登记在进程内注册表（`registry.ts`，挂在 `globalThis`），adapter /messenger 从注册表取连接发送；本进程没有连接时抛 `WeComConnectionUnavailableError` |
  | `message-gateway` | 开了外部 message gateway，且 `wecom` 在 `MESSAGE_GATEWAY_NODE_PLATFORMS` 里（路由到 Node 网关） | Node 网关持有连接和回复状态；服务端经 `MessageGatewayClient.sendText` / `startTyping` 让网关代发（`wecom/outbound.ts`）                                       |

  两种部署不行（返回 `undefined`）：

  - Vercel 等 serverless 且没有 gateway：连接活在 gateway cron 那次调用里，webhook 和回调落在别的调用，摸不到 socket；
  - 开了 gateway 但企微留在默认（Cloudflare）网关上：它只转发入站，不中继出站帧。

  不能用时：平台目录把它标为 `unavailableReason`，渠道列表对没有企微 bot 的 agent 隐藏（已配置的仍可打开、停用、删除），新建被拒绝，reconcile 和 cron 不拉起连接，直接 connect 写 failed 状态并抛错说明原因。

- 走 Node 网关时，服务端与网关的约定：
  - connect：`{ platform: 'wecom', connectionId: <agent_bot_providers.id>, applicationId: <BotID>, connectionMode: 'websocket', credentials: { secret }, webhookPath: '/api/agent/webhooks/wecom/<BotID>' }`；
  - 入站：网关把每个消息帧按 3.3 节签名转发到 `webhookPath`，与进程内连接完全一致；
  - 出站：`POST /api/connections/:id/send`（`deliver`：结束打开的 stream → 回复最新消息 → 主动推送）和 `POST /api/connections/:id/typing`（打开 stream，可重复调用）。网关回 404 说明连接 id 变了（同一 BotID 重建了 bot），服务端重新查一次再发；
  - 被别处顶掉（`disconnected_event`）或续连鉴权彻底失败时，网关把连接置为 `error` 并带 `needsReauth`，reconcile 的 `ensure` 连接得到 409、保持停放，不会把机器人抢回来造成抖动；用户保存凭证或手动重连（非 `ensure`）才会重新订阅。

- **多副本长驻部署不行**：每个副本的 GatewayManager 都会拉起同一个机器人，互相踢下线（见 2 节），最后只剩一个副本持有连接，而转发和回调可能被负载均衡到别的副本。只支持单实例。Node 网关本身也是单副本。

## 2. 帧格式

收发统一为 `{ cmd, headers: { req_id }, body }`。服务端对订阅、心跳和每个回复帧都回一个**无 `cmd`、`req_id` 相同、带 `errcode` / `errmsg`** 的回执。

| cmd                    | 方向    | 说明                                                 |
| ---------------------- | ------- | ---------------------------------------------------- |
| `aibot_subscribe`      | 客户端→ | `body: { bot_id, secret }`，回执 `errcode: 0` 即成功 |
| `ping`                 | 客户端→ | 心跳，默认 30 秒一次                                 |
| `aibot_msg_callback`   | →客户端 | 消息推送                                             |
| `aibot_event_callback` | →客户端 | 事件推送（`enter_chat`、`disconnected_event` 等）    |
| `aibot_respond_msg`    | 客户端→ | 被动回复，`req_id` 必须是入站消息的 `req_id`         |
| `aibot_send_msg`       | 客户端→ | 主动推送，`body.chatid` 单聊填 userid、群聊填 chatid |

工程选择：

- 同一 `req_id` 的帧串行发送，前一帧收到回执（或 10 秒超时）后才发下一帧，与官方 SDK 一致，避免流式帧乱序。
- 连续 2 个心跳没有回执视为断线，指数退避重连（1s 起，上限 30s）。首次订阅失败直接让 `start()` 报错，不重试；运行中重连被拒（Secret 被改、机器人被删）停止连接并上报 failed。
- 收到 `disconnected_event`（被新连接踢下线）后**不重连**，上报 failed，错误信息说明「同一个 BotID 被别处接管」。重连只会把对方再踢回去，形成抖动。

## 3. 入站

### 3.1 消息体（`aibot_msg_callback.body`）

| 字段          | 说明                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `msgid`       | 本次回调唯一标识，作为 chat SDK `Message.id`                                                           |
| `aibotid`     | 机器人 ID；与本 adapter 的 BotID 不一致的帧被忽略                                                      |
| `chattype`    | `single` 单聊 / `group` 群聊                                                                           |
| `chatid`      | 仅群聊有                                                                                               |
| `from.userid` | 发送者。机器人创建者是超级管理员时为明文 userid，否则为 open\_userid（加密但对同一机器人稳定，未实测） |
| `msgtype`     | `text` / `image` / `mixed` / `voice` / `file` / `video`                                                |
| `quote`       | 引用的消息（可选）                                                                                     |

群聊里只收得到 text /mixed/quote（官方文档）。语音到达时已转成文字（`voice.content`）。

### 3.2 线程 ID

- 单聊：`wecom:single:<userid>`
- 群聊：`wecom:group:<chatid>`（整群一个会话；企微没有话题 / 线程能力，无法对齐飞书话题群）

### 3.3 转发与签名（工程选择）

连接持有者把入站消息帧原样 POST 到 `/api/agent/webhooks/wecom/<BotID>`，进入与其他平台相同的 webhook 管线。为防止知道 BotID 的人伪造消息，转发带两个头，webhook 校验失败返回 401：

| Header                      | 值                                               |
| --------------------------- | ------------------------------------------------ |
| `x-lobehub-wecom-timestamp` | 毫秒时间戳，偏差超过 5 分钟拒绝                  |
| `x-lobehub-wecom-signature` | `hex(HMAC-SHA256(Secret, "<timestamp>.<body>"))` |

将来由外部 gateway 持有连接时，gateway 也必须按这个格式签名。

### 3.4 群 @

企微只推送 @ 了机器人的群消息，adapter 把群消息一律标为 `isMention = true`，并去掉正文开头的 `@名字`（只去开头一个，未实测真实群消息里 @ 的位置与格式）。

### 3.5 媒体

图片 / 文件 / 视频给的是 5 分钟内有效的加密下载 URL，长连接模式每个 URL 带一个 `aeskey`。解密：AES-256-CBC，key = base64 解码后的 32 字节，IV = key 前 16 字节，PKCS#7 填充到 **32 字节块**（Node 默认按 16 字节去填充会报错，需要手动去）。`extractFiles` 在处理消息时立刻下载解密，失败的转成提示词警告，不让整条消息失败。

## 4. 出站

### 4.1 流式回复映射（工程选择）

LobeHub 的回复管线没有 token 级流式；平台定义 `supportsMessageEdit: false`，因此开跑时只调 `startTyping`，结束时发一条最终回复。映射为企微原生 stream：

1. 收到消息时记录该会话最新一条消息的 `req_id`。
2. `startTyping` / `triggerTyping` → 用这个 `req_id` 打开一个 stream（`finish: false`、内容为空，显示为「正在回复」气泡）。同一会话已有打开的 stream 时不重复打开。
3. 最终回复 `postMessage` / `createMessage` → 在同一 stream 上发 `finish: true` + 全文。
4. 没有打开的 stream、但最新消息还没回复 → 直接用它的 `req_id` 发一帧 `finish: true` 的 stream。
5. 都没有（已经回复过、超过 24 小时回复窗口）→ `aibot_send_msg` 主动推送 markdown。
6. 被动发送失败时回退到主动推送，避免回复丢失。

空内容的 `finish: false` stream 在客户端如何显示：未实测。

已知限制（工程选择，均未实测）：

- 回复上下文按**会话**保存，只记最新一条消息的 `req_id`。群里两人先后 @ 机器人、第一条还没开始回复时，第一条的回答会挂在第二条消息的 stream 上，第二条的回答改走主动推送。
- 打开「处理中」消息（`processingMessage`）时，这条确认消息会先用掉 stream，最终回复因此走主动推送，显示为一条新消息而不是对原消息的回复。
- 回复上下文和打开的 stream 跟连接放在一起。连接被替换（保存凭证、手动重连、管理后台重新注册）时它们会清空：替换前已经开跑的回答找不到 `req_id`，改走主动推送，之前打开的「正在回复」气泡由 WeCom 自行超时。
- 网关重启（部署）或重连期间，网关上暂时没有这个 bot 的连接：`/send` 返回 404 或 `not connected`，或者连不上网关。服务端按退避重试约 1 分钟（`WECOM_GATEWAY_RETRY_DELAYS_MS`），等网关重新注册连接后以主动推送送达。只重试确定没发出去的失败：`sendText` 没有幂等键，收据丢失（`connection closed`）、请求中途断开（`ECONNRESET`）这类可能已经送达的失败直接报错，企微自己拒绝的也不重试，避免重复回复。网关停连接时先用 `drain()` 给打开的 stream 发 `finish`（内容 `…`），不再留下一直转圈的气泡（T-14145，线上 2026-11-16 网关部署时出现过一次回复丢失）。

### 4.2 限制

| 限制                                       | 处理                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| stream 首帧后 10 分钟内必须 `finish`       | 打开 9 分钟仍未完成时自动以已有内容（或 `…`）结束，最终回复改走主动推送     |
| stream 内容 ≤ 20480 字节                   | `charLimit` 默认且最大 6000 字（全是 3 字节汉字也不超）；发送前再按字节截断 |
| 收到消息后 24 小时内可回复                 | 超过窗口的 `req_id` 不再使用                                                |
| 每会话 30 条 / 分钟、1000 条 / 小时        | 一次回复只用 1～2 帧；流式包是否计入该配额：未实测                          |
| 主动推送前提：用户在该会话给机器人发过消息 | 只在已有会话里推送                                                          |

### 4.3 暂不支持

- 出站附件（图片 / 文件需要先走分片上传 `aibot_upload_media_*` 拿 `media_id`），v1 只发文字。
- 编辑、撤回、表情回应、读历史（消息工具对企微全部不可用，历史靠预注入的近期会话摘要）。
- 欢迎语（`enter_chat`）、模板卡片、用户反馈事件。

## 5. 凭证校验

`validateCredentials` 用一条临时连接订阅一次再断开。因为新订阅会踢掉旧连接，**本进程已经用同一 Secret 持有该机器人的活连接时直接判定有效，不再探测**。机器人如果同时接在别处（另一套部署、本地开发环境），探测或保存都会把那边踢下线 —— 接入指引里写明「同一个机器人同一时间只能接入一处」。
