# learnings — 自进化：纠错沉淀、回写、版本化

> 「同一个错犯两次，就把纠正写下来；能写进代码的，就不要只写进提示。」
> 本目录把每次使用中的纠错和偏好，变成**结构化条目 → 落到最强的一层 → 回归用例锁住 → 版本号记账**。
> 整个闭环由 `scripts/check-learnings.mjs` 机械把关，`node tests/run.mjs` 会一起跑。

## 1. 什么时候记一条

| 触发 | source | 谁来记 |
| --- | --- | --- |
| 用户纠正了一次输出（「这里不该用 Modal」「颜色太花」「别加 eyebrow」） | `user-correction` | 当前 stage 结束时，汇总里的「学习候选」 |
| 80 审查发现某类问题在本轮反复出现 | `review` | 80 stage |
| 60 盘点 / lint 全量扫描发现某个可机械识别的漂移 ≥ 2 处 | `system-scan` | 60 stage |

不记：一次性的业务事实（写进项目 `.agents/ux/product.md`）、纯个人口味且用户没有要求沉淀的。

## 2. 条目格式（追加到 [LOG.md](LOG.md)，一条一个 ```learning 块）

先用 `node scripts/check-learnings.mjs --new` 生成带下一个 id 的空模板，再填。

```
id: LRN-YYYYMMDD-NN          唯一编号
date: YYYY-MM-DD
status: open | landed | rejected
symptom: 一句话现象（用户看到的问题，不是原因）
source: user-correction | review | system-scan
scenario: launch-visual | product-polish | operate-build | system-unify | screenshot-restore | pre-launch | -
stage: 出问题的 stage（如 50-visual）
occurrences: 第几次出现（同一 symptom 复发时 +1，并沿用旧条目的 previous_layer）
previous_layer: 上一次落在哪层（首次留空）
root_cause: 为什么会错（规则缺失 / 规则在错误的 stage / 规则太模糊 / 检测太宽…）
layer: structure | lint | rule | style   —— 本次落地层级
layer_reason: 为什么选这一层（为什么不能更强）
why_not_code: layer=style 时必填：为什么无法确定性校验
artifacts: 改了什么，用逗号分隔：lint 规则 id（LOBE-* / DETAIL-*）、references 规则编号（A-04.3）、文件路径
regression: 锁住它的回归样例，如 tests/fixtures/bad-visual.tsx:15（layer=lint 必填且必须真的有 expect）
version: 落地版本（status=landed 必填，必须出现在 CHANGELOG）
```

## 3. 选层级：由强到弱，选「当前可行的最强一层」

| 层 | 含义 | 落点 | 什么样的反馈适合 |
| --- | --- | --- | --- |
| **structure** | 结构让错误不可能发生 | stage 输出模板、`pipeline.json` 白名单、`check-structure.mjs`、组件模板 | 关注点混入、流程漏步、产出缺字段 |
| **lint** | 机器在每次改动后必跑、违反即 FAIL / WARN | `scripts/lint-lobe.mjs`（行 / 文本正则）或 `scripts/check-detail.mjs`（「做了 X 必须有 Y」） | 能用正则 / 计数 / 共现判断的写法：裸色值、某种渐变、缺 alt、缺 loading… |
| **rule** | 需要判断，但判据可写清 | `references/*.md` 的编号规则 + `pipeline.json` 中所属 stage 的 `allowedRuleIds` | 「一屏一个焦点」「区块间距 ≥ 内部 2 倍」这类要看截图或读结构的 |
| **style** | 只能靠人审 | aesthetics / detail-checklist 的 `V` / `B` 项 | 品味判断：「方向不够独特」 |

**确定性判定流程**（决定能不能写进代码）：

1. 能否用「出现了 X」或「做了 X 却没有 Y」描述？→ 能：**lint**。
2. 能否用数数描述（档位 ≤ N、primary ≤ 1、gradientAnimation ≤ 2）？→ 能：**lint**（文件级计数）。
3. 需要看渲染结果，但判据是数值（对比度、溢出、触控尺寸）？→ **rule**，并在条目里写「待浏览器检查脚本」。
4. 只能主观判断？→ **style**，必须写 `why_not_code`。

## 4. 回写硬约束（由 `check-learnings.mjs` 校验，违反即 FAIL）

| 编号 | 约束 |
| --- | --- |
| L-01 | **同一现象第二次出现必须升一级**：`occurrences ≥ 2` 时 layer 不能是 style；有 `previous_layer` 时本次必须更强 |
| L-02 | `layer=lint` 且 landed：artifacts 里的规则 id 必须真实存在于脚本；`regression` 指向的 fixture 必须有对应 `expect:` |
| L-03 | `layer=rule` 且 landed：artifacts 里的规则编号必须在 references/ 中有定义 |
| L-04 | landed 必须写 `version`，且 CHANGELOG 有这个版本 |
| L-05 | `layer=style` 必须写 `why_not_code` |
| L-06 | 豁免必须写理由：`// lobe-design-ignore <ID>: <理由>`。没有理由的豁免不生效，并报 `LOBE-IGNORE-NO-REASON`（FAIL） |

此外脚本还保证：每条 lint / detail 规则都有回归样例（V-02）；每条规则的 `since` 版本在 CHANGELOG 中登记并点名（V-03）；SKILL.md、pipeline.json、CHANGELOG 版本一致（V-01）。

## 5. 把一条确定性反馈变成代码（lint 层操作步骤）

1. **先写失败用例**：在 `tests/fixtures/bad*.tsx` 写一行能复现问题的代码，行尾 `expect: <新规则 ID>`；文件级启发式写在 `detail-bad.tsx` 的 `expect-file:` 头里。
2. **写反例**：在对应 `good*.tsx` 写一个「看起来像但其实合规」的写法，防止误报。
3. **加规则**：在 `lint-lobe.mjs` 的 `RULES` 里加 `{ id, level, ref, stage, since, msg, test }`；`ref` 必须是 references 里的编号，`stage` 决定由哪个 stage 处理它。
   - 新规则默认 `WARN`；连续两个版本无误报再升 `FAIL`（在 CHANGELOG 记一句）。
4. **登记**：对应 reference 规则旁写 `lint：\`<ID>\``；detail 规则同步 detail-checklist 的「检出」列。
5. **版本**：bump `SKILL.md` / `pipeline.json` 的 version，在 CHANGELOG 新版本下点名该规则 id。
6. **记账**：LOG.md 条目 `status: landed`、`version`、`regression` 填齐。
7. `node tests/run.mjs` 全绿才算回写完成。

## 6. 版本化规则

- 语义化版本：
  - **patch**（2.1.x）：修误报 / 漏报、改诊断文案、补回归样例；不改变任何规则的通过条件。
  - **minor**（2.x.0）：新增规则或检查（默认 WARN）、WARN 升 FAIL、新增 reference 规则编号。
  - **major**（x.0.0）：stage 拆合、路由 / 场景映射改变、删除规则编号。
- 每条 lint 规则带 `since`；`node scripts/lint-lobe.mjs --rules` 会列出。
- 删除规则不复用编号；在 CHANGELOG 写「移除 <ID>：原因」，相关 LOG 条目改 `status: rejected` 并注明。
- 标准维护在运行时之外：每个 minor 版本前，用好案例 / 坏案例 / 边界案例各至少一个 fixture 回归，确认没有「只修好一个样本、伤害其他样本」。

## 7. 回写之后

```bash
node scripts/check-learnings.mjs   # 日志 + 回写约束 + 版本一致
node tests/run.mjs                 # 全部回归（结构、路由、intent、refs、bootstrap、lint、detail、learnings）
```

## 8. 回流：把通用经验交给上游

本 skill 托管在 <https://github.com/lobehub/lobe-design-skill>。项目级经验留在本地，**通用经验回流到上游**，
判据见 [CONTRIBUTING.md](../CONTRIBUTING.md)：

```bash
node scripts/upstream.mjs                                  # 列出候选与不回流的原因
node scripts/upstream.mjs --write upstream-candidates.md   # 生成可提 PR 的清单
```

机械判据（缺一不可）：`landed` 且带版本 · 层在 `structure/lint/rule`（style 不回流）· `occurrences ≥ 2` ·
不含品牌 / 项目专有名词 · `symptom` / `root_cause` / `artifacts` 齐全。

**自检一句话：去掉项目名之后，这条判据还成立吗？** 不成立就留在本地。
