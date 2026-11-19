# CUST-007：统一认证平台 SSO_TICKET 接入

全仓二开总清单与通用合并流程见 [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md)。本文只维护 CUST-007 的实现位置、上游合并接点与联调清单。

## 1. 功能与边界

门户已登录用户点击 LobeHub 菜单 → 平台创建一次性 `sso_ticket` → 浏览器跳转
`/api/auth/sso-ticket/callback?ticket=...` → LobeHub 服务端兑换 ticket → 按
`providerId + userId` 查/建本地用户 → 建立 Better Auth 会话 → 重定向站内首页。

### 1.1 兼容：门户直接传 token

对接现实中平台可能不预先生成 ticket，而是把当前用户 token 放在回调查询串里
（`?token=...`）。此时 LobeHub 服务端会先调平台的 `ticket/create` 换到 ticket，
再走同一条 exchange 链路：

```
?token=xxx → POST ticket/create (Authorization: Bearer xxx)
           → ticket → exchange → 本地会话
```

启用该路径需要额外配置 `AUTH_SSO_TICKET_CREATE_URL` 与 `AUTH_SSO_TICKET_REDIRECT_URI`。
安全约束：token 只在服务端使用，不落日志、不进入任何跳转地址；callback 处理完立即 302。

明确**不做**：

- 不支持 OIDC / OAuth2 标准授权码流程（只实现平台文档里的 `sso_ticket` 直达免登）
- 不在 LobeHub 侧创建 ticket（创建接口要求平台登录态，只能由门户调用）
- 不自动授予 `super_admin`；`roleCodes` 本期只透传记录，不做权限映射
- 不做组织 / 租户同步（`devOrgId`、`currentTenantId` 仅进入 profile 类型，未落库）
- 不做登出联动

## 2. 实现位置

| 文件 | 职责 |
| --- | --- |
| `src/libs/better-auth/plugins/sso-ticket/types.ts` | 错误码、profile/config 类型，无外部依赖 |
| `src/libs/better-auth/plugins/sso-ticket/config.ts` | 直读 `process.env` 的配置解析与缺失项提示 |
| `src/libs/better-auth/plugins/sso-ticket/exchange.ts` | 服务端换票、错误码映射、日志脱敏 |
| `src/libs/better-auth/plugins/sso-ticket/userMapping.ts` | 工号规范化、邮箱生成、用户/账号字段映射 |
| `src/libs/better-auth/plugins/sso-ticket/redirect.ts` | 站内相对路径校验，防开放重定向 |
| `src/libs/better-auth/plugins/sso-ticket/index.ts` | Better Auth 插件、callback 端点、建会话 |

改动面（仅此 3 处既有文件）：

- `src/auth.ts`：`plugins: []` → `plugins: [ssoTicket()]`
- `.env.example`：追加 `AUTH_SSO_TICKET_*` 说明
- `CUSTOMIZATIONS.md`：登记 CUST-007

## 3. 上游合并接点清单

合并 `lobehub/lobehub` 后逐条复查：

1. **`src/auth.ts` 的 plugins 行**：冲突时保留 `ssoTicket()`，并确认上游新增插件仍被包含。
2. **basePath 假设**：端点路径 `/sso-ticket/callback` 依赖 Better Auth 默认 `/api/auth`。
   若上游改了 `basePath`，callback 地址同步变化，必须通知平台侧更新白名单。
3. **会话 API**：`internalAdapter.createSession(userId)` 与 `setSessionCookie(ctx, { session, user })`
   是 better-auth 1.6.33 的签名。升级 better-auth 时必须复核这两个调用（类型检查会报错，但语义变化未必）。
4. **新用户初始化**：依赖 `define-config.ts` 的 `databaseHooks.user.create.after` 调用
   `UserService.initUser`。若上游移除该钩子，SSO 创建的用户会缺少默认初始化。
5. **`accounts` 无 `(providerId, accountId)` 唯一索引**：并发首登靠"创建失败后重查"兜底。
   若上游补了唯一索引，可移除重查逻辑并简化。
6. **限流接口**：插件使用 `rateLimit: [{ pathMatcher, window, max }]`，升级 better-auth 时复核形状。

## 4. 配置项

```env
AUTH_SSO_TICKET_ENABLED=1
AUTH_SSO_TICKET_CLIENT_ID=lobehub
AUTH_SSO_TICKET_CLIENT_SECRET=...
AUTH_SSO_TICKET_EXCHANGE_URL=https://cloud.example.com/auth/sso/ticket/exchange
AUTH_SSO_TICKET_LOGIN_DOMAIN=DEV
AUTH_SSO_TICKET_DEFAULT_REDIRECT=/
# 可选
AUTH_SSO_TICKET_PROVIDER_ID=tellhow-sso
AUTH_SSO_TICKET_EMAIL_DOMAIN=tellhow.com
AUTH_SSO_TICKET_TIMEOUT_MS=5000
```

SSO-only 部署建议同时关闭邮箱密码与验证（设计文档 §8）：

```env
AUTH_DISABLE_EMAIL_PASSWORD=1
AUTH_EMAIL_VERIFICATION=0
```

## 5. 单元测试

```bash
pnpm vitest run src/libs/better-auth/plugins/sso-ticket
```

覆盖：配置分支、换票成功/HTTP 错误/业务码/超时/非 JSON/clientId 与 loginDomain 不匹配/
字段缺失、脱敏、工号邮箱规则、开放重定向防护、首次登录建号、二次登录复用、
工号变更复用同一用户、禁用用户拒绝、并发首登兜底。

## 6. 联调清单（对应设计文档 §13）

- [ ] 平台侧创建测试 client，`ssoEnabled=true`
- [ ] `loginDomain=DEV`，callback 加入 redirect URI 白名单
- [ ] 平台菜单可调用 ticket create
- [ ] 浏览器可跳转到 LobeHub callback
- [ ] 确认 exchange 的 Authorization 格式（文档存在 Basic 写法歧义）
- [ ] 首次登录创建用户
- [ ] 重复登录进入同一用户
- [ ] 重复兑换同一 ticket 失败
- [ ] 过期 ticket 失败
- [ ] 平台禁用用户后无法建立新会话
- [ ] 工号 / 姓名展示正确
- [ ] 登录完成后 URL 不含 ticket
- [ ] 刷新页面会话保持
- [ ] 重新打开浏览器会话行为符合预期
- [ ] 回调限流生效（10 次 / 60s）

## 7. 已知风险

- exchange 的 `Authorization` 写法、ticket 一次性语义、`userId` 稳定性三项目前按设计文档
  假设实现，联调前必须向平台侧确认（设计文档 §15）。
- `roleCodes` 未做权限映射，普通用户不会因此获得管理权限，但也意味着本阶段无法做基于平台的授权。
