# detail-checklist.md — 体验细节七维清单（X-）

<!-- refs:meta
tier: flat
scope: 体验细节七维清单（70 的主清单）
-->

70 stage 的主清单。每一项标注检出方式：`L` = `lint-lobe.mjs`，`S` = `check-detail.mjs`，`B` = 浏览器（截图、Tab 键、视口），`R` = 读代码判断。
逐项给出 ✓ / ✗（写清怎么补）/ n/a（写理由）。

## X-1 状态

| # | 检查 | 检出 |
| --- | --- | --- |
| X-1.1 | 每个数据请求都有 loading 分支；按时长分档：< 300ms 不显示，300ms–2s 骨架屏，> 2s 加载器加说明，> 10s 超时并提供重试 | S `DETAIL-NO-LOADING` |
| X-1.2 | 每个数据请求都有 error 分支，并提供重试入口 | S `DETAIL-NO-ERROR` · `DETAIL-NO-RETRY` |
| X-1.3 | 列表 / 表格有 empty 分支，并区分首次空 / 筛选空 / 确实空 | S `DETAIL-NO-EMPTY` · W-04 |
| X-1.4 | 失败不伪装成「0 条」；刷新失败时保留已有数据 | R |
| X-1.5 | 无权限时降级显示（只读 / 说明 / 申请入口），而不是让入口直接消失 | R |
| X-1.6 | 部分失败（批量操作中 3 条失败）单独展示，并能只重试失败项 | R |
| X-1.7 | 禁用态说明原因（Tooltip 或辅助文字） | S `DETAIL-DISABLED-NO-REASON` |
| X-1.8 | 看板里的每张卡片独立加载、独立失败，一个慢查询不拖住整页 | R |

## X-2 边界输入

| # | 检查 | 检出 |
| --- | --- | --- |
| X-2.1 | 长文本：标题、标签、描述各有截断策略（省略号 + Tooltip 或换行） | B / R |
| X-2.2 | 空值：统一占位 `--`（W-06），不显示 `null` / `undefined` / `NaN` | L `LOBE-NULLISH-RENDER`（WARN） |
| X-2.3 | 超大数字：千分位、单位缩写、等宽数字 | R |
| X-2.4 | 1000+ 条：分页或虚拟化；筛选和搜索不卡顿 | R |
| X-2.5 | 特殊字符和 emoji、RTL、长德语单词不撑破布局 | B |
| X-2.6 | i18n：文案长度变成 1.5 倍时布局依然成立；文案不拼接字符串 | R |

## X-3 交互反馈

| # | 检查 | 检出 |
| --- | --- | --- |
| X-3.1 | 每个异步动作都有进行中状态（按钮 loading / 禁用防重复提交） | S `DETAIL-NO-PENDING` |
| X-3.2 | 成功和失败都有可见结果（`toast` / 行内状态），而不是静默 | S `DETAIL-NO-RESULT-FEEDBACK` |
| X-3.3 | 危险操作二次确认，确认文案写清后果（W-06） | S `DETAIL-DANGER-NO-CONFIRM` + R（文案） |
| X-3.4 | 可撤回的操作优先提供撤销，而不是确认框 | R |
| X-3.5 | hover / active / selected 状态可区分 | B |
| X-3.6 | 乐观更新失败时回滚并提示；长任务显示进度或可离开提示 | R |
| X-3.7 | 表单提交失败时保留用户输入，并把焦点 / 滚动定位到第一个错误字段 | R |

## X-4 微文案

| # | 检查 | 检出 |
| --- | --- | --- |
| X-4.1 | 没有「操作失败」「出错了」这类模糊错误 | L `LOBE-VAGUE-ERROR` |
| X-4.2 | 没有孤零零的「暂无数据」 | L `LOBE-BARE-EMPTY` |
| X-4.3 | 按钮是动词 + 对象；一屏一个 primary | L `LOBE-VAGUE-BUTTON` · `LOBE-MULTI-PRIMARY` |
| X-4.4 | 没有占位文案（Lorem、示例数据） | L `LOBE-PLACEHOLDER-COPY` |
| X-4.5 | 错误文案说清 发生了什么 / 为什么 / 怎么办 中至少两件（W-05） | R |
| X-4.6 | 确认框写清后果，危险按钮复述动作（「删除」而非「确定」）（W-01 / W-06） | R |
| X-4.7 | 输入框 placeholder 是示例而不是标签；表单校验提示说明正确格式 | R |

## X-5 可访问性

| # | 检查 | 检出 |
| --- | --- | --- |
| X-5.1 | 不写 `outline: none` / `outline: 0` 抹掉焦点环 | L `LOBE-OUTLINE-NONE` |
| X-5.2 | 只有图标的按钮有 `aria-label` / `title`；输入框有可见 label 或 `aria-label`（placeholder 不算 label） | L `LOBE-ICON-BUTTON-LABEL` · S `DETAIL-INPUT-NO-LABEL` |
| X-5.3 | `div` / `span` 绑定 `onClick` 时有 `role` 和键盘处理 | L `LOBE-DIV-CLICK`（WARN） |
| X-5.4 | `img` 有 `alt` | L `LOBE-IMG-ALT` |
| X-5.5 | 对比度：正文 4.5:1，大字和 UI 组件 3:1 | B |
| X-5.6 | 状态不只靠颜色表达（同时配图标或文字） | R |
| X-5.7 | Tab 键能走完主路径，浮层打开时焦点锁在浮层内 | B |
| X-5.8 | 动效尊重 `prefers-reduced-motion` | L `LOBE-REDUCED-MOTION` |

## X-6 响应式

| # | 检查 | 检出 |
| --- | --- | --- |
| X-6.1 | 1440 / 768 / 390 三档视口都没有横向溢出 | B |
| X-6.2 | 触控目标 ≥ 44×44px | B |
| X-6.3 | 用 `responsive.*` 断点，不写死宽度；表格在窄屏有横滚或卡片化方案 | L `LOBE-FIXED-WIDTH` + R |
| X-6.4 | 指标卡在窄宽度下按规则换行，不出现孤卡 | B |

## X-7 一致性

| # | 检查 | 检出 |
| --- | --- | --- |
| X-7.1 | 同一种状态在全页用同一种组件和措辞表达 | R |
| X-7.2 | 空值占位、时间格式、数字格式全站统一 | R |
| X-7.3 | 同一种动作的确认强度一致 | R |
| X-7.4 | 专名和口径一致（W-03） | R |
| X-7.5 | 多个页面之间的漂移（同一含义多种 token / 组件）交给 60：`lint-lobe.mjs <范围> --json` 按规则聚合 | L |

## 执行顺序与产出

1. 先跑脚本：`node scripts/lint-lobe.mjs <路径> --stage 70-detail` 与 `node scripts/check-detail.mjs <路径>`，把 FAIL / WARN 填进对应行。
2. 再过 `R`（读代码）项，最后过 `B`（浏览器）项；没有浏览器时 `B` 项标 ⚠ 并写「未验证」，不能写 ✓。
3. 每行结果只能是 ✓ / ✗（附补法）/ n/a（附理由）/ ⚠（未验证）。
4. 同一个 `R` / `B` 项被用户纠正两次 → 按 learnings/README.md 评估能否升级为 `S` / `L`。
