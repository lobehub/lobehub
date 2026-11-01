# Telegram Bot API 消息操作协议规范

> 适用对象：实现 Telegram Bot 消息操作的 SDK、网关和独立 Bot。
>
> 整理依据：Telegram 官方 [Bot API 文档](https://core.telegram.org/bots/api)、本仓库 `TelegramApi` 类实现（`api.ts`）、aiogram /python-telegram-bot 等社区 SDK 验证。
>
> 说明：文中标注 "工程建议" 的内容来自现有客户端实现经验，用于提高兼容性；它们不是服务端返回字段本身的一部分。

## 1. 概述

Telegram Bot API 是 Telegram 官方提供的 HTTP/JSON 协议，用于 Bot 与 Telegram 服务端交互。所有请求基于 HTTPS，使用 Bot Token 进行认证。协议核心特征有三点：一是所有方法都通过 `POST`（或 `GET`）调用统一基座 URL；二是响应格式统一为 `{"ok": true/false, "result": ...}` 结构；三是消息内容支持 HTML、MarkdownV2 等富文本格式化。

本文档聚焦于 `TelegramApi` 类使用的消息操作方法，涵盖发送、编辑、删除消息，设置 Reaction，置顶 / 取消置顶，获取群组信息，论坛话题管理，投票和输入状态等功能。

## 2. 公共请求规范

### 2.1 基座 URL

```
https://api.telegram.org/bot{token}/{method}
```

- `{token}`：通过 [@BotFather](https://t.me/BotFather) 创建 Bot 时获取的 Token，格式形如 `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`。
- `{method}`：API 方法名，大小写不敏感（但推荐使用官方文档中的 camelCase 形式）。

### 2.2 通用请求格式

所有业务接口均使用 `POST` 方法，请求体为 JSON：

| Header         | 值                 | 是否必需 | 说明                |
| -------------- | ------------------ | -------- | ------------------- |
| `Content-Type` | `application/json` | 是       | 所有接口都发 JSON。 |

### 2.3 通用响应格式

所有 API 响应都是 JSON 对象，包含以下公共字段：

| 字段          | 类型      | 说明                                    |
| ------------- | --------- | --------------------------------------- |
| `ok`          | `boolean` | `true` 表示请求成功，`false` 表示失败。 |
| `result`      | `any`     | 成功时返回的业务数据；类型因方法而异。  |
| `description` | `string?` | 失败时返回的错误描述。                  |
| `error_code`  | `number?` | 失败时返回的错误码（HTTP 状态码）。     |

**成功响应示例**

```json
{
  "ok": true,
  "result": {
    "message_id": 1234,
    "chat": { "id": -1001234567890, "type": "supergroup" },
    "text": "Hello, World!"
  }
}
```

**失败响应示例**

```json
{
  "description": "Bad Request: message text is empty",
  "error_code": 400,
  "ok": false
}
```

### 2.4 错误处理模式

Telegram API 的错误有两层：

1. **HTTP 层**：非 200 状态码伴随 `{"ok": false, ...}` 响应体。
2. **逻辑层**：HTTP 200 但 `ok` 为 `false`，此时 `error_code` 和 `description` 描述具体原因。

常见错误码：

| error_code | 典型 description                                     | 说明                               |
| ---------- | ---------------------------------------------------- | ---------------------------------- |
| `400`      | `Bad Request: message text is empty`                 | 参数错误。                         |
| `400`      | `Bad Request: message is not modified`               | 编辑消息时新内容与旧内容完全相同。 |
| `400`      | `Bad Request: message to delete not found`           | 要删除的消息不存在或已被删除。     |
| `400`      | `Bad Request: message can't be deleted for everyone` | 消息超过 48 小时删除限制。         |
| `403`      | `Forbidden: bot was blocked by the user`             | 用户已屏蔽 Bot。                   |
| `403`      | `Forbidden: bot is not a member of the supergroup`   | Bot 不在群组中。                   |
| `429`      | `Too Many Requests: retry after X`                   | 速率限制，需等待 X 秒后重试。      |

**工程建议**

- 收到 `429` 时，从 `description` 中解析 `retry after` 的秒数，等待后重试。
- 收到 `400` 且 `message is not modified` 时，安全忽略即可（编辑内容相同）。
- 收到 `403` 时，记录日志但不重试；通常意味着权限永久缺失。

## 3. sendMessage — 发送消息

### 3.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/sendMessage`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "parse_mode": "HTML",
  "text": "你好，世界！"
}
```

**参数说明**

| 参数                   | 类型                      | 是否必需 | 说明                                                            |
| ---------------------- | ------------------------- | -------- | --------------------------------------------------------------- |
| `chat_id`              | `Integer` 或 `String`     | 是       | 目标聊天的唯一标识符，或频道用户名（格式 `@channelusername`）。 |
| `text`                 | `String`                  | 是       | 消息正文；实体解析后长度 1–4096 字符。                          |
| `parse_mode`           | `String`                  | 否       | 格式化模式：`HTML`、`MarkdownV2` 或 `Markdown`（旧版）。        |
| `entities`             | `Array<MessageEntity>`    | 否       | 自定义格式化实体列表；与 `parse_mode` 二选一。                  |
| `message_thread_id`    | `Integer`                 | 否       | 论坛话题（Forum Topic）的线程 ID；用于向指定话题发送消息。      |
| `reply_parameters`     | `ReplyParameters`         | 否       | 回复配置；可指定 `message_id` 来回复特定消息。                  |
| `reply_markup`         | `InlineKeyboardMarkup` 等 | 否       | 内联键盘或自定义键盘。                                          |
| `link_preview_options` | `LinkPreviewOptions`      | 否       | 控制链接预览的生成行为。                                        |
| `message_effect_id`    | `String`                  | 否       | 消息特效的唯一标识符。                                          |
| `disable_notification` | `Boolean`                 | 否       | 静默发送，不触发通知声音。                                      |
| `protect_content`      | `Boolean`                 | 否       | 保护消息内容不被转发和保存。                                    |

**Response Body**

成功时返回发送的 `Message` 对象：

```json
{
  "ok": true,
  "result": {
    "message_id": 1234,
    "from": {
      "id": 123456789,
      "is_bot": true,
      "first_name": "MyBot"
    },
    "chat": {
      "id": -1001234567890,
      "title": "测试群",
      "type": "supergroup"
    },
    "date": 1711468800,
    "text": "你好，世界！"
  }
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendMessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "text": "<b>加粗文本</b>和<i>斜体文本</i>",
    "parse_mode": "HTML"
  }'
```

### 3.2 文本长度限制

Telegram 单条消息的文本长度上限为 **4096 字符**（实体解析后计算）。

**工程建议**

- 在发送前检查文本长度，超出 4096 字符时截断并追加 `...`。
- 本仓库 `TelegramApi` 实现使用 `truncateText` 方法：超过 4096 字符取前 4093 字符 + `...`。
- 如果需要发送更长内容，应分片为多条消息发送。

### 3.3 parse_mode 说明

| 值           | 说明                                                        |
| ------------ | ----------------------------------------------------------- |
| `HTML`       | 支持 `<b>`, `<i>`, `<code>`, `<pre>`, `<a>` 等标签。        |
| `MarkdownV2` | 支持 `*bold*`, `_italic_`, `` `code` ``, `[link](url)` 等。 |
| `Markdown`   | 旧版 Markdown，兼容性较差，不推荐使用。                     |

**工程建议**

- 推荐使用 `HTML` 模式，因为它对特殊字符的转义规则更直观。
- `MarkdownV2` 需要对 `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!` 进行转义。
- 本仓库统一使用 `HTML` 模式，并提供 `markdownToHTML` 转换工具。

## 4. editMessageText — 编辑消息文本

### 4.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/editMessageText`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "message_id": 1234,
  "parse_mode": "HTML",
  "text": "已编辑的消息内容"
}
```

**参数说明**

| 参数                   | 类型                   | 是否必需      | 说明                                                       |
| ---------------------- | ---------------------- | ------------- | ---------------------------------------------------------- |
| `chat_id`              | `Integer` 或 `String`  | 条件必需 (\*) | 目标聊天标识符。                                           |
| `message_id`           | `Integer`              | 条件必需 (\*) | 要编辑的消息 ID。                                          |
| `inline_message_id`    | `String`               | 条件必需 (\*) | 内联消息的唯一标识符；与 `chat_id` + `message_id` 二选一。 |
| `text`                 | `String`               | 是            | 新的消息文本；实体解析后长度 1–4096 字符。                 |
| `parse_mode`           | `String`               | 否            | 格式化模式：`HTML`、`MarkdownV2` 或 `Markdown`。           |
| `entities`             | `Array<MessageEntity>` | 否            | 自定义格式化实体列表。                                     |
| `link_preview_options` | `LinkPreviewOptions`   | 否            | 控制链接预览行为。                                         |
| `reply_markup`         | `InlineKeyboardMarkup` | 否            | 内联键盘标记。                                             |

(\*) 必须提供 `chat_id` + `message_id` 或 `inline_message_id` 其中一组。

**Response Body**

- 编辑普通消息时：返回编辑后的 `Message` 对象。
- 编辑内联消息时：返回 `true`。

```json
{
  "ok": true,
  "result": {
    "message_id": 1234,
    "chat": { "id": -1001234567890, "type": "supergroup" },
    "date": 1711468800,
    "edit_date": 1711468860,
    "text": "已编辑的消息内容"
  }
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/editMessageText' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_id": 1234,
    "text": "<b>已更新</b>的消息内容",
    "parse_mode": "HTML"
  }'
```

### 4.2 "message is not modified" 处理

当新内容与消息当前内容完全相同时，Telegram 返回 `400` 错误：

```json
{
  "description": "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
  "error_code": 400,
  "ok": false
}
```

**工程建议**

- 这个错误在流式输出场景中很常见（最后一次 edit 内容可能与前一次相同）。
- 本仓库 `TelegramApi.editMessageText` 已对该错误做了静默处理：检测到 `message is not modified` 时直接 return，不抛异常。
- 建议 SDK 实现统一对此错误做幂等处理。

## 5. deleteMessage — 删除消息

### 5.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/deleteMessage`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "message_id": 1234
}
```

**参数说明**

| 参数         | 类型                  | 是否必需 | 说明              |
| ------------ | --------------------- | -------- | ----------------- |
| `chat_id`    | `Integer` 或 `String` | 是       | 目标聊天标识符。  |
| `message_id` | `Integer`             | 是       | 要删除的消息 ID。 |

**Response Body**

成功时返回 `true`：

```json
{
  "ok": true,
  "result": true
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/deleteMessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_id": 1234
  }'
```

### 5.2 删除限制

Telegram 对消息删除有严格的时间和权限限制：

| 场景                         | 限制                                       |
| ---------------------------- | ------------------------------------------ |
| 私聊中 Bot 发送的消息        | 可随时删除。                               |
| 私聊中用户发送的消息         | Bot 可随时删除。                           |
| 群组中 Bot 发送的消息        | 可随时删除。                               |
| 群组中其他人的消息           | Bot 需要管理员权限且消息在 **48 小时内**。 |
| 超级群组 / 频道中的消息      | Bot 需具备 `can_delete_messages` 权限。    |
| 骰子消息（私聊）             | 发送 **24 小时后**才能删除。               |
| 超级群 / 频道 / 话题创建消息 | 不可删除。                                 |

**工程建议**

- 删除操作应做好失败处理；消息可能已被其他管理员删除或已过期。
- 如果需要批量删除，可使用 `deleteMessages`（复数形式）方法一次删除最多 100 条消息。

## 6. setMessageReaction — 设置消息 Reaction

### 6.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/setMessageReaction`

**Request Body（添加 Reaction）**

```json
{
  "chat_id": -1001234567890,
  "message_id": 1234,
  "reaction": [
    {
      "type": "emoji",
      "emoji": "👍"
    }
  ]
}
```

**Request Body（移除 Reaction）**

```json
{
  "chat_id": -1001234567890,
  "message_id": 1234,
  "reaction": []
}
```

**参数说明**

| 参数         | 类型                  | 是否必需 | 说明                                                 |
| ------------ | --------------------- | -------- | ---------------------------------------------------- |
| `chat_id`    | `Integer` 或 `String` | 是       | 目标聊天标识符。                                     |
| `message_id` | `Integer`             | 是       | 目标消息 ID。                                        |
| `reaction`   | `Array<ReactionType>` | 是       | Reaction 列表；传空数组 `[]` 表示移除所有 Reaction。 |
| `is_big`     | `Boolean`             | 否       | 是否使用大动画效果；默认 `false`。                   |

### 6.2 ReactionType 结构

Telegram 支持三种 Reaction 类型：

**ReactionTypeEmoji（标准表情）**

| 字段    | 类型     | 说明                                                     |
| ------- | -------- | -------------------------------------------------------- |
| `type`  | `String` | 固定值 `"emoji"`。                                       |
| `emoji` | `String` | Unicode 表情字符，必须是 Telegram 允许的 Reaction 表情。 |

```json
{ "emoji": "👍", "type": "emoji" }
```

**ReactionTypeCustomEmoji（自定义表情）**

| 字段              | 类型     | 说明                      |
| ----------------- | -------- | ------------------------- |
| `type`            | `String` | 固定值 `"custom_emoji"`。 |
| `custom_emoji_id` | `String` | 自定义表情的唯一标识符。  |

```json
{ "custom_emoji_id": "5368324170671202286", "type": "custom_emoji" }
```

**ReactionTypePaid（付费 Reaction）**

| 字段   | 类型     | 说明              |
| ------ | -------- | ----------------- |
| `type` | `String` | 固定值 `"paid"`。 |

```json
{ "type": "paid" }
```

**Response Body**

成功时返回 `true`：

```json
{
  "ok": true,
  "result": true
}
```

**curl 示例**

```bash
# 添加 Reaction
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/setMessageReaction' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_id": 1234,
    "reaction": [{"type": "emoji", "emoji": "👍"}]
  }'
```

```bash
# 移除 Reaction
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/setMessageReaction' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_id": 1234,
    "reaction": []
  }'
```

**工程建议**

- Bot 不能使用付费 Reaction（`ReactionTypePaid`）。
- 部分服务消息类型不支持 Reaction。
- 常用标准表情包括：`👍`, `👎`, `❤`, `🔥`, `🎉`, `😢`, `😮`, `😡`, `🤔`, `👏`, `🙏`, `💯` 等（完整列表约 75 个）。
- 本仓库 `TelegramApi` 将添加和移除 Reaction 封装为两个独立方法：`setMessageReaction`（添加）和 `removeMessageReaction`（传空数组移除）。

## 7. pinChatMessage — 置顶消息

### 7.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/pinChatMessage`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "disable_notification": true,
  "message_id": 1234
}
```

**参数说明**

| 参数                     | 类型                  | 是否必需 | 说明                                                 |
| ------------------------ | --------------------- | -------- | ---------------------------------------------------- |
| `chat_id`                | `Integer` 或 `String` | 是       | 目标聊天标识符。                                     |
| `message_id`             | `Integer`             | 是       | 要置顶的消息 ID。                                    |
| `disable_notification`   | `Boolean`             | 否       | 是否静默置顶（不向所有成员发送通知）；默认 `false`。 |
| `business_connection_id` | `String`              | 否       | 商业连接标识符，用于代表商业账号管理置顶消息。       |

**Response Body**

成功时返回 `true`：

```json
{
  "ok": true,
  "result": true
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/pinChatMessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_id": 1234,
    "disable_notification": true
  }'
```

**工程建议**

- 本仓库 `TelegramApi.pinChatMessage` 默认将 `disable_notification` 设为 `true`，避免置顶操作打扰群内所有成员。
- Bot 需要在群组中具有 `can_pin_messages` 管理员权限。
- 在频道中需要 `can_edit_messages` 权限。

## 8. unpinChatMessage — 取消置顶消息

### 8.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/unpinChatMessage`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "message_id": 1234
}
```

**参数说明**

| 参数                     | 类型                  | 是否必需 | 说明                                                |
| ------------------------ | --------------------- | -------- | --------------------------------------------------- |
| `chat_id`                | `Integer` 或 `String` | 是       | 目标聊天标识符。                                    |
| `message_id`             | `Integer`             | 否       | 要取消置顶的消息 ID；不指定时取消最近一条置顶消息。 |
| `business_connection_id` | `String`              | 否       | 商业连接标识符。                                    |

**Response Body**

成功时返回 `true`：

```json
{
  "ok": true,
  "result": true
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/unpinChatMessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_id": 1234
  }'
```

**工程建议**

- 如果需要取消所有置顶消息，可使用 `unpinAllChatMessages` 方法。
- 本仓库 `TelegramApi.unpinChatMessage` 始终传递 `message_id`，确保精确取消指定消息的置顶状态。

## 9. getChat — 获取聊天信息

### 9.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/getChat`

**Request Body**

```json
{
  "chat_id": -1001234567890
}
```

**参数说明**

| 参数      | 类型                  | 是否必需 | 说明             |
| --------- | --------------------- | -------- | ---------------- |
| `chat_id` | `Integer` 或 `String` | 是       | 目标聊天标识符。 |

**Response Body**

成功时返回 `ChatFullInfo` 对象：

```json
{
  "ok": true,
  "result": {
    "id": -1001234567890,
    "title": "测试群",
    "type": "supergroup",
    "username": "test_group",
    "description": "这是一个测试群组",
    "invite_link": "https://t.me/+ABCdef123456",
    "permissions": {
      "can_send_messages": true,
      "can_send_media_messages": true,
      "can_send_polls": true,
      "can_send_other_messages": true,
      "can_add_web_page_previews": true,
      "can_change_info": false,
      "can_invite_users": true,
      "can_pin_messages": false
    },
    "max_reaction_count": 11,
    "has_visible_history": true
  }
}
```

### 9.2 ChatFullInfo 主要字段

| 字段                  | 类型               | 说明                                                      |
| --------------------- | ------------------ | --------------------------------------------------------- |
| `id`                  | `Integer`          | 聊天唯一标识符。                                          |
| `type`                | `String`           | 聊天类型：`private`、`group`、`supergroup` 或 `channel`。 |
| `title`               | `String?`          | 群组、超级群组或频道的标题。                              |
| `username`            | `String?`          | 私聊、超级群组或频道的用户名。                            |
| `first_name`          | `String?`          | 私聊对方的名。                                            |
| `last_name`           | `String?`          | 私聊对方的姓。                                            |
| `description`         | `String?`          | 群组、超级群组或频道的描述。                              |
| `invite_link`         | `String?`          | 聊天邀请链接。                                            |
| `permissions`         | `ChatPermissions?` | 群组或超级群组的默认权限。                                |
| `linked_chat_id`      | `Integer?`         | 关联聊天的 ID（如频道关联的讨论组）。                     |
| `has_visible_history` | `Boolean?`         | 新成员是否可以看到加入前的历史消息。                      |
| `max_reaction_count`  | `Integer`          | 允许在聊天消息上设置的最大 Reaction 数量。                |
| `has_forum`           | `Boolean?`         | 超级群组是否启用了论坛话题功能（`true` 表示已启用）。     |

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/getChat' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890
  }'
```

**工程建议**

- `getChat` 返回的信息较为完整，可用于判断群组是否启用了论坛模式（`has_forum`）。
- 对于私聊，返回用户的 `first_name` 和可选的 `bio`。
- 建议缓存 `getChat` 的结果，避免频繁调用；群组基本信息变化不频繁。

## 10. getChatMember — 获取聊天成员信息

### 10.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/getChatMember`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "user_id": 987654321
}
```

**参数说明**

| 参数      | 类型                  | 是否必需 | 说明                   |
| --------- | --------------------- | -------- | ---------------------- |
| `chat_id` | `Integer` 或 `String` | 是       | 目标聊天标识符。       |
| `user_id` | `Integer`             | 是       | 目标用户的唯一标识符。 |

**Response Body**

成功时返回 `ChatMember` 对象（多态类型，根据 `status` 字段区分）：

```json
{
  "ok": true,
  "result": {
    "status": "administrator",
    "user": {
      "id": 987654321,
      "is_bot": false,
      "first_name": "张三",
      "username": "zhangsan"
    },
    "can_be_edited": false,
    "can_manage_chat": true,
    "can_delete_messages": true,
    "can_manage_video_chats": true,
    "can_restrict_members": true,
    "can_promote_members": false,
    "can_change_info": true,
    "can_invite_users": true,
    "can_pin_messages": true,
    "can_manage_topics": true
  }
}
```

### 10.2 ChatMember 状态

| status          | 说明                             |
| --------------- | -------------------------------- |
| `creator`       | 群主；拥有所有管理员权限。       |
| `administrator` | 管理员；拥有部分额外权限。       |
| `member`        | 普通成员；无额外权限或限制。     |
| `restricted`    | 受限成员；被施加了某些限制。     |
| `left`          | 已离开聊天但可以自行重新加入。   |
| `kicked`        | 被封禁；不能返回聊天或查看消息。 |

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/getChatMember' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "user_id": 987654321
  }'
```

**工程建议**

- 对于非管理员 Bot，此方法只保证能查到 Bot 自身的成员信息；查询其他用户需要 Bot 是群管理员。
- 可用于检查用户是否仍在群中（`status` 不是 `left` 或 `kicked`）。
- 可用于检查 Bot 自身的权限（如 `can_delete_messages`、`can_pin_messages` 等）。

## 11. createForumTopic — 创建论坛话题

### 11.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/createForumTopic`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "name": "新话题标题"
}
```

**参数说明**

| 参数                   | 类型                  | 是否必需 | 说明                                                                                                                                                            |
| ---------------------- | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_id`              | `Integer` 或 `String` | 是       | 目标超级群组的标识符。                                                                                                                                          |
| `name`                 | `String`              | 是       | 话题名称；长度 1–128 字符。                                                                                                                                     |
| `icon_color`           | `Integer`             | 否       | 话题图标颜色（RGB）；必须是预定义值之一：`7322096`（蓝色）、`16766590`（黄色）、`13338331`（紫色）、`9367192`（绿色）、`16749490`（粉色）、`16478047`（红色）。 |
| `icon_custom_emoji_id` | `String`              | 否       | 话题图标的自定义表情 ID。                                                                                                                                       |

**Response Body**

成功时返回 `ForumTopic` 对象：

```json
{
  "ok": true,
  "result": {
    "message_thread_id": 42,
    "name": "新话题标题",
    "icon_color": 7322096
  }
}
```

### 11.2 ForumTopic 字段

| 字段                   | 类型      | 说明                      |
| ---------------------- | --------- | ------------------------- |
| `message_thread_id`    | `Integer` | 论坛话题的唯一标识符。    |
| `name`                 | `String`  | 话题名称。                |
| `icon_color`           | `Integer` | 话题图标颜色。            |
| `icon_custom_emoji_id` | `String?` | 话题图标的自定义表情 ID。 |

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/createForumTopic' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "name": "项目讨论"
  }'
```

**工程建议**

- 话题名称最长 128 字符；本仓库 `TelegramApi.createForumTopic` 会在发送前用 `name.slice(0, 128)` 截断。
- 只有启用了论坛模式的超级群组才支持此方法；可通过 `getChat` 的 `has_forum` 字段判断。
- Bot 需要在群组中具有 `can_manage_topics` 管理员权限。
- 返回的 `message_thread_id` 用于后续向该话题发送消息。

### 11.3 threadId 复合格式约定（createThread /replyToThread）

在本仓库的消息工具（message tool）抽象层中，`createThread`（对应 `createForumTopic`）和 `replyToThread` 使用 **复合 threadId 格式**，格式为 `"chatId:topicId"`（例如 `"-1001234567890:42"`）。

**原因**：Telegram 的论坛话题需要 `chat_id` 和 `message_thread_id` 两个参数才能定位一个话题，而消息工具协议只有一个 `threadId` 字段。因此需要将两个标识符编码到一个字符串中。

**规则**：

- `createThread` 在调用 `createForumTopic` 成功后，将返回值拼接为 `"${chatId}:${message_thread_id}"`（例如 `"-1001234567890:42"`）。
- `replyToThread` 接收到 `threadId` 后，通过 `threadId.split(':')` 解析出 `chatId` 和 `topicId`，分别作为 `chat_id` 和 `message_thread_id` 传入 `sendMessage`。

**Bug 修复记录**：原始实现中 `createThread` 仅返回 `message_thread_id`（如 `"42"`），不包含 `chatId`，导致 `replyToThread` 在解析时无法获得正确的 `chat_id`，消息发送失败。修复后统一使用复合格式 `"chatId:topicId"`。

## 12. sendMessage（话题模式） — 向论坛话题发送消息

### 12.1 接口定义

向论坛话题发送消息与普通 `sendMessage` 使用相同的接口，额外传入 `message_thread_id` 参数即可。

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/sendMessage`

**Request Body**

```json
{
  "chat_id": -1001234567890,
  "message_thread_id": 42,
  "parse_mode": "HTML",
  "text": "这条消息发送到指定话题"
}
```

**参数说明**

除 `sendMessage` 的所有参数外（见第 3 节），关键区别在于：

| 参数                | 类型      | 是否必需 | 说明                                                  |
| ------------------- | --------- | -------- | ----------------------------------------------------- |
| `message_thread_id` | `Integer` | 是 (\*)  | 论坛话题的线程 ID（即 `createForumTopic` 返回的值）。 |

(\*) 在论坛模式群组中，向特定话题发送消息时必需。

**Response Body**

与普通 `sendMessage` 一致，返回 `Message` 对象。

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendMessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "message_thread_id": 42,
    "text": "在话题中回复的消息",
    "parse_mode": "HTML"
  }'
```

**工程建议**

- 本仓库 `TelegramApi.sendMessageToTopic` 封装了此调用，自动传入 `message_thread_id`。
- **重要：`parse_mode` 必须与普通 `sendMessage` 一样传入**（如 `parse_mode: 'HTML'`）。此参数在话题模式下容易遗漏，曾在 code review 中发现原实现缺失了 `parse_mode: 'HTML'`，导致话题消息中 HTML 标签被原样显示而非渲染为富文本。
- 如果群组开启了论坛模式但未指定 `message_thread_id`，消息将发送到 "General" 话题（thread_id 通常为 1）。
- `message_thread_id` 也可用于 `sendChatAction` 等其他方法，指定动作所在的话题。

## 13. sendPoll — 发送投票

### 13.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/sendPoll`

**Request Body**

```json
{
  "allows_multiple_answers": false,
  "chat_id": -1001234567890,
  "is_anonymous": true,
  "options": [{ "text": "TypeScript" }, { "text": "Python" }, { "text": "Rust" }, { "text": "Go" }],
  "question": "你最喜欢的编程语言？"
}
```

**参数说明**

| 参数                      | 类型                      | 是否必需 | 说明                                                                 |
| ------------------------- | ------------------------- | -------- | -------------------------------------------------------------------- |
| `chat_id`                 | `Integer` 或 `String`     | 是       | 目标聊天标识符。                                                     |
| `question`                | `String`                  | 是       | 投票问题；长度 1–300 字符。                                          |
| `options`                 | `Array<InputPollOption>`  | 是       | 投票选项列表；2–10 个选项。                                          |
| `is_anonymous`            | `Boolean`                 | 否       | 是否匿名投票；默认 `true`。                                          |
| `type`                    | `String`                  | 否       | 投票类型：`regular`（普通）或 `quiz`（测验）；默认 `regular`。       |
| `allows_multiple_answers` | `Boolean`                 | 否       | 是否允许多选；默认 `false`。仅 `regular` 类型可用。                  |
| `correct_option_id`       | `Integer`                 | 条件必需 | 测验模式的正确答案索引（从 0 开始）；`quiz` 类型必需。               |
| `explanation`             | `String`                  | 否       | 用户选错后显示的解释文本；0–200 字符。                               |
| `explanation_parse_mode`  | `String`                  | 否       | 解释文本的格式化模式。                                               |
| `explanation_entities`    | `Array<MessageEntity>`    | 否       | 解释文本的格式化实体。                                               |
| `open_period`             | `Integer`                 | 否       | 投票创建后的活跃时间（秒）；5–600。与 `close_date` 互斥。            |
| `close_date`              | `Integer`                 | 否       | 投票自动关闭的 Unix 时间戳；距当前 5–600 秒。与 `open_period` 互斥。 |
| `is_closed`               | `Boolean`                 | 否       | 是否立即关闭投票。                                                   |
| `message_thread_id`       | `Integer`                 | 否       | 论坛话题线程 ID。                                                    |
| `disable_notification`    | `Boolean`                 | 否       | 静默发送。                                                           |
| `protect_content`         | `Boolean`                 | 否       | 保护投票内容不被转发。                                               |
| `reply_parameters`        | `ReplyParameters`         | 否       | 回复配置。                                                           |
| `reply_markup`            | `InlineKeyboardMarkup` 等 | 否       | 内联键盘或自定义键盘。                                               |

### 13.2 InputPollOption 结构

| 字段              | 类型                   | 是否必需 | 说明                                               |
| ----------------- | ---------------------- | -------- | -------------------------------------------------- |
| `text`            | `String`               | 是       | 选项文本；长度 1–100 字符。                        |
| `text_parse_mode` | `String`               | 否       | 选项文本的格式化模式（当前仅支持自定义表情实体）。 |
| `text_entities`   | `Array<MessageEntity>` | 否       | 选项文本的格式化实体（当前仅支持自定义表情实体）。 |

**Response Body**

成功时返回包含 `Poll` 的 `Message` 对象：

```json
{
  "ok": true,
  "result": {
    "message_id": 5678,
    "chat": { "id": -1001234567890, "type": "supergroup" },
    "date": 1711468800,
    "poll": {
      "id": "5012345678901234567",
      "question": "你最喜欢的编程语言？",
      "options": [
        { "text": "TypeScript", "voter_count": 0 },
        { "text": "Python", "voter_count": 0 },
        { "text": "Rust", "voter_count": 0 },
        { "text": "Go", "voter_count": 0 }
      ],
      "total_voter_count": 0,
      "is_closed": false,
      "is_anonymous": true,
      "type": "regular",
      "allows_multiple_answers": false
    }
  }
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendPoll' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "question": "你最喜欢的编程语言？",
    "options": [
      {"text": "TypeScript"},
      {"text": "Python"},
      {"text": "Rust"},
      {"text": "Go"}
    ],
    "is_anonymous": true,
    "allows_multiple_answers": false
  }'
```

**工程建议**

- 本仓库 `TelegramApi.sendPoll` 将 `options` 参数从 `string[]` 转换为 `InputPollOption[]` 格式（`options.map(text => ({ text }))`）。
- 投票选项数量限制为 2–10 个；少于 2 个或多于 10 个将返回错误。
- `open_period` 和 `close_date` 不可同时使用。
- 从返回值中可提取 `poll.id` 用于后续追踪投票结果。

## 14. sendChatAction — 发送输入状态指示

### 14.1 接口定义

**Method**

`POST`

**URL**

`https://api.telegram.org/bot{token}/sendChatAction`

**Request Body**

```json
{
  "action": "typing",
  "chat_id": -1001234567890
}
```

**参数说明**

| 参数                | 类型                  | 是否必需 | 说明                 |
| ------------------- | --------------------- | -------- | -------------------- |
| `chat_id`           | `Integer` 或 `String` | 是       | 目标聊天标识符。     |
| `action`            | `String`              | 是       | 动作类型（见下表）。 |
| `message_thread_id` | `Integer`             | 否       | 论坛话题线程 ID。    |

### 14.2 支持的 action 值

| action              | 对应场景                     |
| ------------------- | ---------------------------- |
| `typing`            | 即将发送文本消息。           |
| `upload_photo`      | 即将发送照片。               |
| `record_video`      | 即将发送视频（录制中）。     |
| `upload_video`      | 即将发送视频（上传中）。     |
| `record_voice`      | 即将发送语音（录制中）。     |
| `upload_voice`      | 即将发送语音（上传中）。     |
| `upload_document`   | 即将发送文件。               |
| `choose_sticker`    | 即将发送贴纸。               |
| `find_location`     | 即将发送位置。               |
| `record_video_note` | 即将发送视频笔记（录制中）。 |
| `upload_video_note` | 即将发送视频笔记（上传中）。 |

**Response Body**

成功时返回 `true`：

```json
{
  "ok": true,
  "result": true
}
```

**curl 示例**

```bash
curl 'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendChatAction' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "chat_id": -1001234567890,
    "action": "typing"
  }'
```

**工程建议**

- `typing` 状态持续时间最多 **5 秒**；如果 Bot 在此期间发送了消息，客户端会立即清除输入状态。
- 对于长时间处理的任务，建议每 5 秒重复调用一次 `sendChatAction` 以保持 "正在输入" 状态。
- Telegram 官方建议仅在 Bot 回复需要明显等待时间时才使用此方法。
- 本仓库 `TelegramApi.sendChatAction` 默认 `action` 为 `typing`。

## 15. 速率限制

Telegram Bot API 有以下速率限制：

| 维度             | 限制                                                       |
| ---------------- | ---------------------------------------------------------- |
| 同一聊天发送消息 | 每秒不超过 1 条消息（突发最多约 30 条 / 秒，但会被限流）。 |
| 群组发送消息     | 每分钟不超过 20 条消息。                                   |
| 全局发送消息     | 每秒不超过 30 条消息。                                     |
| 批量通知         | 同一条消息不能在 1 秒内发送给超过 30 个不同聊天。          |

收到 `429 Too Many Requests` 时，响应中会包含 `retry_after` 参数：

```json
{
  "description": "Too Many Requests: retry after 35",
  "error_code": 429,
  "ok": false,
  "parameters": {
    "retry_after": 35
  }
}
```

**工程建议**

- 实现指数退避重试策略。
- 解析 `parameters.retry_after` 字段获取精确等待时间。
- 对于流式输出场景（多次 `editMessageText`），建议控制编辑频率在每秒 1-2 次。

## 16. 附录

### 16.1 Message 对象关键字段

以下列出 `sendMessage` 等方法返回的 `Message` 对象中最常用的字段：

| 字段                | 类型       | 说明                          |
| ------------------- | ---------- | ----------------------------- |
| `message_id`        | `Integer`  | 消息在聊天中的唯一标识符。    |
| `from`              | `User?`    | 发送者信息。                  |
| `chat`              | `Chat`     | 消息所属聊天。                |
| `date`              | `Integer`  | 消息发送时间（Unix 时间戳）。 |
| `edit_date`         | `Integer?` | 最近编辑时间（Unix 时间戳）。 |
| `text`              | `String?`  | 文本消息内容。                |
| `entities`          | `Array?`   | 消息中的格式化实体。          |
| `reply_to_message`  | `Message?` | 被回复的消息。                |
| `message_thread_id` | `Integer?` | 消息所属论坛话题的线程 ID。   |
| `poll`              | `Poll?`    | 投票信息（仅投票消息）。      |

### 16.2 本仓库 TelegramApi 方法映射表

| TelegramApi 方法        | Telegram API 方法    | 关键参数                                                  |
| ----------------------- | -------------------- | --------------------------------------------------------- |
| `sendMessage`           | `sendMessage`        | `chat_id`, `text`, `parse_mode=HTML`                      |
| `editMessageText`       | `editMessageText`    | `chat_id`, `message_id`, `text`, `parse_mode=HTML`        |
| `deleteMessage`         | `deleteMessage`      | `chat_id`, `message_id`                                   |
| `sendChatAction`        | `sendChatAction`     | `chat_id`, `action=typing`                                |
| `setMessageReaction`    | `setMessageReaction` | `chat_id`, `message_id`, `reaction=[{type,emoji}]`        |
| `removeMessageReaction` | `setMessageReaction` | `chat_id`, `message_id`, `reaction=[]`                    |
| `pinChatMessage`        | `pinChatMessage`     | `chat_id`, `message_id`, `disable_notification=true`      |
| `unpinChatMessage`      | `unpinChatMessage`   | `chat_id`, `message_id`                                   |
| `getChat`               | `getChat`            | `chat_id`                                                 |
| `getChatMember`         | `getChatMember`      | `chat_id`, `user_id`                                      |
| `createForumTopic`      | `createForumTopic`   | `chat_id`, `name` (max 128 chars)                         |
| `sendMessageToTopic`    | `sendMessage`        | `chat_id`, `message_thread_id`, `text`, `parse_mode=HTML` |
| `sendPoll`              | `sendPoll`           | `chat_id`, `question`, `options`                          |
| `setMyCommands`         | `setMyCommands`      | `commands`                                                |

### 16.3 与微信 iLink 协议的关键差异

| 维度         | Telegram Bot API                           | 微信 iLink API                         |
| ------------ | ------------------------------------------ | -------------------------------------- |
| 认证方式     | Bot Token 直接放入 URL 路径。              | Bearer Token 放入 `Authorization` 头。 |
| 消息路由     | 通过 `chat_id` + `message_id` 定位。       | 依赖 `context_token` 做会话路由。      |
| 消息接收     | Webhook 或 `getUpdates` 长轮询。           | `getupdates` 长轮询。                  |
| 消息编辑     | 原生支持 `editMessageText`。               | 无原生编辑能力；需新发消息替代。       |
| 消息删除     | 原生支持 `deleteMessage`，有 48 小时限制。 | 无原生删除能力。                       |
| Reaction     | 原生支持 `setMessageReaction`。            | 不支持。                               |
| 消息格式     | HTML / MarkdownV2。                        | 纯文本 + 媒体 item_list 结构。         |
| 文本长度上限 | 4096 字符。                                | 约 2000 字符（社区经验值）。           |
| 论坛 / 话题  | 原生支持 Forum Topics。                    | 不支持。                               |
| 投票         | 原生支持 `sendPoll`。                      | 不支持。                               |
| 速率限制     | 每聊天～1 msg/s，全局 30 msg/s。           | 未公开文档化。                         |

## 17. 实测验证记录

> 本节记录了对 Telegram Bot API 实现的实际验证结果，包含 Token 验证、API 测试和 code review 发现的问题修复。

### 17.1 Token 验证

通过 `getMe` 接口验证 Bot Token 有效性：

- **Bot 用户名**：@JianXu_Lobehub_Test_Bot
- **Bot ID**：8654315085
- **验证结果**：Token 有效，Bot 身份确认。

### 17.2 直接 API 测试限制

由于该 Bot 已设置了活跃的 Webhook，`getUpdates`（长轮询模式）无法使用。Telegram 不允许 Webhook 模式和 `getUpdates` 同时生效 —— 调用 `getUpdates` 时会返回错误：

```
Conflict: can't use getUpdates method while webhook is active
```

因此，直接 API 测试受限于不依赖消息接收的方法（如 `getMe`、`getChat` 等）。大部分消息操作 API 的验证通过 code review 完成。

### 17.3 Code Review 验证结果

以下 API 实现通过 code review 对照本协议规范进行了逐项验证：

| API 方法             | 验证状态   | 备注                                                                  |
| -------------------- | ---------- | --------------------------------------------------------------------- |
| `sendMessage`        | 通过       | 参数、parse_mode、截断逻辑均符合规范。                                |
| `editMessageText`    | 通过       | 包含 "message is not modified" 静默处理。                             |
| `deleteMessage`      | 通过       | 参数正确。                                                            |
| `setMessageReaction` | 通过       | 添加 / 移除 Reaction 两种模式均正确。                                 |
| `pinChatMessage`     | 通过       | 默认 `disable_notification=true`。                                    |
| `unpinChatMessage`   | 通过       | 始终传递 `message_id`。                                               |
| `sendMessageToTopic` | 修复后通过 | 原实现缺少 `parse_mode: 'HTML'`，已修复。                             |
| `createForumTopic`   | 修复后通过 | 原 `createThread` 返回裸 topicId，已修复为复合格式 `chatId:topicId`。 |

### 17.4 关键 Bug 修复摘要

1. **`sendMessageToTopic` 缺少 `parse_mode`**（见第 12 节）：向论坛话题发送消息时未传入 `parse_mode: 'HTML'`，导致 HTML 标签被原样显示。修复：在 `sendMessageToTopic` 调用中补充 `parse_mode: 'HTML'` 参数。

2. **`createThread` 返回的 threadId 格式不兼容**（见第 11.3 节）：`createThread` 原实现仅返回 Telegram API 的 `message_thread_id`（如 `"42"`），而 `replyToThread` 期望接收 `"chatId:topicId"` 格式。修复：`createThread` 改为返回 `"${chatId}:${message_thread_id}"` 复合格式。
