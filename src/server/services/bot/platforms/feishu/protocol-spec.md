# 飞书 / Lark 开放平台消息 API 通信协议规范

> 适用对象：实现飞书 / Lark Bot 消息操作的 SDK、网关和独立 Bot。
>
> 整理依据：飞书开放平台官方文档（<https://open.feishu.cn/document）、仓库内> `packages/chat-adapter-feishu/src/api.ts` 客户端实现。
>
> 说明：文中标注 "工程建议" 的内容来自现有客户端实现经验，用于提高兼容性；它们不是服务端返回字段本身的一部分。

## 1. 概述

飞书（Feishu）/ Lark 开放平台提供 HTTP/JSON 风格的 RESTful API，用于自建应用（Custom App）与飞书 IM 系统交互。协议核心特征有三点：一是认证使用 `app_id` + `app_secret` 换取 `tenant_access_token`，有效期 2 小时，SDK 需主动缓存和刷新；二是消息体的 `content` 字段统一为 JSON 字符串序列化（`JSON.stringify`），不是裸对象；三是消息接收走事件订阅（Event Subscription）或长连接（WebSocket），不是轮询。

### 1.1 基座地址

| 平台      | 基座地址                               |
| --------- | -------------------------------------- |
| 飞书      | `https://open.feishu.cn/open-apis`     |
| Lark 国际 | `https://open.larksuite.com/open-apis` |

本文所有 API 路径均相对于基座地址。例如 `/im/v1/messages` 的完整 URL 为 `https://open.feishu.cn/open-apis/im/v1/messages`。

### 1.2 通用限流

除非单独标注，所有 IM 相关 API 的通用限流为：

- **全局**：1000 次 / 分钟、50 次 / 秒
- **同用户发送**：5 QPS
- **同群组发送**：群内所有机器人共享 5 QPS

## 2. 认证

### 2.1 获取 tenant_access_token（自建应用）

**Method**

`POST`

**URL**

`/auth/v3/tenant_access_token/internal`

**Headers**

| Header         | 是否必需 | 说明                                |
| -------------- | -------- | ----------------------------------- |
| `Content-Type` | 是       | `application/json; charset=utf-8`。 |

注意：此接口**不需要** `Authorization` 头，因为它就是用来获取凭证的。

**Request Body**

```json
{
  "app_id": "cli_slkdjalasdkjasd",
  "app_secret": "dskLLdkasdjlasdKK"
}
```

字段说明：

| 字段         | 类型     | 必填 | 说明                           |
| ------------ | -------- | ---- | ------------------------------ |
| `app_id`     | `string` | 是   | 应用唯一标识，创建应用后获得。 |
| `app_secret` | `string` | 是   | 应用秘钥，创建应用后获得。     |

**Response Body**

```json
{
  "code": 0,
  "expire": 7200,
  "msg": "ok",
  "tenant_access_token": "t-caecc734c2e3328a62489fe0648c4b98779515d3"
}
```

字段说明：

| 字段                  | 类型     | 说明                                      |
| --------------------- | -------- | ----------------------------------------- |
| `code`                | `int`    | 错误码，`0` 表示成功。                    |
| `msg`                 | `string` | 错误描述。                                |
| `tenant_access_token` | `string` | 租户访问凭证。                            |
| `expire`              | `int`    | 有效期，单位秒。通常为 `7200`（2 小时）。 |

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
  -X POST \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-raw '{
    "app_id": "cli_slkdjalasdkjasd",
    "app_secret": "dskLLdkasdjlasdKK"
  }'
```

**Token 缓存与刷新**

- 凭证有效期最长 2 小时。
- 当剩余有效期 < 30 分钟时，重新调用本接口会返回新 token；否则返回当前仍有效的 token。
- 刷新期间新旧 token 可同时有效。
- 建议在 token 过期前 5 分钟主动刷新，避免边界情况下的 401 错误。

**工程建议**

- 在内存中缓存 `tenant_access_token` 和过期时间戳，不要每次请求都重新获取。
- 设置安全余量（如过期前 300 秒刷新），参见 `LarkApiClient` 实现中的 `tokenExpiresAt = Date.now() + (data.expire - 300) * 1000`。
- `app_secret` 属敏感信息，不要提交到代码仓库或日志中。

## 3. 公共请求规范

### 3.1 通用请求头

以下规范适用于所有需要认证的业务 API。

| Header          | 示例值                                              | 是否必需 | 说明                                           |
| --------------- | --------------------------------------------------- | -------- | ---------------------------------------------- |
| `Authorization` | `Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3` | 是       | `tenant_access_token` 或 `user_access_token`。 |
| `Content-Type`  | `application/json; charset=utf-8`                   | 是       | 所有业务接口都发 JSON。                        |

### 3.2 通用响应结构

所有 API 的响应遵循统一信封格式：

```json
{
  "code": 0,
  "msg": "success",
  "data": { ... }
}
```

| 字段   | 类型     | 说明                       |
| ------ | -------- | -------------------------- |
| `code` | `int`    | 错误码，`0` 表示成功。     |
| `msg`  | `string` | 错误描述。                 |
| `data` | `object` | 业务数据，各接口定义不同。 |

### 3.3 消息内容的 JSON 序列化约定

所有发送 / 编辑消息接口的 `content` 字段值必须是 **JSON 字符串序列化后的值**，即对消息体对象执行 `JSON.stringify()` 的结果。例如发送文本消息 `hello`，`content` 的值是：

```json
"{\"text\":\"hello\"}"
```

而**不是**裸对象 `{"text":"hello"}`。

### 3.4 ID 格式说明

| ID 类型              | 前缀  | 示例                                      |
| -------------------- | ----- | ----------------------------------------- |
| `open_id`（用户）    | `ou_` | `ou_7d8a6e6df7621556ce0d21922b676706ccs2` |
| `union_id`（用户）   | `on_` | `on_94a1ee5551019f18cd73d9f111898cf8`     |
| `chat_id`（群组）    | `oc_` | `oc_84983ff6516d731e5b5f68d4ea2e1da5`     |
| `message_id`（消息） | `om_` | `om_dc13264520392913993dd051dba21dcf`     |

## 4. 消息操作

### 4.1 发送消息

**Method**

`POST`

**URL**

`/im/v1/messages?receive_id_type={receive_id_type}`

**Query 参数**

| 参数              | 类型     | 必填 | 说明                                                                   |
| ----------------- | -------- | ---- | ---------------------------------------------------------------------- |
| `receive_id_type` | `string` | 是   | 接收者 ID 类型：`open_id`、`union_id`、`user_id`、`email`、`chat_id`。 |

**Request Body**

```json
{
  "content": "{\"text\":\"test content\"}",
  "msg_type": "text",
  "receive_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
  "uuid": "a0d69e20-1dd1-458b-k525-dfeca4015204"
}
```

字段说明：

| 字段         | 类型     | 必填 | 说明                                                                                                                          |
| ------------ | -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `receive_id` | `string` | 是   | 接收者 ID，类型由 `receive_id_type` 决定。                                                                                    |
| `msg_type`   | `string` | 是   | 消息类型：`text`、`post`、`image`、`file`、`audio`、`media`、`sticker`、`interactive`、`share_chat`、`share_user`、`system`。 |
| `content`    | `string` | 是   | JSON 序列化后的消息内容（见第 3.3 节）。文本消息最大 150 KB，卡片 / 富文本最大 30 KB。                                        |
| `uuid`       | `string` | 否   | 去重标识，最多 50 字符。1 小时内同 uuid 至多成功发送一条。                                                                    |

**Response Body**

```json
{
  "code": 0,
  "data": {
    "message_id": "om_dc13264520392913993dd051dba21dcf",
    "root_id": "",
    "parent_id": "",
    "thread_id": "",
    "msg_type": "text",
    "create_time": "1710488400000",
    "update_time": "1710488400000",
    "deleted": false,
    "updated": false,
    "chat_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
    "sender": {
      "id": "cli_slkdjalasdkjasd",
      "id_type": "app_id",
      "sender_type": "app",
      "tenant_key": "736588c9260f175e"
    },
    "body": {
      "content": "{\"text\":\"test content\"}"
    },
    "mentions": []
  },
  "msg": "success"
}
```

`data` 字段说明：

| 字段          | 类型     | 说明                                |
| ------------- | -------- | ----------------------------------- |
| `message_id`  | `string` | 系统生成的消息唯一 ID，`om_` 前缀。 |
| `root_id`     | `string` | 话题（thread）根消息 ID。           |
| `parent_id`   | `string` | 父消息 ID。                         |
| `thread_id`   | `string` | 话题 ID（若适用）。                 |
| `msg_type`    | `string` | 消息类型。                          |
| `create_time` | `string` | 创建时间，毫秒时间戳字符串。        |
| `update_time` | `string` | 更新时间，毫秒时间戳字符串。        |

> **⚠ 注意：`create_time` 和 `update_time` 是毫秒时间戳字符串**
>
> 飞书消息对象中的 `create_time` 和 `update_time` 返回的是**毫秒级** Unix 时间戳字符串（例如 `"1710488400000"`，即 13 位数字），**不是秒级时间戳**。在将其转换为 `Date` 对象时，应直接使用 `new Date(Number(create_time))`，**不要再乘以 1000**。原始服务实现中曾错误地将毫秒值再次乘以 1000，导致时间戳偏差约 1000 倍（日期跑到遥远的未来）。此 bug 已修复。
> \| `deleted` | `boolean` | 是否已撤回。 |
> \| `updated` | `boolean` | 是否已编辑。 |
> \| `chat_id` | `string` | 消息所属群 ID。 |
> \| `sender` | `object` | 发送者信息。 |
> \| `sender.id` | `string` | 发送者 ID。 |
> \| `sender.id_type` | `string` | 发送者 ID 类型（`open_id`、`app_id`）。 |
> \| `sender.sender_type` | `string` | 发送者类型：`user`、`app`、`anonymous`、`unknown`。 |
> \| `sender.tenant_key` | `string` | 租户标识。 |
> \| `body` | `object` | 消息内容。 |
> \| `body.content` | `string` | JSON 序列化的消息体。 |
> \| `mentions` | `array` | 被 @ 的用户列表。 |

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id' \
  -X POST \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-raw '{
    "receive_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
    "msg_type": "text",
    "content": "{\"text\":\"test content\"}"
  }'
```

**主要错误码**

| 错误码   | 含义                     |
| -------- | ------------------------ |
| `230001` | 请求参数无效。           |
| `230002` | 机器人不在该群组中。     |
| `230006` | 未启用机器人能力。       |
| `230013` | 用户不在应用可用范围内。 |
| `230020` | 触发频率限制。           |
| `230025` | 消息体超出长度限制。     |
| `230099` | 卡片内容创建失败。       |

**工程建议**

- Bot 应用需在开发者后台启用机器人能力并发布版本。
- 发送消息到群组时，机器人必须已加入该群。
- 文本消息 `content` 格式为 `{"text":"内容"}`，发送前需做 `JSON.stringify()`。
- 当前 `LarkApiClient` 实现中对文本做了 4000 字符截断（`MAX_TEXT_LENGTH = 4000`），这是客户端保守策略；官方协议层限制为 150 KB。
- `uuid` 可用于幂等发送，同一 uuid 在 1 小时内只会成功投递一次。

### 4.2 编辑消息

**Method**

`PUT`

**URL**

`/im/v1/messages/{message_id}`

**Path 参数**

| 参数         | 类型     | 必填 | 说明                                       |
| ------------ | -------- | ---- | ------------------------------------------ |
| `message_id` | `string` | 是   | 待编辑消息的 ID，仅支持 `text` 和 `post`。 |

**Request Body**

```json
{
  "content": "{\"text\":\"updated content\"}",
  "msg_type": "text"
}
```

字段说明：

| 字段       | 类型     | 必填 | 说明                                                             |
| ---------- | -------- | ---- | ---------------------------------------------------------------- |
| `msg_type` | `string` | 是   | 消息类型，仅支持 `text`（纯文本）和 `post`（富文本）。           |
| `content`  | `string` | 是   | JSON 序列化后的消息内容。文本消息最大 150 KB，富文本最大 30 KB。 |

**Response Body**

```json
{
  "code": 0,
  "data": {
    "message_id": "om_dc13264520392913993dd051dba21dcf",
    "msg_type": "text",
    "create_time": "1710488400000",
    "update_time": "1710488500000",
    "deleted": false,
    "updated": true,
    "chat_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
    "sender": {
      "id": "cli_slkdjalasdkjasd",
      "id_type": "app_id",
      "sender_type": "app",
      "tenant_key": "736588c9260f175e"
    },
    "body": {
      "content": "{\"text\":\"updated content\"}"
    },
    "mentions": [],
    "root_id": "",
    "parent_id": "",
    "thread_id": ""
  },
  "msg": "success"
}
```

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages/om_dc13264520392913993dd051dba21dcf' \
  -X PUT \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-raw '{
    "msg_type": "text",
    "content": "{\"text\":\"updated content\"}"
  }'
```

**主要错误码**

| 错误码   | 含义                                     |
| -------- | ---------------------------------------- |
| `230054` | 消息类型不支持编辑（仅支持 text/post）。 |
| `230071` | 操作者不是消息发送者。                   |
| `230072` | 消息已达 20 次编辑上限。                 |
| `230075` | 消息已超出可编辑时间窗口。               |

**工程建议**

- 仅消息发送者可以编辑自己的消息。
- 每条消息最多编辑 20 次。
- 已撤回、已删除或超过时间窗口的消息无法编辑。
- 仅 `text` 和 `post` 类型支持编辑，`interactive`（卡片）不支持。

### 4.3 撤回消息

**Method**

`DELETE`

**URL**

`/im/v1/messages/{message_id}`

**Path 参数**

| 参数         | 类型     | 必填 | 说明              |
| ------------ | -------- | ---- | ----------------- |
| `message_id` | `string` | 是   | 待撤回消息的 ID。 |

**Request Body**

无。

**Response Body**

```json
{
  "code": 0,
  "data": {},
  "msg": "success"
}
```

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages/om_dc13264520392913993dd051dba21dcf' \
  -X DELETE \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3'
```

**主要错误码**

| 错误码   | 含义                                   |
| -------- | -------------------------------------- |
| `230006` | 未启用机器人能力。                     |
| `230009` | 消息超出管理员配置的撤回时间限制。     |
| `230026` | 无撤回权限（只能撤回自己发送的消息）。 |
| `230054` | 不支持的消息类型。                     |

**工程建议**

- 机器人只能撤回自己发送的消息；群主可撤回群内任何消息。
- 撤回时间受企业管理员配置的限制。
- 非群主的机器人无法撤回超过 1 年的消息。
- 批量发送的消息不支持撤回。

### 4.4 获取消息

**Method**

`GET`

**URL**

`/im/v1/messages/{message_id}`

**Path 参数**

| 参数         | 类型     | 必填 | 说明          |
| ------------ | -------- | ---- | ------------- |
| `message_id` | `string` | 是   | 目标消息 ID。 |

**Query 参数**

| 参数           | 类型     | 必填 | 说明                                                     |
| -------------- | -------- | ---- | -------------------------------------------------------- |
| `user_id_type` | `string` | 否   | 用户 ID 格式：`open_id`（默认）、`union_id`、`user_id`。 |

**Response Body**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "message_id": "om_dc13264520392913993dd051dba21dcf",
        "root_id": "",
        "parent_id": "",
        "thread_id": "",
        "msg_type": "text",
        "create_time": "1710488400000",
        "update_time": "1710488400000",
        "deleted": false,
        "updated": false,
        "chat_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
        "sender": {
          "id": "ou_7d8a6e6df7621556ce0d21922b676706ccs2",
          "id_type": "open_id",
          "sender_type": "user",
          "tenant_key": "736588c9260f175e"
        },
        "body": {
          "content": "{\"text\":\"hello\"}"
        },
        "mentions": []
      }
    ]
  },
  "msg": "success"
}
```

`data` 字段说明：

| 字段    | 类型    | 说明                                                                    |
| ------- | ------- | ----------------------------------------------------------------------- |
| `items` | `array` | 消息数组。普通消息返回 1 条；合并转发消息返回 1 条父消息 + N 条子消息。 |

`items[*]` 的字段结构与第 4.1 节发送消息响应的 `data` 一致。

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages/om_dc13264520392913993dd051dba21dcf' \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3'
```

**主要错误码**

| 错误码   | 含义               |
| -------- | ------------------ |
| `230002` | 机器人不在群组中。 |
| `230006` | 未启用机器人能力。 |
| `230027` | 权限不足。         |
| `230110` | 消息已被删除。     |

### 4.5 获取会话历史消息

**Method**

`GET`

**URL**

`/im/v1/messages`

**Query 参数**

| 参数                | 类型     | 必填 | 说明                                                                                           |
| ------------------- | -------- | ---- | ---------------------------------------------------------------------------------------------- |
| `container_id_type` | `string` | 是   | 容器类型：`chat`（单聊 / 群聊）或 `thread`（话题）。                                           |
| `container_id`      | `string` | 是   | 容器 ID，与类型对应。`chat` 时传 `chat_id`，`thread` 时传 `thread_id`。                        |
| `start_time`        | `string` | 否   | 查询起始时间，Unix 时间戳（**秒**）。`thread` 类型不支持。                                     |
| `end_time`          | `string` | 否   | 查询结束时间，Unix 时间戳（**秒**）。`thread` 类型不支持。                                     |
| `sort_type`         | `string` | 否   | 排序方式：`ByCreateTimeAsc`（升序，默认）或 `ByCreateTimeDesc`（降序）。分页请求中需保持一致。 |
| `page_size`         | `int`    | 否   | 每页条数，默认 20，范围 1–50。                                                                 |
| `page_token`        | `string` | 否   | 分页标记。首次请求不传；后续用响应中的 `page_token`。                                          |

**Response Body**

```json
{
  "code": 0,
  "data": {
    "has_more": true,
    "page_token": "GxmvlNRvP0NdQZpa7yIqf_Lv_QuBwTQ8tXkX7w-irAghVD9TRuVJ8PHz-BKV5QQP",
    "items": [
      {
        "message_id": "om_dc13264520392913993dd051dba21dcf",
        "root_id": "",
        "parent_id": "",
        "thread_id": "",
        "msg_type": "text",
        "create_time": "1710488400000",
        "update_time": "1710488400000",
        "deleted": false,
        "updated": false,
        "chat_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
        "sender": {
          "id": "ou_7d8a6e6df7621556ce0d21922b676706ccs2",
          "id_type": "open_id",
          "sender_type": "user",
          "tenant_key": "736588c9260f175e"
        },
        "body": {
          "content": "{\"text\":\"hello\"}"
        },
        "mentions": [],
        "upper_message_id": ""
      }
    ]
  },
  "msg": "success"
}
```

`data` 字段说明：

| 字段         | 类型      | 说明                                         |
| ------------ | --------- | -------------------------------------------- |
| `has_more`   | `boolean` | 是否还有更多数据。                           |
| `page_token` | `string`  | 下一页分页标记（`has_more = true` 时返回）。 |
| `items`      | `array`   | 消息对象数组，结构同第 4.1 节。              |

`items[*]` 额外字段：

| 字段               | 类型     | 说明                        |
| ------------------ | -------- | --------------------------- |
| `upper_message_id` | `string` | 合并转发场景中的父消息 ID。 |

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=oc_84983ff6516d731e5b5f68d4ea2e1da5&page_size=20' \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3'
```

**主要错误码**

| 错误码   | 含义                 |
| -------- | -------------------- |
| `230002` | 机器人不在群组中。   |
| `230006` | 未启用机器人能力。   |
| `230027` | 权限不足。           |
| `230073` | 话题对操作者不可见。 |

**权限说明**

需具备以下任一权限：

- `im:message`（获取与发送单聊、群组消息）
- `im:message:readonly`（获取单聊、群组消息）
- `im:message.history:readonly`（获取历史消息）

获取群消息还需额外权限 `im:message.group_msg`。

**工程建议**

- `start_time` / `end_time` 使用 Unix 秒级时间戳，不是毫秒。
- 分页请求中 `sort_type` 需全程保持一致。
- 当前 `LarkApiClient` 实现中使用 `container_id_type=chat` 和 `container_id=chatId`。

> **`start_time` / `end_time` 与服务适配器的映射关系**
>
> `start_time` 和 `end_time` 都是 Unix **秒级**时间戳（不是毫秒），可用于按时间范围过滤消息。在 message tool 的服务适配器中，`readMessages` 操作的 `before` 参数映射为飞书 API 的 `endTime`，`after` 参数映射为 `startTime`。即：
>
> - `after`（获取此时间之后的消息） → 飞书 `start_time`
> - `before`（获取此时间之前的消息） → 飞书 `end_time`
>
> 分页通过 `page_token` 和 `page_size` 支持，适配器将 `limit` 映射为 `page_size`（范围 1-50）。

### 4.6 回复消息

**Method**

`POST`

**URL**

`/im/v1/messages/{message_id}/reply`

**Path 参数**

| 参数         | 类型     | 必填 | 说明              |
| ------------ | -------- | ---- | ----------------- |
| `message_id` | `string` | 是   | 被回复消息的 ID。 |

**Request Body**

```json
{
  "content": "{\"text\":\"reply content\"}",
  "msg_type": "text",
  "reply_in_thread": false,
  "uuid": "a0d69e20-1dd1-458b-k525-dfeca4015204"
}
```

字段说明：

| 字段              | 类型      | 必填 | 说明                                                                                                                |
| ----------------- | --------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `content`         | `string`  | 是   | JSON 序列化后的消息内容。文本消息最大 150 KB，卡片 / 富文本最大 30 KB。                                             |
| `msg_type`        | `string`  | 是   | 消息类型：`text`、`post`、`image`、`file`、`audio`、`media`、`sticker`、`interactive`、`share_chat`、`share_user`。 |
| `reply_in_thread` | `boolean` | 否   | 是否以话题（thread）形式回复，默认 `false`。                                                                        |
| `uuid`            | `string`  | 否   | 去重标识，最多 50 字符。1 小时内同 uuid 至多成功发送一条。                                                          |

**Response Body**

结构与第 4.1 节发送消息响应 `data` 一致，额外字段 `root_id` 和 `parent_id` 会指向被回复的消息。

```json
{
  "code": 0,
  "data": {
    "message_id": "om_abcdef1234567890abcdef1234567890",
    "root_id": "om_dc13264520392913993dd051dba21dcf",
    "parent_id": "om_dc13264520392913993dd051dba21dcf",
    "thread_id": "",
    "msg_type": "text",
    "create_time": "1710488500000",
    "update_time": "1710488500000",
    "deleted": false,
    "updated": false,
    "chat_id": "oc_84983ff6516d731e5b5f68d4ea2e1da5",
    "sender": {
      "id": "cli_slkdjalasdkjasd",
      "id_type": "app_id",
      "sender_type": "app",
      "tenant_key": "736588c9260f175e"
    },
    "body": {
      "content": "{\"text\":\"reply content\"}"
    },
    "mentions": []
  },
  "msg": "success"
}
```

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages/om_dc13264520392913993dd051dba21dcf/reply' \
  -X POST \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-raw '{
    "content": "{\"text\":\"reply content\"}",
    "msg_type": "text"
  }'
```

**主要错误码**

与发送消息一致（见第 4.1 节）。

**工程建议**

- 回复消息会自动在被回复消息下方显示引用气泡。
- 机器人需在被回复消息所在的群组中。
- `reply_in_thread = true` 时创建话题回复，适合长对话场景。

## 5. 表情回复

### 5.1 添加表情回复

**Method**

`POST`

**URL**

`/im/v1/messages/{message_id}/reactions`

**Path 参数**

| 参数         | 类型     | 必填 | 说明          |
| ------------ | -------- | ---- | ------------- |
| `message_id` | `string` | 是   | 目标消息 ID。 |

**Request Body**

```json
{
  "reaction_type": {
    "emoji_type": "SMILE"
  }
}
```

字段说明：

| 字段                       | 类型     | 必填 | 说明                     |
| -------------------------- | -------- | ---- | ------------------------ |
| `reaction_type`            | `object` | 是   | 表情类型对象。           |
| `reaction_type.emoji_type` | `string` | 是   | 表情标识（见下方列表）。 |

**常用 emoji_type 值**

| 类别        | 常用值                                                                                |
| ----------- | ------------------------------------------------------------------------------------- |
| 正面 / 认可 | `OK`、`THUMBSUP`、`THANKS`、`MUSCLE`、`APPLAUSE`、`FISTBUMP`、`JIAYI`、`DONE`、`LGTM` |
| 笑脸        | `SMILE`、`LAUGH`、`LOL`、`LOVE`、`WINK`、`JOYFUL`、`WOW`、`YEAH`                      |
| 悲伤        | `SOB`、`CRY`、`FROWN`、`SPEECHLESS`                                                   |
| 手势        | `ThumbsDown`、`HIGHFIVE`、`WAVE`、`SALUTE`                                            |
| 物品        | `HEART`、`ROSE`、`FIRE`、`PARTY`、`BEER`、`CAKE`、`GIFT`、`Trophy`                    |
| 符号        | `POOP`、`HEARTBROKEN`、`CheckMark`、`CrossMark`、`Hundred`                            |

完整表情列表参见飞书文档：<https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce>

**Response Body**

```json
{
  "code": 0,
  "data": {
    "reaction_id": "ZCaCIjUBVVWSrm5L-3ZTw0QhODJh4bQ2pwxPjEo6g8A",
    "operator": {
      "operator_id": "ou_7d8a6e6df7621556ce0d21922b676706ccs2",
      "operator_type": "app"
    },
    "action_time": "1710488400000",
    "reaction_type": {
      "emoji_type": "SMILE"
    }
  },
  "msg": "success"
}
```

`data` 字段说明：

| 字段                       | 类型     | 说明                          |
| -------------------------- | -------- | ----------------------------- |
| `reaction_id`              | `string` | 表情回复唯一 ID，删除时使用。 |
| `operator`                 | `object` | 操作者信息。                  |
| `operator.operator_id`     | `string` | 操作者 ID。                   |
| `operator.operator_type`   | `string` | 操作者类型：`app` 或 `user`。 |
| `action_time`              | `string` | 操作时间，毫秒时间戳。        |
| `reaction_type`            | `object` | 表情类型。                    |
| `reaction_type.emoji_type` | `string` | 表情标识。                    |

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages/om_dc13264520392913993dd051dba21dcf/reactions' \
  -X POST \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-raw '{
    "reaction_type": {
      "emoji_type": "SMILE"
    }
  }'
```

**主要错误码**

| 错误码   | 含义                   |
| -------- | ---------------------- |
| `231001` | 无效的 emoji 类型。    |
| `231002` | 无权限（不在会话中）。 |
| `231003` | 消息不存在或已被撤回。 |
| `230110` | 消息已被删除。         |

### 5.2 删除表情回复

**Method**

`DELETE`

**URL**

`/im/v1/messages/{message_id}/reactions/{reaction_id}`

**Path 参数**

| 参数          | 类型     | 必填 | 说明                                      |
| ------------- | -------- | ---- | ----------------------------------------- |
| `message_id`  | `string` | 是   | 表情所在消息的 ID。                       |
| `reaction_id` | `string` | 是   | 表情回复 ID，来自添加表情响应或列表查询。 |

**Request Body**

无。

**Response Body**

```json
{
  "code": 0,
  "data": {
    "reaction_id": "ZCaCIjUBVVWSrm5L-3ZTw0QhODJh4bQ2pwxPjEo6g8A",
    "operator": {
      "operator_id": "ou_7d8a6e6df7621556ce0d21922b676706ccs2",
      "operator_type": "app"
    },
    "action_time": "1710488400000",
    "reaction_type": {
      "emoji_type": "SMILE"
    }
  },
  "msg": "success"
}
```

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/messages/om_dc13264520392913993dd051dba21dcf/reactions/ZCaCIjUBVVWSrm5L-3ZTw0QhODJh4bQ2pwxPjEo6g8A' \
  -X DELETE \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3'
```

**主要错误码**

| 错误码   | 含义                                     |
| -------- | ---------------------------------------- |
| `231003` | 目标消息不存在或已撤回。                 |
| `231007` | 权限不足（只能删除自己添加的表情回复）。 |
| `231010` | 表情回复不属于该消息。                   |
| `231011` | 无效的 reaction_id。                     |

**工程建议**

- 只能删除自己添加的表情回复。
- 已撤回的消息无法操作表情回复。

## 6. 群组信息

### 6.1 获取群信息

**Method**

`GET`

**URL**

`/im/v1/chats/{chat_id}`

**Path 参数**

| 参数      | 类型     | 必填 | 说明      |
| --------- | -------- | ---- | --------- |
| `chat_id` | `string` | 是   | 群组 ID。 |

**Query 参数**

| 参数           | 类型     | 必填 | 说明                                                     |
| -------------- | -------- | ---- | -------------------------------------------------------- |
| `user_id_type` | `string` | 否   | 用户 ID 格式：`open_id`（默认）、`union_id`、`user_id`。 |

**Response Body**

```json
{
  "code": 0,
  "data": {
    "avatar": "https://p3-lark-file.byteimg.com/img/xxx~noop.jpg",
    "name": "测试群",
    "description": "这是一个测试群组",
    "owner_id": "ou_7d8a6e6df7621556ce0d21922b676706ccs2",
    "owner_id_type": "open_id",
    "chat_mode": "group",
    "chat_type": "private",
    "chat_tag": "inner",
    "external": false,
    "tenant_key": "736588c9260f175e",
    "user_count": "15",
    "bot_count": "2",
    "chat_status": "normal",
    "add_member_permission": "all_members",
    "share_card_permission": "allowed",
    "at_all_permission": "all_members",
    "edit_permission": "only_owner",
    "moderation_permission": "all_members",
    "group_message_type": "chat",
    "join_message_visibility": "all_members",
    "leave_message_visibility": "all_members",
    "membership_approval": "no_approval_required",
    "user_manager_id_list": [],
    "bot_manager_id_list": [],
    "restricted_mode_setting": {
      "status": false,
      "screenshot_has_permission_setting": "all_members",
      "download_has_permission_setting": "all_members",
      "message_has_permission_setting": "all_members"
    }
  },
  "msg": "success"
}
```

`data` 核心字段说明：

| 字段                    | 类型      | 说明                                                                            |
| ----------------------- | --------- | ------------------------------------------------------------------------------- |
| `avatar`                | `string`  | 群头像 URL。                                                                    |
| `name`                  | `string`  | 群名称。未设置时可能不返回。                                                    |
| `description`           | `string`  | 群描述。                                                                        |
| `owner_id`              | `string`  | 群主用户 ID。                                                                   |
| `owner_id_type`         | `string`  | 群主 ID 类型。                                                                  |
| `chat_mode`             | `string`  | 群模式：`group`（群组）、`topic`（话题）、`p2p`（单聊）。                       |
| `chat_type`             | `string`  | 群类型：`private`（私密）、`public`（公开）。                                   |
| `chat_tag`              | `string`  | 群标签：`inner`、`tenant`、`department`、`edu`、`meeting`、`customer_service`。 |
| `external`              | `boolean` | 是否为外部群。                                                                  |
| `tenant_key`            | `string`  | 租户标识。                                                                      |
| `user_count`            | `string`  | 用户数量。                                                                      |
| `bot_count`             | `string`  | 机器人数量。                                                                    |
| `chat_status`           | `string`  | 群状态：`normal`、`dissolved`、`dissolved_save`。                               |
| `add_member_permission` | `string`  | 加人权限：`only_owner` 或 `all_members`。                                       |
| `at_all_permission`     | `string`  | @所有人权限：`only_owner` 或 `all_members`。                                    |
| `moderation_permission` | `string`  | 发言权限。                                                                      |
| `group_message_type`    | `string`  | 群消息形式：`chat`（普通）或 `thread`（话题）。                                 |
| `user_manager_id_list`  | `array`   | 用户管理员 ID 列表。                                                            |
| `bot_manager_id_list`   | `array`   | 机器人管理员 ID 列表。                                                          |

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/im/v1/chats/oc_84983ff6516d731e5b5f68d4ea2e1da5' \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3'
```

**主要错误码**

| 错误码   | 含义               |
| -------- | ------------------ |
| `232006` | 无效的 chat_id。   |
| `232010` | 不同租户。         |
| `232011` | 操作者不在群组中。 |
| `232025` | 未启用机器人能力。 |

**工程建议**

- 调用者必须是群成员才能获取完整信息；否则只返回名称、头像、成员数量和状态。
- 内部群要求同一租户才能访问。

## 7. 用户信息

### 7.1 获取单个用户信息

**Method**

`GET`

**URL**

`/contact/v3/users/{user_id}`

**Path 参数**

| 参数      | 类型     | 必填 | 说明                                      |
| --------- | -------- | ---- | ----------------------------------------- |
| `user_id` | `string` | 是   | 用户 ID，类型由 `user_id_type` 参数决定。 |

**Query 参数**

| 参数                 | 类型     | 必填 | 说明                                                          |
| -------------------- | -------- | ---- | ------------------------------------------------------------- |
| `user_id_type`       | `string` | 否   | 用户 ID 格式：`open_id`（默认）、`union_id`、`user_id`。      |
| `department_id_type` | `string` | 否   | 部门 ID 格式：`open_department_id`（默认）、`department_id`。 |

**Response Body**

```json
{
  "code": 0,
  "data": {
    "user": {
      "union_id": "on_94a1ee5551019f18cd73d9f111898cf8",
      "user_id": "3e3cf3ea",
      "open_id": "ou_7d8a6e6df7621556ce0d21922b676706ccs2",
      "name": "张三",
      "en_name": "Zhang San",
      "nickname": "三哥",
      "email": "zhangsan@example.com",
      "mobile": "+8613800138000",
      "gender": 1,
      "avatar": {
        "avatar_72": "https://p3-lark-file.byteimg.com/img/xxx~72x72.jpg",
        "avatar_240": "https://p3-lark-file.byteimg.com/img/xxx~240x240.jpg",
        "avatar_640": "https://p3-lark-file.byteimg.com/img/xxx~640x640.jpg",
        "avatar_origin": "https://p3-lark-file.byteimg.com/img/xxx~noop.jpg"
      },
      "status": {
        "is_frozen": false,
        "is_resigned": false,
        "is_activated": true,
        "is_exited": false,
        "is_unjoin": false
      },
      "department_ids": ["od-4e6ac4d14bcd5071a37a39de902c7141"],
      "leader_user_id": "ou_xxx",
      "city": "北京",
      "country": "CN",
      "work_station": "A1-101",
      "join_time": 1710288000,
      "is_tenant_manager": false,
      "employee_no": "10001",
      "employee_type": 1,
      "enterprise_email": "zhangsan@company.com",
      "job_title": "工程师"
    }
  },
  "msg": "success"
}
```

`data.user` 核心字段说明：

| 字段             | 类型     | 说明                                                         |
| ---------------- | -------- | ------------------------------------------------------------ |
| `union_id`       | `string` | 用户 union_id（跨应用唯一）。                                |
| `user_id`        | `string` | 用户 user_id（企业内唯一，即员工工号 ID）。                  |
| `open_id`        | `string` | 用户 open_id（应用内唯一）。                                 |
| `name`           | `string` | 用户姓名。                                                   |
| `en_name`        | `string` | 英文名。                                                     |
| `nickname`       | `string` | 别名。                                                       |
| `email`          | `string` | 邮箱。                                                       |
| `mobile`         | `string` | 手机号。                                                     |
| `gender`         | `int`    | 性别：`0` 未知、`1` 男、`2` 女、`3` 其他。                   |
| `avatar`         | `object` | 头像 URL 集合（72px、240px、640px、原图）。                  |
| `status`         | `object` | 用户状态（冻结、离职、激活、退出、未加入）。                 |
| `department_ids` | `array`  | 所属部门 ID 列表。                                           |
| `leader_user_id` | `string` | 直属主管 ID。                                                |
| `city`           | `string` | 城市。                                                       |
| `country`        | `string` | 国家 / 地区代码。                                            |
| `join_time`      | `int`    | 入职时间，Unix 时间戳（秒）。                                |
| `employee_no`    | `string` | 工号。                                                       |
| `employee_type`  | `int`    | 员工类型：`1` 正式、`2` 实习、`3` 外包、`4` 劳务、`5` 顾问。 |
| `job_title`      | `string` | 职务。                                                       |

**curl 示例**

```bash
curl 'https://open.feishu.cn/open-apis/contact/v3/users/ou_7d8a6e6df7621556ce0d21922b676706ccs2?user_id_type=open_id' \
  -H 'Authorization: Bearer t-caecc734c2e3328a62489fe0648c4b98779515d3'
```

**主要错误码**

| 错误码  | 含义                     |
| ------- | ------------------------ |
| `40001` | 参数校验失败。           |
| `41012` | 无效的用户 ID 格式。     |
| `41050` | 用户不在应用可用范围内。 |

**工程建议**

- 使用 `tenant_access_token` 调用时不返回部门路径字段；需要部门路径时使用 `user_access_token`。
- 字段可见性取决于应用被授予的权限范围；敏感字段（手机号、邮箱等）需要特定权限。
- 当前 `LarkApiClient` 实现会根据 ID 前缀自动判断 `user_id_type`：`ou_` → `open_id`，`on_` → `union_id`，其他 → `user_id`。
- 优先取 `name`，回退到 `display_name` → `nickname` → `en_name`。

## 8. 消息内容格式

### 8.1 文本消息（text）

```json
{
  "text": "你好，这是一条测试消息"
}
```

| 字段   | 类型     | 说明       |
| ------ | -------- | ---------- |
| `text` | `string` | 文本内容。 |

特殊语法：

- @ 用户：`<at user_id="ou_xxx">用户名</at>`
- @ 所有人：`<at user_id="all">所有人</at>`

### 8.2 富文本消息（post）

```json
{
  "zh_cn": {
    "title": "标题",
    "content": [
      [
        { "tag": "text", "text": "正文内容" },
        { "tag": "a", "text": "链接文本", "href": "https://example.com" },
        { "tag": "at", "user_id": "ou_xxx", "user_name": "张三" }
      ]
    ]
  }
}
```

### 8.3 其他消息类型

| msg_type      | content 字段                                    | 说明                         |
| ------------- | ----------------------------------------------- | ---------------------------- |
| `image`       | `{"image_key":"img_xxx"}`                       | 需先上传图片获取 image_key。 |
| `file`        | `{"file_key":"file_xxx"}`                       | 需先上传文件获取 file_key。  |
| `audio`       | `{"file_key":"file_xxx"}`                       | 需先上传音频获取 file_key。  |
| `media`       | `{"file_key":"file_xxx","image_key":"img_xxx"}` | 视频，需上传视频和封面。     |
| `sticker`     | `{"file_key":"file_xxx"}`                       | 表情包。                     |
| `interactive` | `{...card_content...}`                          | 消息卡片 JSON。              |
| `share_chat`  | `{"chat_id":"oc_xxx"}`                          | 分享群组。                   |
| `share_user`  | `{"user_id":"ou_xxx"}`                          | 分享用户名片。               |

**工程建议**

- 所有 `content` 值在传入 API 前必须做 `JSON.stringify()`。
- 文本消息 `content` 最大 150 KB。
- 卡片和富文本 `content` 最大 30 KB。
- 当前 `LarkApiClient` 实现中仅使用 `text` 类型，且在客户端做了 4000 字符截断保护。

## 9. 通用错误码速查

| 错误码   | 含义                               |
| -------- | ---------------------------------- |
| `0`      | 成功。                             |
| `230001` | 请求参数无效。                     |
| `230002` | 机器人不在群组中。                 |
| `230006` | 未启用机器人能力。                 |
| `230009` | 消息超过撤回时间限制。             |
| `230013` | 用户不在应用可用范围内。           |
| `230020` | 触发频率限制。                     |
| `230025` | 消息体超出长度限制。               |
| `230026` | 无撤回权限。                       |
| `230027` | 权限不足。                         |
| `230054` | 不支持的消息类型。                 |
| `230071` | 操作者不是消息发送者。             |
| `230072` | 消息已达编辑上限（20 次）。        |
| `230073` | 话题对操作者不可见。               |
| `230075` | 消息超出可编辑时间窗口。           |
| `230099` | 卡片内容创建失败。                 |
| `230110` | 消息已被删除。                     |
| `231001` | 无效的 emoji 类型。                |
| `231002` | 无表情回复权限（不在会话中）。     |
| `231003` | 消息不存在或已被撤回。             |
| `231007` | 只能删除自己添加的表情回复。       |
| `231010` | 表情回复不属于该消息。             |
| `231011` | 无效的 reaction_id。               |
| `232006` | 无效的 chat_id。                   |
| `232010` | 不同租户。                         |
| `232011` | 操作者不在群组中。                 |
| `232025` | 未启用机器人能力。                 |
| `40001`  | 参数校验失败（通讯录）。           |
| `41012`  | 无效的用户 ID 格式（通讯录）。     |
| `41050`  | 用户不在应用可用范围内（通讯录）。 |

## 10. 工程实践摘要

### 10.1 Token 管理

- 缓存 `tenant_access_token`，在过期前 5 分钟刷新。
- 不要在每次请求前都调用认证接口。
- `app_secret` 存入环境变量或密钥管理服务，不要硬编码。

### 10.2 消息发送

- `content` 字段必须是 `JSON.stringify()` 后的字符串。
- 文本消息客户端建议截断到 4000 字符（保守策略）。
- 使用 `uuid` 实现幂等发送，防止网络重试导致重复消息。
- 同用户 / 同群组 5 QPS 限流，高并发场景需做令牌桶 / 漏桶。

### 10.3 消息编辑

- 仅支持 `text` 和 `post` 类型。
- 每条消息最多编辑 20 次。
- 仅发送者可编辑自己的消息。

### 10.4 消息撤回

- 仅能撤回自己发送的消息（群主例外）。
- 受管理员配置的时间限制约束。

### 10.5 分页查询

- `page_size` 范围 1–50，默认 20。
- 分页标记 `page_token` 不是可读偏移量，应当 opaque 处理。
- `sort_type` 在同一次分页遍历中必须保持一致。
- `start_time` / `end_time` 使用秒级 Unix 时间戳，不是毫秒。

### 10.6 飞书 vs Lark

- 飞书（中国区）和 Lark（国际区）API 路径完全一致，只是基座地址不同。
- 当前 `LarkApiClient` 通过构造参数 `platform` 切换基座地址，默认为 `lark`。
- 部署时根据目标用户群体选择合适的基座地址。

### 10.7 错误处理

- 所有 API 响应的 `code` 字段为 `0` 表示成功，非 `0` 表示失败。
- HTTP 状态码非 2xx 时应当直接抛出异常。
- `code` 非 `0` 时应读取 `msg` 字段获取错误描述。
- 频率限制错误（`230020`）应做退避重试。

## 11. 实测验证记录

> 本节记录 message tool 服务适配器（`FeishuMessageService`）与飞书开放平台 API 的对接验证情况。

### 11.1 验证方式

飞书 API 通过代码审查与官方文档对照进行验证，确认各接口的请求 / 响应格式与官方规范一致。

### 11.2 关键 Bug 修复

| Bug                     | 说明                                                                                                                            | 修复方式                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `create_time` 毫秒处理  | 原实现将飞书返回的毫秒时间戳（如 `"1710488400000"`）再乘以 1000 转换为 `Date`，导致时间戳偏差约 1000 倍（日期跑到遥远的未来）。 | 直接使用 `new Date(Number(create_time))`，不再乘以 1000。            |
| `readMessages` 分页支持 | 补充了 `start_time` / `end_time` 时间范围过滤和 `page_size` 分页参数的正确映射。                                                | `after` → `startTime`，`before` → `endTime`，`limit` → `page_size`。 |

### 11.3 服务适配器操作支持情况

服务适配器支持 **9 / 17** 项 message tool 操作：

| 操作                | 支持 | 映射的飞书 API                                            |
| ------------------- | ---- | --------------------------------------------------------- |
| `sendMessage`       | Yes  | `POST /im/v1/messages`                                    |
| `readMessages`      | Yes  | `GET /im/v1/messages`（会话历史）                         |
| `editMessage`       | Yes  | `PUT /im/v1/messages/{message_id}`                        |
| `deleteMessage`     | Yes  | `DELETE /im/v1/messages/{message_id}`                     |
| `reactToMessage`    | Yes  | `POST /im/v1/messages/{message_id}/reactions`             |
| `getChannelInfo`    | Yes  | `GET /im/v1/chats/{chat_id}`（getChatInfo）               |
| `getMemberInfo`     | Yes  | `GET /contact/v3/users/{user_id}`（getUserInfo）          |
| `replyToThread`     | Yes  | `POST /im/v1/messages/{message_id}/reply`（replyMessage） |
| `searchMessages`    | No   | 飞书无全文搜索 API                                        |
| `getReactions`      | No   | 未实现                                                    |
| `pinMessage`        | No   | 未实现                                                    |
| `unpinMessage`      | No   | 未实现                                                    |
| `getPinnedMessages` | No   | 未实现                                                    |
| `listChannels`      | No   | 未实现                                                    |
| `createThread`      | No   | 未实现                                                    |
| `listThreads`       | No   | 未实现                                                    |
| `createPoll`        | No   | 飞书无投票 API                                            |
