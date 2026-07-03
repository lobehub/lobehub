# 常犯错误 (Common Mistakes)

> **强制流程**：每次执行 agent-testing 之前，先完整读一遍本文件，逐条自检提醒自己不要重犯。
> 用户给出任何负面反馈时，把它作为新的一条 case 追加到这里 —— 每条包含：错误做法 / 为什么不应该这么做 / 会带来的问题 / 正确做法。

---

## Case 1 — 用启发式代替「亲眼看截图」就判 passed

**错误做法**：navigate 到一个 surface 后，只用 `document.body.innerText` grep 几个关键词 + `document.querySelectorAll('[class*=Skeleton]').length === 0` 就断定「正常渲染 /passed」，从不真正 Read 那张截图。

**为什么不应该这么做**：

- 持久化的左侧 nav / 布局壳文案一直在 DOM 里，innerText grep 几乎必然假阳性。
- 空白页 / 白屏同样是 0 个骨架，`skeletons === 0` 完全无法区分「渲染成功」和「渲染成空白」。

**会带来的问题**：发布了**假的 passed 结论**。本次 `/page` 的截图其实是空白页（只有 LobeHub 水印 + `Debug ID: Desktop > Main > Layout`），却被报成「正常渲染，证明移除死 Suspense 未破坏渲染」—— 不仅掩盖了可能的真实回归（删 Suspense 导致白屏），还误导了 reviewer 和用户，浪费信任。

**正确做法**：每一张要写进报告 `evidence` 的截图，**必须先用 Read 工具把图片打开、亲眼确认渲染了预期内容**，再判 pass/fail。grep / 计数只能当辅助信号，绝不能当结论。看到空白 / 水印 / 只有布局壳 = fail 或 uncertain，要去查根因。

---

## Case 2 — 需求核心是「验证出错场景」，却因为注入难就只交 happy-path

**错误做法**：诱发 fetch 失败试了 `network route --abort`、`window.fetch` 覆盖、`set offline` 三种都失败后，就放弃「出错态截图」，只交 happy-path + 单测，把核心目标标成 uncertain/blocked 收工。

**为什么不应该这么做**：这次需求的**唯一目的**就是验证所有报错 / 出错场景。放弃这个核心目标 = 没完成任务。而且当时我自己已经写出了可行的替代方案（CDP `Network.setBlockedURLs`、服务端故障注入），却没有去执行就收工了。

**会带来的问题**：交付物没覆盖用户真正要的东西，等于白跑一整轮，还得返工。

**正确做法**：**核心目标不达成不收工**。第一批方法失败，立刻换下一个已知可行的方法（对本 app 的 TRPC：CDP `Network.setBlockedURLs` 在网络栈层拦截，位于 fetch 之下能拦住 TRPC；或临时让服务端某个 endpoint 返回 500），一定要拿到**真实失败态截图**再写报告。

---

## Case 3 — （占位）用户后续负面反馈继续往下追加

<!-- 新 case 模板：
## Case N — 一句话概括错误
**错误做法**：…
**为什么不应该这么做**：…
**会带来的问题**：…
**正确做法**：…
-->
