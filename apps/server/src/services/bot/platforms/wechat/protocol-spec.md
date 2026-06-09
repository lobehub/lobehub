# 微信 iLink Bot API 通信协议规范

> 适用对象：实现微信 iLink Bot / ClawBot 协议的 SDK、网关和独立 Bot。
>
> 整理依据：仓库根目录 `PROTOCOL.md`、腾讯官方 `@tencent-weixin/openclaw-weixin` v1.0.2 源码、`m1heng/claude-plugin-weixin`、`hao-ji-xing/openclaw-weixin` 示例实现。
>
> 说明：文中标注 “工程建议” 的内容来自现有客户端实现经验，用于提高兼容性；它们不是服务端返回字段本身的一部分。

## 1. 概述

微信 iLink Bot API 是腾讯微信 ClawBot 功能背后的 HTTP/JSON 协议。主业务基座地址是 `https://ilinkai.weixin.qq.com`，媒体 CDN 基座地址是 `https://novac2c.cdn.weixin.qq.com/c2c`。协议核心特征有三点：一是登录依赖二维码扫码确认；二是消息接收使用 `getupdates` 长轮询，不是 WebSocket，也不是双工流；三是每条会话消息都绑定 `context_token`，发送回复时必须回传该 token，才能把消息投递到正确的微信对话窗口。

## 2. 认证流程

### 2.1 获取二维码

**Method**

`GET`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3`

**Headers**

| Header       | 是否必需 | 说明                                 |
| ------------ | -------- | ------------------------------------ |
| `SKRouteTag` | 否       | 可选路由标签；仅在部署方要求时带上。 |

**Body**

无。

**Response**

```json
{
  "qrcode": "qrc_8f4b7b1d2cf74e98baf50a5d0cc4b4b7",
  "qrcode_img_content": "https://weixin.qq.com/x/cAbCdEfGhIj"
}
```

字段说明：

| 字段                 | 类型     | 说明                                           |
| -------------------- | -------- | ---------------------------------------------- |
| `qrcode`             | `string` | 二维码轮询令牌，后续传给 `get_qrcode_status`。 |
| `qrcode_img_content` | `string` | 可直接渲染为二维码的 URL。                     |

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3' \
  -H 'SKRouteTag: 1001'
```

### 2.2 轮询扫码状态

**Method**

`GET`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qrc_8f4b7b1d2cf74e98baf50a5d0cc4b4b7`

**Headers**

| Header                    | 是否必需 | 说明                 |
| ------------------------- | -------- | -------------------- |
| `iLink-App-ClientVersion` | 是       | 现有实现固定传 `1`。 |
| `SKRouteTag`              | 否       | 可选路由标签。       |

**Body**

无。

**Response 状态机**

| `status`    | 含义                                                  | 下一步                                   |
| ----------- | ----------------------------------------------------- | ---------------------------------------- |
| `wait`      | 未扫码，或本次长轮询在客户端超时后被视为 “继续等待”。 | 继续轮询。                               |
| `scaned`    | 已扫码，等待手机端确认。                              | 继续轮询。                               |
| `confirmed` | 用户已确认，返回正式凭证。                            | 持久化凭证，进入业务阶段。               |
| `expired`   | 当前二维码过期。                                      | 重新调用 `get_bot_qrcode` 获取新二维码。 |

**Response 示例**

```json
{
  "status": "wait"
}
```

```json
{
  "status": "scaned"
}
```

```json
{
  "baseurl": "https://ilinkai.weixin.qq.com",
  "bot_token": "ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r",
  "ilink_bot_id": "e06c1ceea05e@im.bot",
  "ilink_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
  "status": "confirmed"
}
```

```json
{
  "status": "expired"
}
```

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qrc_8f4b7b1d2cf74e98baf50a5d0cc4b4b7' \
  -H 'iLink-App-ClientVersion: 1' \
  -H 'SKRouteTag: 1001'
```

**长轮询行为**

- 现有实现通常把客户端超时设置为 35 秒左右。
- 若客户端本地超时并抛出 `AbortError`，多数实现会把这次轮询等价处理为 `{"status":"wait"}`，然后继续轮询。
- 二维码自身有效期并未通过独立字段下发；通常在拿到 `expired` 后重新申请二维码即可。

### 2.3 返回凭证与存储建议

`confirmed` 响应会返回以下关键凭证：

| 字段            | 说明                                                            |
| --------------- | --------------------------------------------------------------- |
| `bot_token`     | 后续所有业务 POST 请求的 Bearer Token。                         |
| `ilink_bot_id`  | Bot 账号 ID，格式通常为 `...@im.bot`。                          |
| `ilink_user_id` | 完成扫码授权的微信用户 ID，格式通常为 `...@im.wechat`。         |
| `baseurl`       | 业务 API 基座地址；若返回值与默认地址不同，应以后端返回值为准。 |

**推荐存储格式**

```json
{
  "accountId": "e06c1ceea05e@im.bot",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "savedAt": "2026-03-22T04:25:12.345Z",
  "token": "ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r",
  "userId": "o9cq800kum_4g8Py8Qw5G0a@im.wechat"
}
```

**工程建议**

- 凭证文件权限设为 `0600`。
- 将 `bot_token` 与 `baseurl` 一并持久化，避免重启后误用旧基座地址。
- 为每个 `ilink_bot_id` 单独存储凭证和游标，不要多账号共用同一状态文件。

## 3. 公共请求规范

### 3.1 通用请求头

以下规范适用于所有业务 `POST` 请求，也就是 `getupdates`、`sendmessage`、`getuploadurl`、`getconfig`、`sendtyping`。

| Header              | 示例值                                     | 是否必需 | 说明                                                        |
| ------------------- | ------------------------------------------ | -------- | ----------------------------------------------------------- |
| `Content-Type`      | `application/json`                         | 是       | 所有业务接口都发 JSON。                                     |
| `AuthorizationType` | `ilink_bot_token`                          | 是       | 固定值。                                                    |
| `Authorization`     | `Bearer ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r` | 是       | 二维码登录返回的 `bot_token`。                              |
| `X-WECHAT-UIN`      | `MzA1NDE5ODk2`                             | 是       | 随机 `uint32` 的十进制字符串再做 base64。每次请求重新生成。 |
| `Content-Length`    | `187`                                      | 是       | JSON body 的 UTF-8 字节长度。                               |
| `SKRouteTag`        | `1001`                                     | 否       | 部署方自定义路由标签。GET 登录接口通常也会带它。            |

说明：下文的 `curl` 示例里通常不手写 `Content-Length`，因为 `curl` 会自动计算；自研 SDK 直接发 HTTP 时必须自己保证该值正确。

### 3.2 `base_info` 结构

所有业务 POST body 都需要携带 `base_info`。

```json
{
  "base_info": {
    "channel_version": "1.0.0"
  }
}
```

字段说明：

| 字段              | 类型     | 说明                                                                |
| ----------------- | -------- | ------------------------------------------------------------------- |
| `channel_version` | `string` | 客户端 / SDK 版本号。现有实现里常见值有 `0.1.0`、`1.0.0`、`1.0.2`。 |

**工程建议**

- 把 `channel_version` 设为实际 SDK 版本号，便于排查兼容问题。
- 不要省略 `base_info`，即使当前只包含一个字段。

### 3.3 `X-WECHAT-UIN` 生成算法

算法是：随机生成一个 `uint32`，转成十进制字符串，再做 base64。

示例：

```text
uint32   = 305419896
decimal  = "305419896"
base64   = "MzA1NDE5ODk2"
```

JavaScript 示例：

```ts
import crypto from 'node:crypto';

function randomWechatUin(): string {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf8').toString('base64');
}
```

## 4. 消息接收（`getupdates`）

### 4.1 接口定义

**Method**

`POST`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/getupdates`

**Headers**

使用第 3 节的通用业务请求头。

**Request Body**

```json
{
  "base_info": {
    "channel_version": "1.0.0"
  },
  "get_updates_buf": "eyJhY2NvdW50IjoiZTA2YzFjZWVhMDVlQGltLmJvdCIsInNlcSI6NDI4fQ=="
}
```

字段说明：

| 字段              | 类型     | 说明                                  |
| ----------------- | -------- | ------------------------------------- |
| `get_updates_buf` | `string` | 长轮询游标；首次请求传空字符串 `""`。 |
| `base_info`       | `object` | 见第 3.2 节。                         |
| `sync_buf`        | `string` | 已废弃兼容字段；新实现忽略即可。      |

**Response Body**

```json
{
  "get_updates_buf": "eyJhY2NvdW50IjoiZTA2YzFjZWVhMDVlQGltLmJvdCIsInNlcSI6NDI5fQ==",
  "longpolling_timeout_ms": 35000,
  "msgs": [
    {
      "seq": 429,
      "message_id": 9812451782375,
      "from_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
      "to_user_id": "e06c1ceea05e@im.bot",
      "client_id": "wx-msg-1774158905123-9d7c5e21",
      "create_time_ms": 1774158905123,
      "update_time_ms": 1774158905123,
      "session_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat#e06c1ceea05e@im.bot",
      "message_type": 1,
      "message_state": 2,
      "context_token": "AARzJWAFAAABAAAAAAAp2m3u7oE0x7V8Xw==",
      "item_list": [
        {
          "type": 1,
          "text_item": {
            "text": "帮我总结一下今天的会议纪要。"
          }
        }
      ]
    }
  ],
  "ret": 0
}
```

**错误响应示例**

```json
{
  "errcode": -14,
  "errmsg": "session timeout",
  "ret": -14
}
```

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/getupdates' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r' \
  -H 'X-WECHAT-UIN: MzA1NDE5ODk2' \
  -H 'SKRouteTag: 1001' \
  --data-raw '{
    "get_updates_buf": "eyJhY2NvdW50IjoiZTA2YzFjZWVhMDVlQGltLmJvdCIsInNlcSI6NDI4fQ==",
    "base_info": {
      "channel_version": "1.0.0"
    }
  }'
```

### 4.2 Long-poll 机制

- `getupdates` 是标准长轮询接口。服务端会把连接挂起，直到有新消息，或达到服务端超时。
- 现有实现观测到的默认长轮询窗口约为 35 秒。
- 若响应里带 `longpolling_timeout_ms`，下次轮询应优先使用该值作为客户端超时配置。
- 客户端本地超时不等于服务端报错；常见做法是把这次请求当作 “空轮询成功”，立刻发下一轮。

### 4.3 `get_updates_buf` 游标管理

`get_updates_buf` 不是可读 offset，而是一段不透明上下文缓冲区；应把它当 opaque blob 原样缓存。

**工程建议**

- 首次请求传空字符串 `""`。
- 每次拿到新的非空 `get_updates_buf` 都立刻持久化。
- 以 bot 账号为粒度持久化，不要多账号共用同一游标。
- Bot token 改变、扫码重登、收到 `-14` 会话过期时，应清空本地游标。
- 不要尝试 base64 解码并修改内容；格式没有对外保证。

推荐持久化格式：

```json
{
  "get_updates_buf": "eyJhY2NvdW50IjoiZTA2YzFjZWVhMDVlQGltLmJvdCIsInNlcSI6NDI5fQ=="
}
```

### 4.4 错误处理与重连策略

**协议层规则**

- `ret = 0` 表示业务成功。
- `ret != 0` 或 `errcode != 0` 都应视为失败。
- `errcode = -14` 或 `ret = -14` 表示 session expired，需要重新登录。

**工程建议**

- 普通失败：先等待 2 秒再重试。
- 连续 3 次失败：退避 30 秒。
- `-14`：立即停止当前账号的上下行请求，清除本地凭证和游标，重新走二维码登录。
- 更保守的实现可以在 `-14` 后对该账号静默一段时间，避免对已过期 session 持续打流量；官方 openclaw 实现选择暂停 1 小时。

## 5. 消息数据结构

### 5.1 `WeixinMessage`

ID 形态通常符合以下规律：

- 用户 ID：`...@im.wechat`
- Bot ID：`...@im.bot`

字段定义：

| 字段             | 类型             | 说明                                                  |
| ---------------- | ---------------- | ----------------------------------------------------- |
| `seq`            | `number?`        | 消息序列号；可用于调试顺序。                          |
| `message_id`     | `number?`        | 服务端消息 ID。                                       |
| `from_user_id`   | `string?`        | 发送者 ID。                                           |
| `to_user_id`     | `string?`        | 接收者 ID。                                           |
| `client_id`      | `string?`        | 客户端生成的消息 ID；出站消息通常由发送方填入。       |
| `create_time_ms` | `number?`        | 创建时间，毫秒时间戳。                                |
| `update_time_ms` | `number?`        | 最近更新时间，毫秒时间戳。                            |
| `delete_time_ms` | `number?`        | 删除时间，毫秒时间戳。                                |
| `session_id`     | `string?`        | 会话 ID。                                             |
| `group_id`       | `string?`        | 群会话 ID；协议字段存在，但公开实现目前主要处理单聊。 |
| `message_type`   | `number?`        | `1 = USER`，`2 = BOT`。                               |
| `message_state`  | `number?`        | `0 = NEW`，`1 = GENERATING`，`2 = FINISH`。           |
| `item_list`      | `MessageItem[]?` | 消息内容数组。                                        |
| `context_token`  | `string?`        | 会话上下文令牌；回复时必须回传。                      |

### 5.2 `MessageItem`

| 字段             | 类型          | 说明                                                            |
| ---------------- | ------------- | --------------------------------------------------------------- |
| `type`           | `number?`     | `1 = TEXT`，`2 = IMAGE`，`3 = VOICE`，`4 = FILE`，`5 = VIDEO`。 |
| `create_time_ms` | `number?`     | item 创建时间。                                                 |
| `update_time_ms` | `number?`     | item 更新时间。                                                 |
| `is_completed`   | `boolean?`    | item 是否完成。                                                 |
| `msg_id`         | `string?`     | item 级别消息 ID。                                              |
| `ref_msg`        | `RefMessage?` | 引用消息。                                                      |
| `text_item`      | `TextItem?`   | 文本子结构。                                                    |
| `image_item`     | `ImageItem?`  | 图片子结构。                                                    |
| `voice_item`     | `VoiceItem?`  | 语音子结构。                                                    |
| `file_item`      | `FileItem?`   | 文件子结构。                                                    |
| `video_item`     | `VideoItem?`  | 视频子结构。                                                    |

通常一个 `MessageItem` 只会命中与其 `type` 对应的那个子结构。

### 5.3 `CDNMedia`

`CDNMedia` 是图片、语音、文件、视频都共用的 CDN 引用结构。

| 字段                  | 类型      | 说明                                                    |
| --------------------- | --------- | ------------------------------------------------------- |
| `encrypt_query_param` | `string?` | CDN 下载所需的加密查询参数。                            |
| `aes_key`             | `string?` | base64 编码的 AES key；具体编码形式见第 8.4 节。        |
| `encrypt_type`        | `number?` | `0 = 只加密 file id`，`1 = 打包缩略图/中图等附加信息`。 |

示例：

```json
{
  "aes_key": "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
  "encrypt_query_param": "AAFFc8c2PXQ5mKPw7rbcH7S1EA=",
  "encrypt_type": 1
}
```

### 5.4 TEXT

结构最简单：

| 字段   | 类型      | 说明       |
| ------ | --------- | ---------- |
| `text` | `string?` | 文本正文。 |

示例：

```json
{
  "text_item": {
    "text": "会议纪要已整理完毕，共 3 个行动项。"
  },
  "type": 1
}
```

### 5.5 IMAGE

| 字段           | 类型        | 说明                                                                                |
| -------------- | ----------- | ----------------------------------------------------------------------------------- |
| `media`        | `CDNMedia?` | 原图 / 主图引用。                                                                   |
| `thumb_media`  | `CDNMedia?` | 缩略图引用。                                                                        |
| `aeskey`       | `string?`   | 16 字节 AES key 的 hex 字符串，共 32 个十六进制字符；某些入站图片会直接给这个字段。 |
| `url`          | `string?`   | 某些客户端会填预览 URL。                                                            |
| `mid_size`     | `number?`   | 中图或主图密文大小。公开发送实现通常把它填成上传后密文长度。                        |
| `thumb_size`   | `number?`   | 缩略图密文大小。                                                                    |
| `thumb_height` | `number?`   | 缩略图高度，像素。                                                                  |
| `thumb_width`  | `number?`   | 缩略图宽度，像素。                                                                  |
| `hd_size`      | `number?`   | 高清图密文大小。                                                                    |

示例：

```json
{
  "image_item": {
    "media": {
      "encrypt_query_param": "AAFFc8c2PXQ5mKPw7rbcH7S1EA=",
      "aes_key": "ABEiM0RVZneImaq7zN3u/w==",
      "encrypt_type": 1
    },
    "thumb_media": {
      "encrypt_query_param": "AAHf7b8e3krX5cY7nqB0F0kM1A=",
      "aes_key": "ABEiM0RVZneImaq7zN3u/w==",
      "encrypt_type": 1
    },
    "aeskey": "00112233445566778899aabbccddeeff",
    "mid_size": 248736,
    "thumb_size": 18224,
    "thumb_width": 360,
    "thumb_height": 240,
    "hd_size": 248736
  },
  "type": 2
}
```

### 5.6 VOICE

| 字段              | 类型        | 说明                                                                                                              |
| ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `media`           | `CDNMedia?` | 语音 CDN 引用。                                                                                                   |
| `encode_type`     | `number?`   | 语音编码：`1 = pcm`，`2 = adpcm`，`3 = feature`，`4 = speex`，`5 = amr`，`6 = silk`，`7 = mp3`，`8 = ogg-speex`。 |
| `bits_per_sample` | `number?`   | 位深。                                                                                                            |
| `sample_rate`     | `number?`   | 采样率，Hz。                                                                                                      |
| `playtime`        | `number?`   | 播放时长，毫秒。                                                                                                  |
| `text`            | `string?`   | 语音转文字结果。                                                                                                  |

示例：

```json
{
  "type": 3,
  "voice_item": {
    "media": {
      "encrypt_query_param": "AAK2xQ8gqV9h5EmYxM2u3r7Q2A=",
      "aes_key": "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
      "encrypt_type": 1
    },
    "encode_type": 6,
    "bits_per_sample": 16,
    "sample_rate": 24000,
    "playtime": 4210,
    "text": "我下午三点到。"
  }
}
```

### 5.7 FILE

| 字段        | 类型        | 说明                       |
| ----------- | ----------- | -------------------------- |
| `media`     | `CDNMedia?` | 文件 CDN 引用。            |
| `file_name` | `string?`   | 文件名。                   |
| `md5`       | `string?`   | 文件 MD5。                 |
| `len`       | `string?`   | 明文文件大小，字符串形式。 |

示例：

```json
{
  "file_item": {
    "media": {
      "encrypt_query_param": "AALk1J1Rljnmdk6PMx1PZ0h4mA=",
      "aes_key": "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
      "encrypt_type": 1
    },
    "file_name": "报价单-2026Q1.pdf",
    "md5": "9d2a7b9c3e2f1d41c7d5b3a1a7e1c6f0",
    "len": "542188"
  },
  "type": 4
}
```

### 5.8 VIDEO

| 字段           | 类型        | 说明                  |
| -------------- | ----------- | --------------------- |
| `media`        | `CDNMedia?` | 视频主文件 CDN 引用。 |
| `video_size`   | `number?`   | 视频密文大小。        |
| `play_length`  | `number?`   | 视频时长，毫秒。      |
| `video_md5`    | `string?`   | 视频文件 MD5。        |
| `thumb_media`  | `CDNMedia?` | 视频缩略图引用。      |
| `thumb_size`   | `number?`   | 视频缩略图密文大小。  |
| `thumb_height` | `number?`   | 缩略图高度，像素。    |
| `thumb_width`  | `number?`   | 缩略图宽度，像素。    |

示例：

```json
{
  "type": 5,
  "video_item": {
    "media": {
      "encrypt_query_param": "AAOtQ1BTT3pQ6H3ak1O8P2aR1A=",
      "aes_key": "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
      "encrypt_type": 1
    },
    "video_size": 10485776,
    "play_length": 18320,
    "video_md5": "8e7f6a5b4c3d2e1f0011223344556677",
    "thumb_media": {
      "encrypt_query_param": "AAJtQ4YTW2Z0sY5YwL2g0hTzTA=",
      "aes_key": "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
      "encrypt_type": 1
    },
    "thumb_size": 23696,
    "thumb_width": 320,
    "thumb_height": 180
  }
}
```

### 5.9 `RefMessage`

`ref_msg` 用于引用消息。结构如下：

| 字段           | 类型           | 说明                |
| -------------- | -------------- | ------------------- |
| `title`        | `string?`      | 引用摘要。          |
| `message_item` | `MessageItem?` | 被引用的具体 item。 |

示例：

```json
{
  "ref_msg": {
    "title": "引用了一条消息",
    "message_item": {
      "type": 1,
      "text_item": {
        "text": "会议纪要初稿已完成。"
      }
    }
  },
  "text_item": {
    "text": "请继续补充这一条。"
  },
  "type": 1
}
```

### 5.10 `context_token` 的作用和生命周期

`context_token` 是微信 iLink 协议最关键的字段。它的语义不是 “用户 ID”，而是 “当前对话上下文的会话能力令牌”。

**已确认行为**

- 入站 `WeixinMessage` 会带 `context_token`。
- 出站 `sendmessage` 时，公开实现都会把入站消息里的 `context_token` 原样回传。
- 缺失 `context_token` 时，公开实现通常直接拒绝发送，或发送后无法正确关联会话。

**工程建议**

- 以 `(accountId, userId)` 为 key 缓存最近一次 `context_token`。
- 不要跨用户、跨 bot 账号复用 token。
- 不要伪造 token。
- 进程重启后若没有恢复上下文，主动消息发送能力通常也会丢失；协议里未观察到单独 “打开会话” 的 API。

## 6. 消息发送（`sendmessage`）

### 6.1 接口定义

**Method**

`POST`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/sendmessage`

**Headers**

使用第 3 节的通用业务请求头。

**Request Body**

```json
{
  "base_info": {
    "channel_version": "1.0.0"
  },
  "msg": {
    "from_user_id": "",
    "to_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
    "client_id": "pinix-weixin:1774158910456-a1b2c3d4",
    "message_type": 2,
    "message_state": 2,
    "context_token": "AARzJWAFAAABAAAAAAAp2m3u7oE0x7V8Xw==",
    "item_list": [
      {
        "type": 1,
        "text_item": {
          "text": "会议纪要已整理完毕，共 3 个行动项。"
        }
      }
    ]
  }
}
```

**Response Body**

官方类型把 `SendMessageResp` 定义为空结构，因此通常只以 HTTP 200 作为成功判定。可把成功响应视为：

```json
{}
```

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r' \
  -H 'X-WECHAT-UIN: MzA1NDE5ODk2' \
  -H 'SKRouteTag: 1001' \
  --data-raw '{
    "msg": {
      "from_user_id": "",
      "to_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
      "client_id": "pinix-weixin:1774158910456-a1b2c3d4",
      "message_type": 2,
      "message_state": 2,
      "context_token": "AARzJWAFAAABAAAAAAAp2m3u7oE0x7V8Xw==",
      "item_list": [
        {
          "type": 1,
          "text_item": {
            "text": "会议纪要已整理完毕，共 3 个行动项。"
          }
        }
      ]
    },
    "base_info": {
      "channel_version": "1.0.0"
    }
  }'
```

### 6.2 `message_type`

| 值  | 含义   | 使用建议               |
| --- | ------ | ---------------------- |
| `1` | `USER` | 入站消息使用。         |
| `2` | `BOT`  | 机器人发出的消息使用。 |

出站调用 `sendmessage` 时应固定写 `2`。

### 6.3 `message_state`

| 值  | 含义         | 说明               |
| --- | ------------ | ------------------ |
| `0` | `NEW`        | 新消息或起始状态。 |
| `1` | `GENERATING` | 生成中。           |
| `2` | `FINISH`     | 完成态。           |

**已确认行为**

- 公开实现目前都稳定使用 `FINISH = 2`。

**实测结论（2026-03-22）**

使用同一 `client_id` 发送 `GENERATING → GENERATING → FINISH` 三条消息，API 层面均返回 200，但微信客户端仅显示第一条 `GENERATING` 的内容，后续的 `GENERATING` 和 `FINISH` 更新未在聊天气泡中渲染。对照组使用不同 `client_id` 各发一条 `FINISH`，三条消息均独立显示。

补充测试：`GENERATING` 空 `item_list` 时服务端返回 `ret: -2`（参数错误）；`GENERATING` 带文本时正常投递为一条消息，但**不会**触发微信端的 "对方正在输入中" 提示。作为对照，`sendtyping` API **可以**触发 "对方正在输入中"。

推测 `GENERATING` 可能仅在微信内置 AI 对话界面（非普通 bot 会话窗口）中支持气泡实时更新。官方 openclaw-weixin 插件代码中也完全不使用 `GENERATING`，所有发送均为 `FINISH`。

**工程建议**

- 稳定投递：直接使用 `FINISH = 2`。
- 模拟流式效果：用不同 `client_id` 发送多条独立 `FINISH` 消息。
- 显示” 正在输入”：使用 `sendtyping` API（见第 7 章），而非 `GENERATING` 状态。
- `GENERATING = 1`：协议预留能力，当前在普通 bot 对话中不可用，不建议依赖。

### 6.4 `context_token` 的必要性

对微信 iLink 来说，`context_token` 不是可选增强字段，而是会话路由锚点。只知道 `to_user_id` 不足以安全回复当前会话。

实践上应把它视为必填项：

- 文本回复：必填。
- 图片 / 文件 / 视频回复：必填。
- typing 状态：虽然 `sendtyping` 本身不直接带 `context_token`，但 `getconfig` 获取 `typing_ticket` 时通常会带上它。

### 6.5 长消息分片策略（2000 字符限制）

协议没有单独下发 “最大文本长度” 字段，但社区实现普遍以 2000 字符作为保守兼容上限。建议把这当作客户端兼容策略，而不是服务端公开宣告的硬编码常量。

**推荐分片算法**

1. 以 2000 个 Unicode 字符为上限。
2. 优先在 `\n\n`、其次在 `\n`、再次在空格处分片。
3. 找不到合适边界时，硬切 2000 字符。
4. 每个分片单独调用一次 `sendmessage`。
5. 每个分片使用新的 `client_id`，复用同一个 `context_token`。

### 6.6 `client_id` 生成

服务端没有公开 `client_id` 格式约束，但它必须全局唯一，便于幂等、排障和链路跟踪。

常见做法：

- UUIDv4，例如 `7e4f5d8e-c0ab-4e3c-a98f-0c84f0b0d51a`
- 前缀 + 时间戳 + 随机后缀，例如 `pinix-weixin:1774158910456-a1b2c3d4`

**工程建议**

- 在同一进程内不要重复使用同一 `client_id`。
- 文本与媒体分开发送时，每一条都生成新的 `client_id`。

### 6.7 `item_list` 的发送习惯

协议层允许 `item_list` 是数组，但公开稳定实现里，最常见做法是一条请求只发一个 `MessageItem`。带说明文字的媒体消息通常会拆成两条：先发 `TEXT`，再发 `IMAGE`/`FILE`/`VIDEO`。这样做的兼容性最好，也更容易定位失败点。

## 7. Typing 状态

### 7.1 `getconfig` 获取 `typing_ticket`

**Method**

`POST`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/getconfig`

**Request Body**

```json
{
  "base_info": {
    "channel_version": "1.0.0"
  },
  "context_token": "AARzJWAFAAABAAAAAAAp2m3u7oE0x7V8Xw==",
  "ilink_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat"
}
```

说明：类型定义把 `context_token` 视为可选，但公开实现在可用时通常会带上它。

**Response Body**

```json
{
  "ret": 0,
  "typing_ticket": "dHlwaW5nLXRpY2tldC1vOWNxODAwa3VtXzRnOFB5OFF3NUcwYQ=="
}
```

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/getconfig' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r' \
  -H 'X-WECHAT-UIN: MzA1NDE5ODk2' \
  --data-raw '{
    "ilink_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
    "context_token": "AARzJWAFAAABAAAAAAAp2m3u7oE0x7V8Xw==",
    "base_info": {
      "channel_version": "1.0.0"
    }
  }'
```

### 7.2 `sendtyping` 发送 / 取消输入状态

**Method**

`POST`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/sendtyping`

**Request Body（开始输入）**

```json
{
  "base_info": {
    "channel_version": "1.0.0"
  },
  "ilink_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
  "status": 1,
  "typing_ticket": "dHlwaW5nLXRpY2tldC1vOWNxODAwa3VtXzRnOFB5OFF3NUcwYQ=="
}
```

**Request Body（取消输入）**

```json
{
  "base_info": {
    "channel_version": "1.0.0"
  },
  "ilink_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
  "status": 2,
  "typing_ticket": "dHlwaW5nLXRpY2tldC1vOWNxODAwa3VtXzRnOFB5OFF3NUcwYQ=="
}
```

**Response Body**

```json
{
  "ret": 0
}
```

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/sendtyping' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r' \
  -H 'X-WECHAT-UIN: MzA1NDE5ODk2' \
  --data-raw '{
    "ilink_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
    "typing_ticket": "dHlwaW5nLXRpY2tldC1vOWNxODAwa3VtXzRnOFB5OFF3NUcwYQ==",
    "status": 1,
    "base_info": {
      "channel_version": "1.0.0"
    }
  }'
```

**工程建议**

- `status = 1` 表示开始 / 保持输入中，`status = 2` 表示取消。
- 如果生成耗时较长，可以每 5 秒发送一次 `status = 1` 作为 keepalive。
- 回复结束后务必发送一次 `status = 2` 清理状态。
- `typing_ticket` 可按用户缓存；公开实现会在成功获取后缓存约 24 小时，并在失败时退避刷新。

## 8. 媒体处理（CDN）

### 8.1 CDN 基座地址

媒体上传下载统一走：

`https://novac2c.cdn.weixin.qq.com/c2c`

实际路径：

- 上传：`/upload?encrypted_query_param=...&filekey=...`
- 下载：`/download?encrypted_query_param=...`

### 8.2 上传流程：`getuploadurl` → AES-128-ECB 加密 → POST CDN upload

#### 第一步：申请上传参数

**Method**

`POST`

**URL**

`https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl`

**Request Body（当前最稳妥的无缩略图路径）**

```json
{
  "aeskey": "00112233445566778899aabbccddeeff",
  "base_info": {
    "channel_version": "1.0.0"
  },
  "filekey": "7cc7ad1d6aaf4c32b23dc4f8c40ec0cf",
  "filesize": 248736,
  "media_type": 1,
  "no_need_thumb": true,
  "rawfilemd5": "9c4d5c0b21f7f5c77c2b12f05f1b8df8",
  "rawsize": 248731,
  "to_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat"
}
```

字段说明：

| 字段               | 类型       | 说明                                                         |
| ------------------ | ---------- | ------------------------------------------------------------ |
| `filekey`          | `string`   | 本次上传的客户端文件 ID，通常随机 16 字节 hex。              |
| `media_type`       | `number`   | `1 = IMAGE`，`2 = VIDEO`，`3 = FILE`，`4 = VOICE`。          |
| `to_user_id`       | `string`   | 目标用户 ID。                                                |
| `rawsize`          | `number`   | 明文文件大小。                                               |
| `rawfilemd5`       | `string`   | 明文文件 MD5。                                               |
| `filesize`         | `number`   | AES-128-ECB + PKCS7 填充后的密文大小。                       |
| `thumb_rawsize`    | `number?`  | 缩略图明文大小。                                             |
| `thumb_rawfilemd5` | `string?`  | 缩略图明文 MD5。                                             |
| `thumb_filesize`   | `number?`  | 缩略图密文大小。                                             |
| `no_need_thumb`    | `boolean?` | 是否不需要缩略图上传 URL。                                   |
| `aeskey`           | `string?`  | 16 字节 AES key 的 hex 字符串。注意这里是 hex，不是 base64。 |

密文大小计算公式：

```text
filesize = ceil((rawsize + 1) / 16) * 16
```

**Response Body**

```json
{
  "thumb_upload_param": "",
  "upload_param": "AABQmM4mZ2Yx_d4mcpG4vincN2="
}
```

**curl 示例**

```bash
curl 'https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'AuthorizationType: ilink_bot_token' \
  -H 'Authorization: Bearer ilinkbot_4Q7iH3oVt9YF0dJ2sK1mLp6r' \
  -H 'X-WECHAT-UIN: MzA1NDE5ODk2' \
  --data-raw '{
    "filekey": "7cc7ad1d6aaf4c32b23dc4f8c40ec0cf",
    "media_type": 1,
    "to_user_id": "o9cq800kum_4g8Py8Qw5G0a@im.wechat",
    "rawsize": 248731,
    "rawfilemd5": "9c4d5c0b21f7f5c77c2b12f05f1b8df8",
    "filesize": 248736,
    "no_need_thumb": true,
    "aeskey": "00112233445566778899aabbccddeeff",
    "base_info": {
      "channel_version": "1.0.0"
    }
  }'
```

#### 第二步：本地加密文件

加密算法固定为 `AES-128-ECB`，使用 PKCS7 padding。

```ts
import { createCipheriv } from 'node:crypto';

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
```

#### 第三步：上传到 CDN

**Method**

`POST`

**URL**

`https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=AABQmM4mZ2Yx_d4mcpG4vincN2%3D&filekey=7cc7ad1d6aaf4c32b23dc4f8c40ec0cf`

**Headers**

| Header         | 值                         |
| -------------- | -------------------------- |
| `Content-Type` | `application/octet-stream` |

**Body**

AES-128-ECB 加密后的文件二进制内容。

**成功响应头**

```http
HTTP/1.1 200 OK
x-encrypted-param: AAFFc8c2PXQ5mKPw7rbcH7S1EA=
```

`x-encrypted-param` 就是后续 `CDNMedia.encrypt_query_param` 的值。

**curl 示例**

```bash
curl 'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=AABQmM4mZ2Yx_d4mcpG4vincN2%3D&filekey=7cc7ad1d6aaf4c32b23dc4f8c40ec0cf' \
  -X POST \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @/tmp/weixin-photo.enc \
  -i
```

#### 第四步：把 CDN 引用塞回 `sendmessage`

图片消息示例：

```json
{
  "image_item": {
    "media": {
      "encrypt_query_param": "AAFFc8c2PXQ5mKPw7rbcH7S1EA=",
      "aes_key": "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
      "encrypt_type": 1
    },
    "mid_size": 248736
  },
  "type": 2
}
```

说明：当前腾讯官方 openclaw 实现对出站媒体统一把 `aes_key` 写成 “base64 (hex string)” 形式，即先把 hex 文本当作字节，再 base64。下载方因此必须兼容两种 key 编码形式，见第 8.4 节。

### 8.3 下载流程：GET CDN download → AES-128-ECB 解密

**Method**

`GET`

**URL**

`https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=AAFFc8c2PXQ5mKPw7rbcH7S1EA%3D`

**Body**

无。

**Response**

返回密文二进制内容；客户端自行解密。

**curl 示例**

```bash
curl 'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=AAFFc8c2PXQ5mKPw7rbcH7S1EA%3D' \
  --output /tmp/weixin-photo.enc
```

解密示例：

```ts
import { createDecipheriv } from 'node:crypto';

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
```

### 8.4 AES key 的两种编码格式

这是媒体处理最容易踩坑的地方。

#### 格式 A：`base64(raw 16 bytes)`

原始 16 字节 key：

```text
00112233445566778899aabbccddeeff
```

若按真正二进制字节编码，再 base64：

```text
ABEiM0RVZneImaq7zN3u/w==
```

#### 格式 B：`base64(hex string)`

若先把同一个 key 写成 ASCII hex 字符串：

```text
00112233445566778899aabbccddeeff
```

再把这 32 个 ASCII 字节做 base64：

```text
MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=
```

#### 兼容解码规则

1. 先对 `aes_key` 做 base64 decode。
2. 如果结果长度是 16 字节，直接当 AES key 用。
3. 如果结果长度是 32 字节，且内容是 32 个十六进制 ASCII 字符，则再按 hex 解码成 16 字节。
4. 图片消息若额外带 `image_item.aeskey`，它通常已经是 32 位 hex 字符串，可直接 hex decode，优先级可高于 `media.aes_key`。

### 8.5 各媒体类型的上传 / 下载差异

| 媒体 | `getuploadurl.media_type` | `MessageItem.type` | 发送差异                                                                                    | 下载差异                                                                      |
| ---- | ------------------------- | ------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 图片 | `1`                       | `2`                | 通常填写 `image_item.media` 和 `mid_size`。                                                 | 若同时有 `image_item.aeskey`，优先用它解密。缺少 AES key 时可尝试按明文下载。 |
| 视频 | `2`                       | `5`                | 填 `video_item.media`、`video_size`，可选 `thumb_media`。                                   | 一般按 `video_item.media.aes_key` 解密。                                      |
| 文件 | `3`                       | `4`                | 不需要缩略图；常填 `file_name`、`len`。                                                     | 按 `file_item.media.aes_key` 解密。                                           |
| 语音 | `4`                       | `3`                | 协议支持 VOICE 上传；公开官方实现当前重点覆盖接收 / 下载，未提供稳定的独立语音发送 helper。 | 常见编码是 `encode_type = 6` 即 SILK，下载解密后可转码成 WAV。                |

### 8.6 缩略图处理

协议字段层面，图片和视频都支持缩略图：

- 上传请求：`thumb_rawsize`、`thumb_rawfilemd5`、`thumb_filesize`
- 上传响应：`thumb_upload_param`
- 消息体：`thumb_media`、`thumb_size`、`thumb_width`、`thumb_height`

但需要注意两点：

- 腾讯官方 openclaw v1.0.2 当前默认走 `no_need_thumb: true`，也就是只上传主文件，不上传缩略图。
- 因此你会在公开发送实现里看到图片 / 视频消息往往只有 `media`，没有 `thumb_media`。

如果你要完整实现缩略图能力，推荐流程是：

1. 同时准备主文件和缩略图的明文 / 密文大小与 MD5。
2. `getuploadurl` 时省略 `no_need_thumb` 或明确传 `false`。
3. 分别用 `upload_param` 和 `thumb_upload_param` 上传两份密文。
4. 在 `sendmessage` 中把 `media` 与 `thumb_media` 一起带上。

## 9. Session 管理

### 9.1 Session 过期机制

公开实现都把以下任一返回视为 session 失效：

```json
{
  "errcode": -14,
  "errmsg": "session timeout",
  "ret": -14
}
```

失效后应认为当前 `bot_token` 与会话上下文都不再可靠。

### 9.2 重登录策略

协议中没有观察到 “刷新 token” 的独立接口；可行路径就是重新走二维码登录。

推荐处理流程：

1. 停止当前账号的 `getupdates` 循环。
2. 清理内存中的 `context_token` 缓存。
3. 清理本地 `get_updates_buf`。
4. 删除或覆盖旧的凭证文件。
5. 重新执行 `get_bot_qrcode` → `get_qrcode_status` → `confirmed`。
6. 用新的 `bot_token`、`baseurl`、`ilink_bot_id` 继续工作。

### 9.3 凭证刷新

“刷新” 在这里的含义不是刷新 token，而是**拿到新的登录凭证后覆盖旧凭证**。需要一并更新的字段包括：

- `bot_token`
- `baseurl`
- `ilink_bot_id`
- `ilink_user_id`
- `savedAt`

如果登录后 `baseurl` 有变化，后续所有 API 和 CDN 调用都应使用新的配置。

## 10. 完整消息流程图

```mermaid
sequenceDiagram
    participant U as 微信用户
    participant W as iLink 服务端
    participant B as Bot Client
    participant A as Agent/LLM

    U->>W: 发送文本/图片/语音/文件/视频
    B->>W: POST /ilink/bot/getupdates\nget_updates_buf=...
    W-->>B: ret=0, msgs[], context_token, get_updates_buf'
    B->>B: 持久化 get_updates_buf\n缓存(accountId,userId)->context_token
    opt 需要 typing
        B->>W: POST /ilink/bot/getconfig
        W-->>B: typing_ticket
        B->>W: POST /ilink/bot/sendtyping status=1
    end
    B->>A: 交给 Agent 处理
    A-->>B: 回复文本或媒体
    alt 回复文本
        B->>W: POST /ilink/bot/sendmessage\ncontext_token + TEXT item
    else 回复媒体
        B->>W: POST /ilink/bot/getuploadurl
        W-->>B: upload_param
        B->>W: POST CDN /upload\nAES-128-ECB ciphertext
        W-->>B: x-encrypted-param
        B->>W: POST /ilink/bot/sendmessage\ncontext_token + CDNMedia
    end
    opt 结束 typing
        B->>W: POST /ilink/bot/sendtyping status=2
    end
    W-->>U: 用户看到回复
```

## 11. 错误码参考表

腾讯目前没有公开完整错误码字典；以下是已确认或高频遇到的状态 / 错误。

| 层级       | 值                               | 含义                                     | 处理建议                                                           |
| ---------- | -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| QR 轮询    | `status = wait`                  | 未扫码，或本地把超时等价为继续等待。     | 继续轮询。                                                         |
| QR 轮询    | `status = scaned`                | 已扫码，等待手机端确认。                 | 继续轮询。                                                         |
| QR 轮询    | `status = confirmed`             | 登录成功。                               | 保存凭证。                                                         |
| QR 轮询    | `status = expired`               | 二维码过期。                             | 重新申请二维码。                                                   |
| 业务接口   | `ret = 0`                        | 业务成功。                               | 正常处理。                                                         |
| 业务接口   | `errcode = -14` 或 `ret = -14`   | session timeout / session expired。      | 清理状态并重新扫码登录。                                           |
| 业务接口   | 其他 `ret != 0` / `errcode != 0` | 未公开错误码。                           | 原样记录响应体，按失败重试或人工介入。                             |
| CDN 上传   | HTTP 4xx                         | 请求参数错误、签名无效或上传体不合法。   | 不要盲目重试，先检查 `upload_param`、`filekey`、密文长度和请求头。 |
| CDN 上传   | HTTP 5xx                         | CDN 暂时故障。                           | 有限重试，建议最多 3 次。                                          |
| CDN 上传   | `x-error-message`                | CDN 附带错误文本。                       | 直接记录到日志。                                                   |
| 客户端本地 | `AbortError`                     | 本地超时；对长轮询来说通常不是协议错误。 | 直接发起下一轮轮询。                                               |

## 12. 附录：与其他平台对比

| 维度           | Telegram Bot API            | Slack API                    | 微信 iLink Bot API                                     |
| -------------- | --------------------------- | ---------------------------- | ------------------------------------------------------ |
| 收消息方式     | `getUpdates` 或 webhook     | Events API / Socket Mode     | 目前公开实现主要走 `getupdates` 长轮询                 |
| 发送目标       | `chat_id`                   | `channel` / `thread_ts`      | `to_user_id` + `context_token`                         |
| 对话关联主键   | `chat_id` 足够              | `channel` + `thread_ts`      | `context_token` 是关键；只有用户 ID 不够               |
| 主动发消息能力 | 只要知道 `chat_id` 通常即可 | 只要有 scope 与 channel 即可 | 公开实现普遍依赖最近一次入站消息带来的 `context_token` |
| 媒体上传       | 官方 multipart/form-data    | 官方 files/upload API        | 先 `getuploadurl`，再走 AES-128-ECB + 独立 CDN         |
| 媒体加密       | 平台托管，调用方少管        | 平台托管，调用方少管         | 调用方自己负责本地加解密                               |
| 输入状态       | sendChatAction              | typing indicator             | `getconfig` 取 `typing_ticket` 后 `sendtyping`         |
| 协议特征       | 简洁、开放、生态成熟        | 企业协作导向、权限模型复杂   | 对微信会话强绑定，`context_token` 是微信特有设计       |

总结：微信 iLink 的接收方式和 Telegram 的 `getUpdates` 很像，但它的回复模型更像 “每条会话消息都附带一次性的回复上下文令牌”。这一点决定了 SDK 设计不能只缓存 `user_id`，还必须缓存并正确回传 `context_token`。
