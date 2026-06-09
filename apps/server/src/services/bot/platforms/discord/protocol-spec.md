# Discord Bot REST API v10 消息操作协议规范

> 适用对象：实现 Discord Bot 消息工具（Message Tool）的 SDK、网关和独立 Bot。
>
> 整理依据：Discord 官方 REST API v10 文档 (`https://docs.discord.com/developers/resources/message`)、`discord-api-types/v10` TypeScript 类型定义、`@discordjs/rest` SDK 实现。
>
> 说明：文中标注 "工程建议" 的内容来自现有客户端实现经验，用于提高兼容性；它们不是服务端返回字段本身的一部分。

## 1. 概述

Discord Bot REST API v10 是 Discord 官方提供的 HTTP/JSON 协议，用于 Bot 对频道消息进行 CRUD 操作、表情反应、置顶、线程管理等。协议基座地址是 `https://discord.com/api/v10`。协议核心特征有四点：一是认证方式采用 `Authorization: Bot {token}` 头部；二是所有标识符均为 Snowflake（64 位整数的字符串表示）；三是速率限制通过响应头动态下发，客户端必须解析并遵守；四是需要 `MESSAGE_CONTENT` 特权意图（Privileged Intent）才能读取消息内容字段。

## 2. 认证与公共请求规范

### 2.1 认证方式

Discord Bot 使用 Bot Token 进行认证，Token 在 Discord Developer Portal 创建应用时获取。

| Header          | 示例值                          | 是否必需 | 说明                            |
| --------------- | ------------------------------- | -------- | ------------------------------- |
| `Authorization` | `Bot MTk4NjIy.Cl2FMQ.ZnCjm...`  | 是       | 固定前缀 `Bot` 加空格加 Token。 |
| `Content-Type`  | `application/json`              | 是       | JSON 请求体时必须带上。         |
| `User-Agent`    | `DiscordBot (https://url, 1.0)` | 是       | Discord 要求携带 User-Agent。   |

### 2.2 基座地址

```
https://discord.com/api/v10
```

所有接口 URL 均相对于此基座地址。例如 `GET /channels/{channel.id}/messages` 的完整 URL 为 `https://discord.com/api/v10/channels/123456789/messages`。

### 2.3 Snowflake 标识符

Discord 使用 Snowflake 作为全局唯一 ID，格式为字符串化的 64 位整数。示例：`"1234567890123456789"`。Snowflake 包含时间戳信息，可用于分页和排序。

### 2.4 速率限制

Discord 的速率限制分为全局和按路由两级。

**全局速率限制**

每个 Bot Token 全局上限为 **50 请求 / 秒**。交互端点（Interaction endpoints）不受此限。

**按路由速率限制**

每个路由有独立的请求配额。主要参数（Major Parameters）包括 `channel_id`、`guild_id`、`webhook_id`，相同主要参数共享桶（bucket）。

**速率限制响应头**

| Header                    | 类型      | 说明                                        |
| ------------------------- | --------- | ------------------------------------------- |
| `X-RateLimit-Limit`       | `number`  | 当前桶允许的总请求数。                      |
| `X-RateLimit-Remaining`   | `number`  | 当前桶剩余可用请求数。                      |
| `X-RateLimit-Reset`       | `number`  | 桶重置的 Unix 时间戳（秒，含小数）。        |
| `X-RateLimit-Reset-After` | `number`  | 距桶重置的剩余秒数（含小数）。              |
| `X-RateLimit-Bucket`      | `string`  | 桶的唯一标识符。                            |
| `X-RateLimit-Global`      | `boolean` | 仅在 429 响应中出现，表示触发的是全局限制。 |
| `X-RateLimit-Scope`       | `string`  | 限制范围：`user`、`global` 或 `shared`。    |

**429 响应体**

```json
{
  "global": false,
  "message": "You are being rate limited.",
  "retry_after": 1.234
}
```

| 字段          | 类型      | 说明                       |
| ------------- | --------- | -------------------------- |
| `message`     | `string`  | 错误信息。                 |
| `retry_after` | `number`  | 需要等待的秒数（浮点数）。 |
| `global`      | `boolean` | 是否为全局速率限制。       |

**工程建议**

- 动态解析响应头中的速率限制信息，不要硬编码限制值。
- 收到 429 响应后，等待 `retry_after` 秒再重试。
- IP 地址在 10 分钟内产生超过 10,000 个无效请求（401、403、429）会被 Cloudflare 临时封禁。
- 使用 `@discordjs/rest` 等 SDK 时，库内部已自动处理速率限制，通常无需手动管理。

## 3. 消息对象（Message Object）

### 3.1 核心字段

| 字段                 | 类型                 | 说明                                                |
| -------------------- | -------------------- | --------------------------------------------------- |
| `id`                 | `snowflake`          | 消息 ID。                                           |
| `channel_id`         | `snowflake`          | 消息所在频道 ID。                                   |
| `author`             | `User`               | 消息发送者；Webhook 消息的 author 信息不完整。      |
| `content`            | `string`             | 消息文本内容，最多 2000 字符。                      |
| `timestamp`          | `ISO8601`            | 消息创建时间。                                      |
| `edited_timestamp`   | `ISO8601?`           | 最后编辑时间；未编辑时为 `null`。                   |
| `tts`                | `boolean`            | 是否为 TTS（文本转语音）消息。                      |
| `mention_everyone`   | `boolean`            | 是否 @everyone。                                    |
| `mentions`           | `User[]`             | 被 @ 的用户列表。                                   |
| `mention_roles`      | `snowflake[]`        | 被 @ 的角色 ID 列表。                               |
| `mention_channels`   | `ChannelMention[]?`  | 被 @ 的频道列表（仅公共服务器跨频道提及时出现）。   |
| `attachments`        | `Attachment[]`       | 附件列表。                                          |
| `embeds`             | `Embed[]`            | 富嵌入列表，最多 10 个。                            |
| `reactions`          | `Reaction[]?`        | 表情反应列表。                                      |
| `nonce`              | `integer \| string?` | 发送消息时的校验标识，最多 25 字符。                |
| `pinned`             | `boolean`            | 是否被置顶。                                        |
| `webhook_id`         | `snowflake?`         | Webhook 创建者 ID。                                 |
| `type`               | `integer`            | 消息类型（0=DEFAULT, 19=REPLY 等，完整枚举 0-46）。 |
| `flags`              | `integer?`           | 消息标志位域。                                      |
| `message_reference`  | `MessageReference?`  | 回复 / 转发引用信息。                               |
| `referenced_message` | `Message?`           | 被引用的消息对象。                                  |
| `thread`             | `Channel?`           | 由此消息创建的线程。                                |
| `components`         | `Component[]?`       | 交互组件（按钮、选择菜单等）。                      |
| `sticker_items`      | `StickerItem[]?`     | 贴纸列表。                                          |
| `poll`               | `Poll?`              | 投票数据。                                          |
| `position`           | `integer?`           | 消息在线程中的近似位置。                            |
| `application_id`     | `snowflake?`         | 关联的应用 ID。                                     |

### 3.2 消息标志（Message Flags）

| 标志                     | 值        | 说明                                |
| ------------------------ | --------- | ----------------------------------- |
| `CROSSPOSTED`            | `1 << 0`  | 已发布到关注此频道的频道。          |
| `IS_CROSSPOST`           | `1 << 1`  | 来自频道关注的消息。                |
| `SUPPRESS_EMBEDS`        | `1 << 2`  | 隐藏嵌入内容。                      |
| `SOURCE_MESSAGE_DELETED` | `1 << 3`  | 源消息已被删除。                    |
| `URGENT`                 | `1 << 4`  | 紧急消息。                          |
| `HAS_THREAD`             | `1 << 5`  | 此消息有关联线程。                  |
| `EPHEMERAL`              | `1 << 6`  | 临时消息，仅调用者可见。            |
| `LOADING`                | `1 << 7`  | 交互延迟响应（"正在思考..."）。     |
| `SUPPRESS_NOTIFICATIONS` | `1 << 12` | 不触发推送通知。                    |
| `IS_VOICE_MESSAGE`       | `1 << 13` | 语音消息。                          |
| `IS_COMPONENTS_V2`       | `1 << 15` | 使用 Components V2 布局（不可变）。 |

### 3.3 MESSAGE_CONTENT 特权意图

没有 `MESSAGE_CONTENT` 意图（`1 << 15`）的 Bot，收到的消息对象中 `content`、`embeds`、`attachments`、`components` 字段为空，`poll` 字段不会出现。

**工程建议**

- 在 Discord Developer Portal 中为 Bot 启用 `MESSAGE_CONTENT` 意图。
- 当 Bot 加入超过 100 个服务器时，需要通过 Discord 的审核流程才能使用该意图。

## 4. 消息读取

### 4.1 获取频道消息列表

**Method**

`GET`

**URL**

`/channels/{channel.id}/messages`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Query Parameters**

| 参数     | 类型        | 默认值 | 约束                      | 说明                     |
| -------- | ----------- | ------ | ------------------------- | ------------------------ |
| `around` | `snowflake` | 无     | 与 `before`/`after` 互斥  | 获取指定 ID 附近的消息。 |
| `before` | `snowflake` | 无     | 与 `around`/`after` 互斥  | 获取指定 ID 之前的消息。 |
| `after`  | `snowflake` | 无     | 与 `around`/`before` 互斥 | 获取指定 ID 之后的消息。 |
| `limit`  | `integer`   | 50     | 1–100                     | 返回的最大消息数。       |

**所需权限**

- `VIEW_CHANNEL`（服务器频道）
- `CONNECT`（语音频道）
- `READ_MESSAGE_HISTORY`（缺少时返回空数组）

**Response**

成功时返回 `Message[]`（消息对象数组），按时间从新到旧排序。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages?limit=10&before=987654321098765432' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**工程建议**

- `before`、`after`、`around` 三个参数互斥，同时传多个会导致不可预测的结果。
- 使用 `before` 参数向前翻页，使用 `after` 参数向后翻页。
- 无任何分页参数时返回频道最新的消息。

## 5. 消息发送

### 5.1 创建消息

**Method**

`POST`

**URL**

`/channels/{channel.id}/messages`

**Headers**

| Header          | 是否必需 | 说明                 |
| --------------- | -------- | -------------------- |
| `Authorization` | 是       | `Bot {token}`。      |
| `Content-Type`  | 是       | `application/json`。 |

**Request Body**

| 字段                | 类型                | 是否必需 | 说明                                                                                          |
| ------------------- | ------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `content`           | `string`            | \*1      | 消息文本，最多 2000 字符。                                                                    |
| `nonce`             | `integer \| string` | 否       | 消息校验标识，最多 25 字符，用于去重。                                                        |
| `tts`               | `boolean`           | 否       | 是否为 TTS 消息。                                                                             |
| `embeds`            | `Embed[]`           | \*1      | 富嵌入数组，最多 10 个，总文本不超过 6000 字符。                                              |
| `allowed_mentions`  | `AllowedMentions`   | 否       | 控制哪些提及会触发通知。                                                                      |
| `message_reference` | `MessageReference`  | 否       | 回复 / 转发时的引用信息。                                                                     |
| `components`        | `Component[]`       | \*1      | 交互组件（按钮、选择菜单等）。                                                                |
| `sticker_ids`       | `snowflake[]`       | \*1      | 贴纸 ID 数组，最多 3 个。                                                                     |
| `files`             | `multipart`         | \*1      | 文件上传（multipart/form-data）。                                                             |
| `attachments`       | `Attachment[]`      | 否       | 部分附件对象，用于描述上传的文件。                                                            |
| `flags`             | `integer`           | 否       | 可设置：`SUPPRESS_EMBEDS`、`SUPPRESS_NOTIFICATIONS`、`IS_VOICE_MESSAGE`、`IS_COMPONENTS_V2`。 |
| `poll`              | `PollCreateRequest` | \*1      | 投票创建对象。                                                                                |
| `enforce_nonce`     | `boolean`           | 否       | 启用 nonce 去重检查（几分钟内相同 nonce 不重复发送）。                                        |

\*1：`content`、`embeds`、`sticker_ids`、`components`、`poll`、`files` 中至少需要提供一个。

**所需权限**

- `SEND_MESSAGES`（服务器频道）
- `SEND_TTS_MESSAGES`（TTS 消息时需要）
- `READ_MESSAGE_HISTORY`（回复消息时需要）

**Response**

成功时返回 `Message` 对象。触发 `MESSAGE_CREATE` 网关事件。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "content": "Hello, World!",
    "tts": false
  }'
```

**回复消息示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "content": "这是一条回复消息",
    "message_reference": {
      "message_id": "987654321098765432"
    }
  }'
```

**限制与约束**

- 最大请求体大小为 25 MiB。
- 嵌入中的 `type` 字段固定为 `"rich"`，不可修改。
- 不可手动设置嵌入中的 `provider`、`video` 以及图片尺寸字段。
- 被引用的消息必须存在且不能是系统消息。
- Discord 可能会过滤消息内容中的无效 Unicode 字符或导致格式异常的字符。

**Embed 各字段长度限制**

| 字段          | 最大字符数 |
| ------------- | ---------- |
| `title`       | 256        |
| `description` | 4096       |
| `field.name`  | 256        |
| `field.value` | 1024       |
| `footer.text` | 2048       |
| `author.name` | 256        |
| 所有文本总计  | 6000       |
| `fields` 数量 | 25         |

**AllowedMentions 对象**

| 字段           | 类型          | 说明                                                       |
| -------------- | ------------- | ---------------------------------------------------------- |
| `parse`        | `string[]`    | 允许解析的提及类型：`"roles"`、`"users"`、`"everyone"`。   |
| `roles`        | `snowflake[]` | 允许提及的角色 ID 列表（与 `parse` 中的 `"roles"` 互斥）。 |
| `users`        | `snowflake[]` | 允许提及的用户 ID 列表（与 `parse` 中的 `"users"` 互斥）。 |
| `replied_user` | `boolean`     | 回复时是否 @ 被回复的用户。                                |

**工程建议**

- 常规消息默认解析所有类型的提及；交互 / Webhook 消息默认只解析用户提及。
- 如果不需要触发通知，可使用 `flags` 设置 `SUPPRESS_NOTIFICATIONS`（`1 << 12`）。
- 文件上传需要使用 `multipart/form-data`，JSON 部分放在 `payload_json` 字段中。

## 6. 消息编辑

### 6.1 编辑消息

**Method**

`PATCH`

**URL**

`/channels/{channel.id}/messages/{message.id}`

**Headers**

| Header          | 是否必需 | 说明                 |
| --------------- | -------- | -------------------- |
| `Authorization` | 是       | `Bot {token}`。      |
| `Content-Type`  | 是       | `application/json`。 |

**Request Body**

所有参数均为可选且可为 `null`。

| 字段               | 类型               | 说明                                                                   |
| ------------------ | ------------------ | ---------------------------------------------------------------------- |
| `content`          | `string?`          | 新的消息文本，最多 2000 字符。传 `null` 清除文本。                     |
| `embeds`           | `Embed[]?`         | 新的嵌入数组。传 `[]` 清除所有嵌入。                                   |
| `flags`            | `integer?`         | 可修改 `SUPPRESS_EMBEDS`（设置 / 取消）。`IS_COMPONENTS_V2` 仅可设置。 |
| `components`       | `Component[]?`     | 新的交互组件。传 `[]` 清除组件。                                       |
| `attachments`      | `Attachment[]?`    | 编辑后应保留的附件列表（v10 中必须包含全部要保留的附件）。             |
| `allowed_mentions` | `AllowedMentions?` | 控制编辑后消息的提及通知。                                             |
| `files`            | `multipart`        | 新上传的文件（需使用 multipart/form-data）。                           |

**权限说明**

- 原始消息作者可编辑 `content`、`embeds`、`flags`、`components`。
- 非作者用户只能编辑 `flags`，且需要 `MANAGE_MESSAGES` 权限。

**Response**

成功时返回更新后的 `Message` 对象。触发 `MESSAGE_UPDATE` 网关事件。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages/987654321098765432' \
  -X PATCH \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "content": "编辑后的消息内容"
  }'
```

**重要说明**

- v10 中编辑附件时，`attachments` 数组必须包含所有要保留的附件。未列入的已有附件会被删除。
- 编辑 `content` 后，`mentions`、`mention_roles`、`mention_everyone` 会根据新内容重新计算。
- 编辑 `flags` 时，必须包含所有之前已设置的标志位，然后再加上要修改的。
- 设置 `IS_COMPONENTS_V2` 标志时，`content` 和 `poll` 必须为 `null`，`embeds` 和 `sticker_ids` 必须为 `[]`，否则返回 `400 BAD REQUEST`。
- `allowed_mentions` 会对照实际权限和消息中的提及格式做验证，防止 "幽灵 @"（收到通知但看不到提及）。

**工程建议**

- 只发送需要修改的字段，不需要重发整个消息体。
- 编辑他人消息时只能修改 `flags`（如隐藏嵌入），不能修改 `content`。

## 7. 消息删除

### 7.1 删除消息

**Method**

`DELETE`

**URL**

`/channels/{channel.id}/messages/{message.id}`

**Headers**

| Header               | 是否必需 | 说明                             |
| -------------------- | -------- | -------------------------------- |
| `Authorization`      | 是       | `Bot {token}`。                  |
| `X-Audit-Log-Reason` | 否       | 审计日志原因，URL 编码的字符串。 |

**所需权限**

- 删除自己的消息：无需额外权限。
- 删除他人的消息：需要 `MANAGE_MESSAGES` 权限。

**Response**

成功时返回 `204 No Content`。触发 `MESSAGE_DELETE` 网关事件。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages/987654321098765432' \
  -X DELETE \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  -H 'X-Audit-Log-Reason: Spam%20message'
```

**重要说明**

- 删除超过 14 天（两周）的消息时，速率限制更加严格。
- 如需批量删除，应使用 `POST /channels/{channel.id}/messages/bulk-delete` 端点（支持一次删除 2-100 条消息，但消息不能超过 14 天）。
- 只有类型为 `DEFAULT`(0)、`REPLY`(19)、`CHAT_INPUT_COMMAND`(20)、`CONTEXT_MENU_COMMAND`(23) 等的消息可被删除；系统消息通常不可删除。

**工程建议**

- 删除他人消息时，建议在 `X-Audit-Log-Reason` 中说明原因，便于服务器管理员审计。
- 批量删除大量消息时，注意处理速率限制，做好指数退避。

## 8. 表情反应

### 8.1 添加反应

**Method**

`PUT`

**URL**

`/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**URL 参数 `{emoji}` 格式**

| 类型    | 格式                  | 示例                              |
| ------- | --------------------- | --------------------------------- |
| Unicode | URL 编码的 emoji 字符 | `%F0%9F%91%8D`（👍）              |
| 自定义  | `名称:ID`             | `custom_emoji:123456789012345678` |

**所需权限**

- `READ_MESSAGE_HISTORY`（必需）。
- `ADD_REACTIONS`（当消息上还没有人使用该 emoji 反应时必需）。

**Response**

成功时返回 `204 No Content`。

**curl 示例**

```bash
# Unicode emoji（👍 = %F0%9F%91%8D）
curl 'https://discord.com/api/v10/channels/123456789012345678/messages/987654321098765432/reactions/%F0%9F%91%8D/@me' \
  -X PUT \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  -H 'Content-Length: 0'

# 自定义 emoji
curl 'https://discord.com/api/v10/channels/123456789012345678/messages/987654321098765432/reactions/custom_emoji:111222333444555666/@me' \
  -X PUT \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  -H 'Content-Length: 0'
```

**重要说明**

- emoji 必须进行 URL 编码，否则会返回 `10014: Unknown Emoji` 错误。
- 反应端点有独立的速率限制，通常每 0.25 秒只能添加 1 个反应。
- 每条消息最多可有 20 种不同的 emoji 反应。

### 8.2 获取反应用户列表

**Method**

`GET`

**URL**

`/channels/{channel.id}/messages/{message.id}/reactions/{emoji}`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Query Parameters**

| 参数    | 类型        | 默认值 | 约束   | 说明                                               |
| ------- | ----------- | ------ | ------ | -------------------------------------------------- |
| `type`  | `integer`   | 0      | 0 或 1 | `0` = 普通反应，`1` = 超级反应（Burst Reaction）。 |
| `after` | `snowflake` | 无     | —      | 获取此用户 ID 之后的用户。                         |
| `limit` | `integer`   | 25     | 1–100  | 返回的最大用户数。                                 |

**Response**

成功时返回 `User[]`（用户对象数组）。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages/987654321098765432/reactions/%F0%9F%91%8D?limit=50' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**工程建议**

- 使用 `after` 参数进行分页，每次传入上一页最后一个用户的 ID。
- `type` 参数区分普通反应和超级反应（付费用户专属功能），默认获取普通反应。

## 9. 消息置顶

### 9.1 获取置顶消息列表

**Method**

`GET`

**URL**

`/channels/{channel.id}/pins`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**所需权限**

- `VIEW_CHANNEL`

**Response**

成功时返回 `Message[]`（被置顶的消息对象数组）。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/pins' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

### 9.2 置顶消息

**Method**

`PUT`

**URL**

`/channels/{channel.id}/pins/{message.id}`

**Headers**

| Header               | 是否必需 | 说明            |
| -------------------- | -------- | --------------- |
| `Authorization`      | 是       | `Bot {token}`。 |
| `X-Audit-Log-Reason` | 否       | 审计日志原因。  |

**所需权限**

- `MANAGE_MESSAGES`

**Response**

成功时返回 `204 No Content`。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/pins/987654321098765432' \
  -X PUT \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  -H 'Content-Length: 0'
```

### 9.3 取消置顶消息

**Method**

`DELETE`

**URL**

`/channels/{channel.id}/pins/{message.id}`

**Headers**

| Header               | 是否必需 | 说明            |
| -------------------- | -------- | --------------- |
| `Authorization`      | 是       | `Bot {token}`。 |
| `X-Audit-Log-Reason` | 否       | 审计日志原因。  |

**所需权限**

- `MANAGE_MESSAGES`

**Response**

成功时返回 `204 No Content`。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/pins/987654321098765432' \
  -X DELETE \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**重要说明**

- 每个频道最多可以置顶 **50 条消息**。达到上限后再置顶会返回错误。
- 置顶 / 取消置顶操作会触发系统消息发送到频道中。

## 10. 频道与服务器信息

### 10.1 获取频道信息

**Method**

`GET`

**URL**

`/channels/{channel.id}`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Response**

成功时返回 `Channel` 对象。如果频道是线程，会包含线程成员信息。

**Channel 对象核心字段**

| 字段                    | 类型                     | 说明                             |
| ----------------------- | ------------------------ | -------------------------------- |
| `id`                    | `snowflake`              | 频道 ID。                        |
| `type`                  | `integer`                | 频道类型（见下方枚举）。         |
| `guild_id`              | `snowflake?`             | 所属服务器 ID（DM 时无此字段）。 |
| `name`                  | `string?`                | 频道名称，1-100 字符。           |
| `topic`                 | `string?`                | 频道主题 / 描述。                |
| `nsfw`                  | `boolean?`               | 是否为年龄限制频道。             |
| `position`              | `integer?`               | 排序位置。                       |
| `parent_id`             | `snowflake?`             | 父分类或线程父频道 ID。          |
| `permission_overwrites` | `PermissionOverwrite[]?` | 显式权限覆写列表。               |
| `rate_limit_per_user`   | `integer?`               | 慢速模式间隔（秒），0-21600。    |
| `last_message_id`       | `snowflake?`             | 最后一条消息的 ID。              |
| `thread_metadata`       | `ThreadMetadata?`        | 线程专属元数据（仅线程频道有）。 |
| `member`                | `ThreadMember?`          | 当前用户的线程成员信息。         |
| `owner_id`              | `snowflake?`             | 线程创建者 ID。                  |
| `message_count`         | `integer?`               | 线程中的消息数（删除时会递减）。 |
| `member_count`          | `integer?`               | 线程成员数（上限显示 50）。      |

**频道类型枚举**

| 值  | 名称                  | 说明             |
| --- | --------------------- | ---------------- |
| 0   | `GUILD_TEXT`          | 服务器文本频道。 |
| 1   | `DM`                  | 私信频道。       |
| 2   | `GUILD_VOICE`         | 服务器语音频道。 |
| 3   | `GROUP_DM`            | 群组私信频道。   |
| 4   | `GUILD_CATEGORY`      | 频道分类。       |
| 5   | `GUILD_ANNOUNCEMENT`  | 公告频道。       |
| 10  | `ANNOUNCEMENT_THREAD` | 公告线程。       |
| 11  | `PUBLIC_THREAD`       | 公共线程。       |
| 12  | `PRIVATE_THREAD`      | 私密线程。       |
| 13  | `GUILD_STAGE_VOICE`   | 舞台频道。       |
| 14  | `GUILD_DIRECTORY`     | 服务器目录频道。 |
| 15  | `GUILD_FORUM`         | 论坛频道。       |
| 16  | `GUILD_MEDIA`         | 媒体频道。       |

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

### 10.2 获取服务器频道列表

**Method**

`GET`

**URL**

`/guilds/{guild.id}/channels`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Response**

成功时返回 `Channel[]`（频道对象数组）。**不包含线程**。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/guilds/111222333444555666/channels' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**工程建议**

- 此端点不返回线程。要获取线程，使用 `GET /guilds/{guild.id}/threads/active`。
- 返回的频道列表包含所有类型：文本、语音、分类、公告、论坛等。

### 10.3 获取服务器成员信息

**Method**

`GET`

**URL**

`/guilds/{guild.id}/members/{user.id}`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Response**

成功时返回 `GuildMember` 对象。

**GuildMember 对象字段**

| 字段                           | 类型          | 说明                                            |
| ------------------------------ | ------------- | ----------------------------------------------- |
| `user`                         | `User?`       | 用户对象（`MESSAGE_CREATE` 事件中可能不包含）。 |
| `nick`                         | `string?`     | 服务器昵称。                                    |
| `avatar`                       | `string?`     | 服务器头像哈希。                                |
| `banner`                       | `string?`     | 服务器横幅哈希。                                |
| `roles`                        | `snowflake[]` | 角色 ID 数组。                                  |
| `joined_at`                    | `ISO8601?`    | 加入服务器的时间。                              |
| `premium_since`                | `ISO8601?`    | 开始 Boost 服务器的时间。                       |
| `deaf`                         | `boolean`     | 是否在语音频道中被服务器静音（听）。            |
| `mute`                         | `boolean`     | 是否在语音频道中被服务器静音（说）。            |
| `flags`                        | `integer`     | 成员标志位域。                                  |
| `pending`                      | `boolean?`    | 是否通过了成员筛选。                            |
| `permissions`                  | `string?`     | 成员在频道中的总权限（仅交互上下文中出现）。    |
| `communication_disabled_until` | `ISO8601?`    | 禁言（超时）到期时间。                          |

**curl 示例**

```bash
curl 'https://discord.com/api/v10/guilds/111222333444555666/members/999888777666555444' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

## 11. 线程操作

### 11.1 从消息创建线程

**Method**

`POST`

**URL**

`/channels/{channel.id}/messages/{message.id}/threads`

**Headers**

| Header               | 是否必需 | 说明                 |
| -------------------- | -------- | -------------------- |
| `Authorization`      | 是       | `Bot {token}`。      |
| `Content-Type`       | 是       | `application/json`。 |
| `X-Audit-Log-Reason` | 否       | 审计日志原因。       |

**Request Body**

| 字段                    | 类型      | 是否必需 | 说明                                            |
| ----------------------- | --------- | -------- | ----------------------------------------------- |
| `name`                  | `string`  | 是       | 线程名称，1-100 字符。                          |
| `auto_archive_duration` | `integer` | 否       | 自动归档超时（分钟）：60、1440、4320 或 10080。 |
| `rate_limit_per_user`   | `integer` | 否       | 慢速模式间隔（秒），0-21600。                   |

**所需权限**

- `CREATE_PUBLIC_THREADS`（文本频道）

**线程类型自动确定规则**

- 在 `GUILD_TEXT` 频道中创建 → `PUBLIC_THREAD`(11)
- 在 `GUILD_ANNOUNCEMENT` 频道中创建 → `ANNOUNCEMENT_THREAD`(10)

**Response**

成功时返回 `Channel` 对象（线程频道）。触发 `THREAD_CREATE` 和 `MESSAGE_UPDATE` 网关事件。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages/987654321098765432/threads' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "name": "讨论这条消息",
    "auto_archive_duration": 1440
  }'
```

### 11.2 无消息创建线程

**Method**

`POST`

**URL**

`/channels/{channel.id}/threads`

**Headers**

| Header               | 是否必需 | 说明                 |
| -------------------- | -------- | -------------------- |
| `Authorization`      | 是       | `Bot {token}`。      |
| `Content-Type`       | 是       | `application/json`。 |
| `X-Audit-Log-Reason` | 否       | 审计日志原因。       |

**Request Body**

| 字段                    | 类型      | 是否必需 | 说明                                                                |
| ----------------------- | --------- | -------- | ------------------------------------------------------------------- |
| `name`                  | `string`  | 是       | 线程名称，1-100 字符。                                              |
| `auto_archive_duration` | `integer` | 否       | 自动归档超时（分钟）：60、1440、4320 或 10080。                     |
| `type`                  | `integer` | 否       | 线程类型。目前默认为 `PRIVATE_THREAD`(12)；未来版本将改为必需字段。 |
| `invitable`             | `boolean` | 否       | 非管理员是否可以拉人进线程（默认 `true`）。                         |
| `rate_limit_per_user`   | `integer` | 否       | 慢速模式间隔（秒），0-21600。                                       |
| `message`               | `object`  | 否       | 论坛 / 媒体频道中的初始消息内容（`ForumThreadMessageParams`）。     |

**所需权限**

- `CREATE_PUBLIC_THREADS`（公共线程）
- `CREATE_PRIVATE_THREADS`（私密线程）
- `SEND_MESSAGES`（论坛 / 媒体频道）

**Response**

成功时返回 `Channel` 对象（线程频道）。返回 `400 BAD REQUEST` 表示参数无效。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/threads' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "name": "新的讨论话题",
    "type": 11,
    "auto_archive_duration": 4320
  }'
```

**带初始消息的线程（论坛频道）**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/threads' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "name": "论坛讨论帖",
    "message": {
      "content": "这是帖子的初始内容"
    }
  }'
```

### 11.3 获取活跃线程列表

**Method**

`GET`

**URL**

`/guilds/{guild.id}/threads/active`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Response**

| 字段      | 类型             | 说明                             |
| --------- | ---------------- | -------------------------------- |
| `threads` | `Channel[]`      | 活跃线程列表，按 ID 降序排列。   |
| `members` | `ThreadMember[]` | 当前用户已加入的线程的成员对象。 |

返回的线程包括公共线程和私密线程。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/guilds/111222333444555666/threads/active' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**ThreadMetadata 对象**

| 字段                    | 类型       | 说明                                                 |
| ----------------------- | ---------- | ---------------------------------------------------- |
| `archived`              | `boolean`  | 线程是否已归档。                                     |
| `auto_archive_duration` | `integer`  | 自动归档超时（分钟）。                               |
| `archive_timestamp`     | `ISO8601`  | 最后一次归档状态变更的时间。                         |
| `locked`                | `boolean`  | 线程是否被锁定（锁定后非管理员不能编辑消息或属性）。 |
| `invitable`             | `boolean?` | 非管理员是否可以拉人进私密线程。                     |
| `create_timestamp`      | `ISO8601?` | 线程创建时间。                                       |

**ThreadMember 对象**

| 字段             | 类型        | 说明             |
| ---------------- | ----------- | ---------------- |
| `id`             | `snowflake` | 线程 ID。        |
| `user_id`        | `snowflake` | 用户 ID。        |
| `join_timestamp` | `ISO8601`   | 加入线程的时间。 |
| `flags`          | `integer`   | 通知设置等标志。 |

**工程建议**

- 线程名称最大 100 字符，创建时应截断。
- `type` 字段目前默认为 `PRIVATE_THREAD`(12)，如果希望创建公共线程，必须显式传 `type: 11`。
- 归档的线程不会出现在活跃线程列表中。
- 论坛频道中的线程创建需要 `message` 字段提供初始消息。
- 被固定的论坛帖子不会自动归档。

## 12. 消息搜索

### 12.1 搜索服务器消息

> ⚠️ 此端点为预览功能（Preview Feature），于 2025 年 8 月 18 日向 Bot 开放，可能会有破坏性变更。

**Method**

`GET`

**URL**

`/guilds/{guild.id}/messages/search`

**Headers**

| Header          | 是否必需 | 说明            |
| --------------- | -------- | --------------- |
| `Authorization` | 是       | `Bot {token}`。 |

**Query Parameters**

| 参数                   | 类型          | 默认值      | 约束           | 说明                                                                                  |
| ---------------------- | ------------- | ----------- | -------------- | ------------------------------------------------------------------------------------- |
| `content`              | `string`      | 无          | 最多 1024 字符 | 搜索文本。                                                                            |
| `author_id`            | `snowflake[]` | 无          | 最多 1521      | 按作者 ID 过滤。                                                                      |
| `author_type`          | `string[]`    | 无          | —              | 按用户类型过滤（`user`、`bot`、`webhook`）。                                          |
| `channel_id`           | `snowflake[]` | 无          | 最多 500       | 限定搜索的频道范围。                                                                  |
| `mentions`             | `snowflake[]` | 无          | —              | 按被提及的用户过滤。                                                                  |
| `has`                  | `string[]`    | 无          | —              | 内容类型过滤：`link`、`embed`、`file`、`image`、`video`、`sound`、`sticker`、`poll`。 |
| `attachment_extension` | `string[]`    | 无          | —              | 按附件文件类型过滤。                                                                  |
| `pinned`               | `boolean`     | 无          | —              | 仅返回置顶消息。                                                                      |
| `sort_by`              | `string`      | `relevance` | —              | 排序方式：`relevance`（相关性）或 `timestamp`（时间）。                               |
| `sort_order`           | `string`      | —           | —              | 排序方向：升序或降序。                                                                |
| `limit`                | `integer`     | 25          | 1–25           | 每页结果数。                                                                          |
| `offset`               | `integer`     | 0           | 0–9975         | 分页偏移量。                                                                          |

**所需权限**

- `READ_MESSAGE_HISTORY`
- 需要 `MESSAGE_CONTENT` 特权意图

**Response**

| 字段                | 类型          | 说明                     |
| ------------------- | ------------- | ------------------------ |
| `messages`          | `Message[][]` | 搜索结果，嵌套数组格式。 |
| `total_results`     | `integer`     | 匹配的总结果数。         |
| `threads`           | `Channel[]?`  | 相关线程（可选）。       |
| `documents_indexed` | `integer?`    | 索引状态（可选）。       |

**特殊响应码**

- `202 Accepted`：搜索索引尚未就绪，客户端应稍后重试。
- `200 OK`：正常返回搜索结果。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/guilds/111222333444555666/messages/search?content=hello&limit=10&channel_id=123456789012345678' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**工程建议**

- 此端点仍处于预览阶段，生产环境使用需谨慎。
- 收到 `202` 响应时，应等待几秒后重试。
- `messages` 是嵌套数组（每个结果是一个包含上下文消息的数组），不是扁平的消息数组。
- 速率限制信息未公开，但实测较为宽松。

## 13. 投票（Poll）

### 13.1 创建投票消息

投票通过 `POST /channels/{channel.id}/messages` 的 `poll` 字段创建。

**Method**

`POST`

**URL**

`/channels/{channel.id}/messages`

**Request Body**

```json
{
  "poll": {
    "question": {
      "text": "你最喜欢的编程语言是什么？"
    },
    "answers": [
      {
        "poll_media": {
          "text": "TypeScript",
          "emoji": { "name": "🟦" }
        }
      },
      {
        "poll_media": {
          "text": "Python",
          "emoji": { "name": "🐍" }
        }
      },
      {
        "poll_media": {
          "text": "Rust",
          "emoji": { "name": "🦀" }
        }
      }
    ],
    "duration": 24,
    "allow_multiselect": false,
    "layout_type": 1
  }
}
```

**PollCreateRequest 对象**

| 字段                | 类型           | 是否必需 | 说明                                          |
| ------------------- | -------------- | -------- | --------------------------------------------- |
| `question`          | `PollMedia`    | 是       | 投票问题。只支持 `text` 字段。                |
| `answers`           | `PollAnswer[]` | 是       | 答案选项数组，最多 10 个。                    |
| `duration`          | `integer`      | 否       | 投票持续时间（小时），默认 24，最长 32 天。   |
| `allow_multiselect` | `boolean`      | 否       | 是否允许多选，默认 `false`。                  |
| `layout_type`       | `integer`      | 否       | 布局类型，默认 1（`DEFAULT`），目前只有此值。 |

**PollMedia 对象**

| 字段    | 类型            | 说明                                                                           |
| ------- | --------------- | ------------------------------------------------------------------------------ |
| `text`  | `string`        | 文本内容。问题最多 300 字符，答案最多 55 字符。                                |
| `emoji` | `PartialEmoji?` | 可选 emoji。自定义 emoji 传 `{ "id": "..." }`，Unicode 传 `{ "name": "🐍" }`。 |

**PollAnswer 对象**

| 字段         | 类型        | 说明                                     |
| ------------ | ----------- | ---------------------------------------- |
| `answer_id`  | `integer`   | 答案 ID（仅在 API/Gateway 响应中出现）。 |
| `poll_media` | `PollMedia` | 答案内容。                               |

**Poll 对象（响应中的完整结构）**

| 字段                | 类型           | 说明                         |
| ------------------- | -------------- | ---------------------------- |
| `question`          | `PollMedia`    | 投票问题。                   |
| `answers`           | `PollAnswer[]` | 答案选项列表。               |
| `expiry`            | `ISO8601`      | 投票关闭时间。               |
| `allow_multiselect` | `boolean`      | 是否允许多选。               |
| `layout_type`       | `integer`      | 布局类型。                   |
| `results`           | `PollResults?` | 投票结果（可能不总是出现）。 |

**PollResults 对象**

| 字段            | 类型            | 说明                                 |
| --------------- | --------------- | ------------------------------------ |
| `is_finalized`  | `boolean`       | 投票是否已结束（结果是否最终准确）。 |
| `answer_counts` | `AnswerCount[]` | 各答案的票数统计。                   |

**AnswerCount 对象**

| 字段       | 类型      | 说明                     |
| ---------- | --------- | ------------------------ |
| `id`       | `integer` | 答案 ID。                |
| `count`    | `integer` | 投票数。                 |
| `me_voted` | `boolean` | 当前用户是否投了此选项。 |

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/messages' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)' \
  --data-raw '{
    "poll": {
      "question": { "text": "你最喜欢的编程语言是什么？" },
      "answers": [
        { "poll_media": { "text": "TypeScript" } },
        { "poll_media": { "text": "Python" } },
        { "poll_media": { "text": "Rust" } }
      ],
      "duration": 24,
      "allow_multiselect": false
    }
  }'
```

### 13.2 提前结束投票

**Method**

`POST`

**URL**

`/channels/{channel.id}/polls/{message.id}/expire`

**说明**

仅投票创建者可调用。立即关闭投票。

**Response**

成功时返回包含投票的 `Message` 对象。触发 `MESSAGE_UPDATE` 网关事件。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/polls/987654321098765432/expire' \
  -X POST \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

### 13.3 获取投票答案的投票者列表

**Method**

`GET`

**URL**

`/channels/{channel.id}/polls/{message.id}/answers/{answer.id}`

**Query Parameters**

| 参数    | 类型        | 默认值 | 约束  | 说明                       |
| ------- | ----------- | ------ | ----- | -------------------------- |
| `after` | `snowflake` | 无     | —     | 获取此用户 ID 之后的用户。 |
| `limit` | `integer`   | 25     | 1–100 | 返回的最大用户数。         |

**Response**

成功时返回 `User[]`（用户对象数组）。

**curl 示例**

```bash
curl 'https://discord.com/api/v10/channels/123456789012345678/polls/987654321098765432/answers/1?limit=50' \
  -H 'Authorization: Bot MTk4NjIy.Cl2FMQ.ZnCjm...' \
  -H 'User-Agent: DiscordBot (https://example.com, 1.0)'
```

**工程建议**

- 投票一旦创建不可编辑（不能修改问题、选项或持续时间）。
- 投票消息不能包含 `content`、`embeds`、`sticker_ids`、`components` 等字段（可以但通常不需要）。
- 投票结果中的 `is_finalized` 为 `false` 时，计数可能不完全准确。
- 投票结束后，`results.is_finalized` 变为 `true`，计数变为最终值。

## 14. 错误响应格式

### 14.1 标准错误响应

```json
{
  "code": 50035,
  "errors": {
    "content": {
      "_errors": [
        {
          "code": "BASE_TYPE_MAX_LENGTH",
          "message": "Must be 2000 or fewer in length."
        }
      ]
    }
  },
  "message": "Invalid Form Body"
}
```

**常见错误码**

| 错误码 | 说明                                       |
| ------ | ------------------------------------------ |
| 10003  | Unknown Channel — 频道不存在。             |
| 10008  | Unknown Message — 消息不存在。             |
| 10014  | Unknown Emoji — emoji 不存在或编码错误。   |
| 30003  | Maximum number of pins reached (50)。      |
| 50001  | Missing Access — 缺少访问权限。            |
| 50013  | Missing Permissions — 缺少操作所需的权限。 |
| 50035  | Invalid Form Body — 请求体验证失败。       |

### 14.2 权限不足（403）

```json
{
  "code": 50013,
  "message": "Missing Permissions"
}
```

### 14.3 资源不存在（404）

```json
{
  "code": 10008,
  "message": "Unknown Message"
}
```

## 15. 实测验证记录

### 15.1 测试环境

- **Guild**: LobeHub (ID: `1127171173982154893`)
- **测试频道**: #system (ID: `1127182445373042728`)
- **SDK**: `@discordjs/rest`
- **测试日期**: 2026-03-26

### 15.2 测试结果

全部 12 项 API 调用均通过：

| 序号 | API 方法            | 测试描述                                                           | 结果 |
| ---- | ------------------- | ------------------------------------------------------------------ | ---- |
| 1    | `getGuildChannels`  | 成功获取 guild 频道列表                                            | Pass |
| 2    | `createMessage`     | 发送 "🧪 Message tool API test" 成功，返回 messageId               | Pass |
| 3    | `getMessage`        | 精确获取指定消息成功（新增的 API 方法，用于修复 getReactions bug） | Pass |
| 4    | `editMessage`       | 编辑消息内容成功                                                   | Pass |
| 5    | `createReaction`    | 添加 👍 表情成功                                                   | Pass |
| 6    | `getReactions`      | 获取到 1 个反应用户（修复后使用 getMessage 而非 getMessages）      | Pass |
| 7    | `deleteMessage`     | 删除消息成功                                                       | Pass |
| 8    | `getMessages`       | 成功获取 3 条历史消息（limit=3）                                   | Pass |
| 9    | `getChannel`        | 返回频道类型 (0=text) 和名称                                       | Pass |
| 10   | `getPinnedMessages` | 返回置顶消息列表 (0 条)                                            | Pass |
| 11   | `listActiveThreads` | 返回 250 个活跃线程                                                | Pass |
| 12   | 全流程              | 12/12 通过                                                         | Pass |

### 15.3 关键发现

1. **getReactions bug 修复**：原实现使用 `getMessages(limit=1)` 获取最新消息，无法命中目标消息。修复后使用 `getMessage(channelId, messageId)` 精确获取单条消息，确保能正确读取目标消息上的 reactions 字段。
2. **Rate limiting 自动处理**：`@discordjs/rest` 库自动处理 429 响应的 `retry-after`，无需手动实现退避逻辑。
3. **Unicode emoji URL 编码**：URL 编码的 Unicode emoji（如 👍 编码为 `%F0%9F%91%8D`）在 reaction API 中正常工作，无需额外处理。

## 16. 接口一览表

| 操作           | 方法     | URL                                                                  | 请求体 | 响应码             |
| -------------- | -------- | -------------------------------------------------------------------- | ------ | ------------------ |
| 获取频道消息   | `GET`    | `/channels/{channel.id}/messages`                                    | 无     | 200 + Message\[]   |
| 获取单条消息   | `GET`    | `/channels/{channel.id}/messages/{message.id}`                       | 无     | 200 + Message      |
| 创建消息       | `POST`   | `/channels/{channel.id}/messages`                                    | JSON   | 200 + Message      |
| 编辑消息       | `PATCH`  | `/channels/{channel.id}/messages/{message.id}`                       | JSON   | 200 + Message      |
| 删除消息       | `DELETE` | `/channels/{channel.id}/messages/{message.id}`                       | 无     | 204                |
| 添加反应       | `PUT`    | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me` | 无     | 204                |
| 获取反应用户   | `GET`    | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}`     | 无     | 200 + User\[]      |
| 获取置顶消息   | `GET`    | `/channels/{channel.id}/pins`                                        | 无     | 200 + Message\[]   |
| 置顶消息       | `PUT`    | `/channels/{channel.id}/pins/{message.id}`                           | 无     | 204                |
| 取消置顶       | `DELETE` | `/channels/{channel.id}/pins/{message.id}`                           | 无     | 204                |
| 获取频道信息   | `GET`    | `/channels/{channel.id}`                                             | 无     | 200 + Channel      |
| 获取服务器频道 | `GET`    | `/guilds/{guild.id}/channels`                                        | 无     | 200 + Channel\[]   |
| 获取服务器成员 | `GET`    | `/guilds/{guild.id}/members/{user.id}`                               | 无     | 200 + GuildMember  |
| 从消息创建线程 | `POST`   | `/channels/{channel.id}/messages/{message.id}/threads`               | JSON   | 200 + Channel      |
| 无消息创建线程 | `POST`   | `/channels/{channel.id}/threads`                                     | JSON   | 200 + Channel      |
| 获取活跃线程   | `GET`    | `/guilds/{guild.id}/threads/active`                                  | 无     | 200 + 复合对象     |
| 搜索服务器消息 | `GET`    | `/guilds/{guild.id}/messages/search`                                 | 无     | 200/202 + 复合对象 |
| 创建投票       | `POST`   | `/channels/{channel.id}/messages`（带 `poll` 字段）                  | JSON   | 200 + Message      |

## 17. 附录：与 DiscordApi 类的映射关系

以下表格展示本规范中的 API 端点与代码库中 `DiscordApi` 类方法的对应关系：

| DiscordApi 方法               | 对应端点                                                 | 本文章节 |
| ----------------------------- | -------------------------------------------------------- | -------- |
| `getMessages()`               | `GET /channels/{id}/messages`                            | 4.1      |
| `getMessage()`                | `GET /channels/{id}/messages/{id}`                       | 4.1      |
| `createMessage()`             | `POST /channels/{id}/messages`                           | 5.1      |
| `editMessage()`               | `PATCH /channels/{id}/messages/{id}`                     | 6.1      |
| `deleteMessage()`             | `DELETE /channels/{id}/messages/{id}`                    | 7.1      |
| `createReaction()`            | `PUT /channels/{id}/messages/{id}/reactions/{emoji}/@me` | 8.1      |
| `getReactions()`              | `GET /channels/{id}/messages/{id}/reactions/{emoji}`     | 8.2      |
| `getPinnedMessages()`         | `GET /channels/{id}/pins`                                | 9.1      |
| `pinMessage()`                | `PUT /channels/{id}/pins/{id}`                           | 9.2      |
| `unpinMessage()`              | `DELETE /channels/{id}/pins/{id}`                        | 9.3      |
| `getChannel()`                | `GET /channels/{id}`                                     | 10.1     |
| `getGuildChannels()`          | `GET /guilds/{id}/channels`                              | 10.2     |
| `getGuildMember()`            | `GET /guilds/{id}/members/{id}`                          | 10.3     |
| `startThreadFromMessage()`    | `POST /channels/{id}/messages/{id}/threads`              | 11.1     |
| `startThreadWithoutMessage()` | `POST /channels/{id}/threads`                            | 11.2     |
| `listActiveThreads()`         | `GET /guilds/{id}/threads/active`                        | 11.3     |
| `searchGuildMessages()`       | `GET /guilds/{id}/messages/search`                       | 12.1     |
| `createPoll()`                | `POST /channels/{id}/messages`（带 `poll` 字段）         | 13.1     |
