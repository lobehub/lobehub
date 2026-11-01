# Stage 75 · 界面文案（copy）

> 只回答一个问题：**界面上的每一句话，是否按本产品的文案 profile 写得准确、一致、可扫读，中文排版是否正确。**
> 放在 70 之后、80 之前：结构、主路径、状态都定了，要写的句子才齐。40 决定「有哪些按钮、确认框、说明」，70 决定「空 / 错 / 加载态讲没讲到要素」，本 stage 只管**怎么说、怎么排**。

## 聚焦

- 选 profile（下节），只按这一份 profile 的语气、人称、术语、密度改写
- 通用核心 T-01..T-09：范围与优先级、中西文留白、标点、数字单位、术语原样、句式、人称、i18n 键值
- 把 40 / 70 已经要求存在的文案（W-01..W-06）按 profile 写成最终措辞
- 术语表：本页用到的对象名、动作对、状态词，各自只有一个首选词

## 不负责

- 有没有这个按钮 / 步骤 / 确认框、该不该删 → 40（记 `遗留 → 40`）
- 状态画面缺失、空 / 错态缺要素、长文本与 i18n 长度撑破布局 → 70
- 字体、字号、字距、截断样式 → 50
- 长篇文档：文档站正文、API 参考、操作手册、更新日志、营销长文。不在本 stage 范围，参照 Tech-Doc-Style-Chinese（见 copy-core 顶部）
- 打分 → 80

## 输入

- 00 brief：页面类型、主任务、危险操作（**必需**；危险操作决定确认文案的强度）
- `.agents/ux/product.md` 的「文案 profile」字段（05-init Round 1 写入）与项目术语表
- 40 的改动与删减清单、70 补齐的状态清单；目标代码与 i18n 语言包

## 选 profile（渐进式披露）

1. 读 `product.md` 的 `copy-profile:`。可以有多个，用路由区分：`copy-profile: consumer; /admin → admin`。按当前页面所在路由取一个。路由按**路径段**匹配，不是字符串前缀：`/api-keys` 命中 `/:wsSlug/api-keys`、`/acme/api-keys/new`，不命中 `/api-keys-legacy`；`/*/api-keys` 的 `*` 恰好一段，`/admin/**` 任意多段，`^/admin` 只从根匹配；多条命中取字面段多的。`refs.mjs --page <路由>` 可直接指定当前页面。
2. 没写 → 按 product.md 的「产品类型」推断：消费级聊天 / 社区 → `consumer`；团队协作 / SaaS / 专业工具 → `saas`；管理后台 / 运营 / 审批 / ops → `admin`；开发者平台 / API 控制台 → `devtool`。
3. 没有 product.md → 问一句「这页的主要用户是：个人用户 / 团队用户 / 内部运营 / 开发者？」。不能问时按路由和页面内容推断，在输出里写明「profile 为推断」，并记 `遗留 → 05`。
4. `node scripts/refs.mjs "<指令>" --stage 75-copy [--profile <id> | --root <项目根>]` 列出要读的文件：copy-core 与 copy 整份，profile 文件**只读选中的那一份**，其余跳过。

## 只加载

- [copy-core.md](../references/copy-core.md)：T-01..T-09（每次都读）
- [copy.md](../references/copy.md)：W-01..W-06 只作为「必须讲到什么」的前提，不在这里重新判定
- 四份 profile **只读一份**：
  - [copy-consumer.md](../references/copy-consumer.md)：T-10..T-13
  - [copy-saas.md](../references/copy-saas.md)：T-20..T-23
  - [copy-admin.md](../references/copy-admin.md)：T-30..T-33
  - [copy-devtool.md](../references/copy-devtool.md)：T-40..T-43

## 步骤

1. 选 profile，写一行：`profile = <id>（来源：product.md | 推断 | 用户回答）`。
2. 列出本页全部可见文案（含 toast、tooltip、placeholder、确认框、通知），以及它们在 i18n 里的 key。
3. 先定术语：对象名、动作对、状态词各一个首选词（T-05）；和项目术语表冲突时服从项目。
4. 按 profile 改写语气、人称、密度和空 / 错 / 确认文案；不补造事实（T-01）。
5. zh-CN 排版过一遍（T-02..T-04）；跑 `node scripts/lint-lobe.mjs <路径> --stage 75-copy`，包括 zh-CN 语言包目录。
6. en 或其他语言只做 T-08 / T-09 的一致性检查，不逐字回译。

## 检查清单

1. profile 已选定并写明来源；只读了一份 profile 文件。
2. 人称全页一致（T-07 / profile）；没有黑话、营销腔、双重否定（T-06）。
3. 同一对象、动作、状态只有一个首选词，技术名词与标识符原样（T-05）。
4. 按钮是动词 + 对象（W-01），确认框写清对象、后果、是否可撤销（W-06），错误给出原因和出路（W-05）—— 措辞符合 profile 的推荐列。
5. zh-CN：中西文留白、全角标点、数字与单位、日期格式正确（T-02..T-04）；lint 的 `LOBE-CJK-LATIN-SPACE` / `LOBE-HALFWIDTH-PUNCT` 已处理或写了豁免理由。
6. i18n：没有拼接句子，插值参数各语言一致，key 是语义名（T-08）。
7. 没有新增原文和上下文里没有的数字、时限或承诺；不确定处标「待确认」。

## 症状 → 规则

| 症状 | 规则 |
| --- | --- |
| `使用API`、`共3条`、`10GB` | T-02 · T-04 |
| `保存失败,请重试`、`名称:` | T-03 |
| 同页一会儿「您」一会儿「你」 | T-07 |
| `非法参数`、`未授权`（其实是未登录） | T-05 |
| `赋能`、`一站式`、`轻松管理` | T-06 |
| `t('a') + n + t('b')` 拼句 | T-08 |
| 后台写成聊天口吻、开发者平台写成营销口吻 | 选错 profile → 重新选 |

## 输出

```
[75 · copy] 完成
profile：<consumer|saas|admin|devtool>（来源：product.md | 推断 | 用户回答）
术语：<对象 / 动作对 / 状态词 → 首选词>
改动：<文案 key 或位置 —— 旧 → 新，带规则编号>
脚本：<lint --stage 75-copy 的 RESULT 行>
待确认：<缺事实的地方，没有写「无」>
遗留：<→ 40 / 50 / 70 / 05>
```
