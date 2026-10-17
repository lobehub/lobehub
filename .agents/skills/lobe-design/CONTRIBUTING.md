# 回流指南（CONTRIBUTING）

本仓库是 lobe-design skill 的上游：<https://github.com/lobehub/lobe-design-skill>。
消费方在使用中沉淀下来的**通用经验**，可以通过这里回流进来。回流的价值在于：让一次纠正对所有使用这个 skill 的项目都生效，而不是只留在某个仓库里。

## 什么该回流，什么不该

回流的是**判据**，不是某个项目的具体取值。

| 该回流 | 不该回流 |
| --- | --- |
| 一类可复现的坑，以及可机械校验的判据 | 只对某个项目成立的业务规则 |
| 能被正则 / 计数 / 共现关系判断的规则 | 依赖某个产品品牌、内部代号、专有名词的场景 |
| 通用的 stage 契约、路由信号、模型挂载方式 | 某个团队的口味偏好（「我们喜欢圆角小一点」） |
| 真实代码上发现的误报与漏报 | 未经验证的一次性尝试 |
| 模型的新挂载点与必须产出的字段 | 把某个模型当成口号到处引用 |
| 通用的设计判据：信息优先级、流程、文案、状态 | 组件自身的 bug、默认值缺陷和对应的绕法（归 lobe-ui，去组件库提 issue） |

**一句话自检：把项目名去掉之后，这条判据还成立吗？** 不成立就不要提。

**组件 bug 不在范围内。** lobe-design 只管通用设计规则（哪个场景用哪个组件、信息怎么排、流程和文案怎么写）。「某个组件丢了属性 / 默认值不对 / 换行或塌陷，要这样绕」是组件库的问题：去 lobe-ui 提 issue，修好之前的绕法留在项目代码里，不进 skill，也不进项目层规则文件。判断方法：组件修好之后这条还成立吗？不成立就是组件问题。

## 六条机械判据

`node scripts/upstream.mjs --from <消费方的 learnings/LOG.md>` 会按下面六条筛选，缺一不可：

1. `status: landed` 且带 `version`（半成品不回流）
2. `layer ∈ {structure, lint, rule}`（`style` 层依赖品味，不回流）
3. `occurrences ≥ 2`（至少复发过一次，才说明是通用问题而不是偶发）
4. 不含品牌 / 项目专有名词（默认词表 + `--deny` 追加）
5. `symptom`、`root_cause`、`artifacts` 齐全（说不清问题就说不清判据）
6. 不是组件问题：条目带 `scope: component-bug`，或 `root_cause` / `layer_reason` 写明是组件 bug、组件缺陷、组件默认值问题的，不回流（归 lobe-ui）

```bash
node scripts/upstream.mjs                                  # 列出候选与不回流的原因
node scripts/upstream.mjs --write upstream-candidates.md   # 生成可直接提 PR 的清单
node scripts/upstream.mjs --deny "内部代号,某产品名"          # 追加品牌词检查
```

## 提交流程

1. 在消费方仓库跑 `node scripts/upstream.mjs --write <file>`，得到候选清单。
2. 逐条再确认一次「去掉项目名是否仍成立」。
3. 按下方格式提交 PR；**一个 PR 只做一件事**（一条规则 / 一个 stage 契约 / 一处误报修复）。
4. PR 里必须包含能锁住它的回归：新增或修改 `tests/fixtures/` 里的正反例。
5. 提交前在 `skills/lobe-design/` 下跑 `node tests/run.mjs`，必须全绿。

## 不同层的回流怎么提

### lint 层（新增或修复规则）

1. **先写失败用例**：在 `tests/fixtures/bad*.tsx` 写一行能复现问题的代码，行尾 `expect: <新规则 ID>`。
2. **再写反例**：在对应 `good*.tsx` 写一个「看起来像但其实合规」的写法，防止误报。
3. 在 `lint-lobe.mjs` 的 `RULES` 里加规则：`{ id, level, ref, stage, since, msg, test }`。
   - 新规则默认 **WARN**；连续两个版本无误报后再升 FAIL。
   - `ref` 必须指向 `references/` 里真实存在的编号；`stage` 决定由哪个 stage 处理它。
4. 在对应 reference 规则旁写 `lint：\`<ID>\``；detail 规则同步 `detail-checklist.md` 的「检出」列。
5. bump `SKILL.md` / `pipeline.json` 的 version，在 `CHANGELOG.md` 新版本下**点名该规则 id**。

### rule 层（references 编号规则）

在对应的 `references/*.md` 加编号规则，并在 `pipeline.json` 里把它加进所属 stage 的 `allowedRuleIds`。若它属于 index 文件，同时在文件顶部的 `refs:meta` 里加一条 `entries`（`deep` + 触发词）。编号不复用。

### structure 层（stage / 路由 / 契约）

改 stage 拆分、场景映射、路由规则属于 **major**。需要同时更新：`pipeline.json`、对应 stage 文件、`SKILL.md` 的场景表与 stage 索引、`CHANGELOG.md`，以及 `tests/route-cases.json` 的回归用例。

## PR 模板

```markdown
## 问题
<一类可复现的现象，去掉项目名仍然成立>

## 根因
<为什么现在的 skill 挡不住它>

## 落地层与理由
layer: <structure|lint|rule>
layer_reason: <为什么不能落在更强的一层>

## 改动
<规则 id / 编号 / 文件>

## 回归
<新增或修改的 fixture、route-case>

## 自检
- [ ] 去掉项目名后判据仍成立
- [ ] 不含品牌 / 内部代号
- [ ] 不是组件 bug 或绕法（组件修好后仍然成立）
- [ ] 新规则默认为 WARN，且有 good 反例
- [ ] node tests/run.mjs 全绿
- [ ] CHANGELOG 已登记并点名新的规则 id
```

## 版本语义

跟着 `learnings/README.md` §6：

- **patch**：修误报 / 漏报、改诊断文案、补回归样例。
- **minor**：新增规则或检查（默认 WARN）、WARN 升 FAIL、新增 reference 编号。
- **major**：stage 拆合、路由 / 场景映射改变、删除规则编号。

删除的编号不复用；被否掉的回流建议在对应 LOG 条目改 `status: rejected` 并注明原因。
