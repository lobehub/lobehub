# LOG — 经验日志

> 格式与约束见 [README.md](README.md)。每条一个 ```learning 块；由 `node scripts/check-learnings.mjs` 校验。
> 新条目追加在末尾；复发时不要改旧条目，新开一条并填 `occurrences` / `previous_layer`。

## LRN-20261014-01 · 视觉打磨时仍被架构规范占用注意力

```learning
id: LRN-20261014-01
date: 2026-10-14
status: landed
symptom: 调视觉细节时还在大量考虑项目架构是否符合 LobeUI 规范
source: user-correction
scenario: product-polish
stage: 50-visual
occurrences: 2
previous_layer: rule
root_cause: 旧 03-polish 的加载清单包含 C-08（组件选型），SKILL.md 把「硬性前提」声明为任何阶段都成立
layer: structure
layer_reason: 之前只在提示里写「专注视觉」（rule），复发；改为加载白名单写进 pipeline.json，由 check-structure.mjs 的 isolation:* 校验，架构硬规则交给 lint 兜底
artifacts: scripts/pipeline.json, scripts/check-structure.mjs, stages/50-visual.md, LOBE-ANTD-IMPORT
regression: scripts/check-structure.mjs isolation:50-visual
version: 2.0.0
```

## LRN-20261014-02 · components.md 引用了未定义的 K-16

```learning
id: LRN-20261014-02
date: 2026-10-14
status: landed
symptom: 规则引用了一个不存在的编号 K-16，读者找不到规则
source: system-scan
scenario: -
stage: 30-structure
occurrences: 1
root_cause: 规则编号没有一致性校验
layer: structure
layer_reason: 文档级一致性可以完全机械判断，放进 check-structure.mjs 的 no-dangling-ids
artifacts: scripts/check-structure.mjs, references/components.md
regression: scripts/check-structure.mjs no-dangling-ids
version: 2.0.0
```

## LRN-20261014-03 · 豁免注释被当成万能开关

```learning
id: LRN-20261014-03
date: 2026-10-14
status: landed
symptom: 代码里出现不带理由的 lobe-design-ignore，审查时无法判断豁免是否合理
source: review
scenario: -
stage: 80-review
occurrences: 1
root_cause: 旧版 lint 只要同行出现 ignore + ID 就跳过，理由是可选的
layer: lint
layer_reason: 「ignore 后面有没有 `: 理由`」可以用正则确定性判断；没有理由的豁免不生效并报 FAIL
artifacts: LOBE-IGNORE-NO-REASON, scripts/lint-lobe.mjs
regression: tests/fixtures/bad-visual.tsx
version: 2.1.0
```

## LRN-20261014-04 · 字阶挤在一起、字距加宽，页面一眼像模板

```learning
id: LRN-20261014-04
date: 2026-10-14
status: landed
symptom: 标题用 16/18/20/22/24/28 六档相邻字号，小标签 letter-spacing 0.2em，看起来像 AI 模板
source: review
scenario: launch-visual
stage: 50-visual
occurrences: 2
previous_layer: rule
root_cause: A-02 只写了「≤ 5 档、相邻 ≥ 1.25 倍」的文字判据，打磨时没人数
layer: lint
layer_reason: 档位数和相邻比值、字距数值都可以从样式源码里数出来
artifacts: LOBE-FONT-SIZE-SCALE, LOBE-LETTER-SPACING, A-02
regression: tests/fixtures/bad-visual.tsx
version: 2.1.0
```

## LRN-20261014-05 · 异步动作静默、危险操作没确认

```learning
id: LRN-20261014-05
date: 2026-10-14
status: landed
symptom: 导出 / 删除点了之后没有任何结果提示，删除密钥也没有二次确认
source: review
scenario: operate-build
stage: 70-detail
occurrences: 1
root_cause: X-3.2 / X-3.3 只能人工读代码（R），70 stage 时间紧时被跳过
layer: lint
layer_reason: 「有 async handler 却没有 toast / setError」「有 handleDelete 却没有 Popconfirm / confirm / 撤销」是共现关系，check-detail 可以确定性判断（WARN，允许父组件处理时写理由豁免）
artifacts: DETAIL-NO-RESULT-FEEDBACK, DETAIL-DANGER-NO-CONFIRM, X-3.2, X-3.3
regression: tests/fixtures/detail-bad.tsx
version: 2.1.0
```

## LRN-20261014-06 · 方向卡写得像任何一家公司

```learning
id: LRN-20261014-06
date: 2026-10-14
status: open
symptom: 20 产出的方向卡换掉 Logo 后对竞品同样成立
source: review
scenario: launch-visual
stage: 20-direction
occurrences: 1
root_cause: 竞品替换测试依赖主观判断
layer: style
layer_reason: 暂无可数的量；先保留在 A-01 的人工判据里，观察是否复发
why_not_code: 「方向是否只属于这个主体」需要理解业务语义，无法用正则或计数判断；复发时考虑把方向卡改成必填「主体名词」字段的结构化模板（structure 层）
artifacts: A-01
regression: -
```

## LRN-20261014-07 · 在真实代码上跑出误报与截断

```learning
id: LRN-20261014-07
date: 2026-10-14
status: landed
symptom: 在 lobehub/src/features 上跑 lint，LOBE-FIXED-WIDTH 命中 matchMedia('(min-width: 768px)') 和测试文件里的 { width: 1000 }；check-detail --json 经管道输出被截断成非法 JSON
source: system-scan
scenario: system-unify
stage: 60-system
occurrences: 1
root_cause: 规则只在自造 fixture 上验证过；脚本用 process.exit 结束导致管道缓冲未刷新
layer: lint
layer_reason: 误报模式可以确定性排除（media query、非 px 值、测试文件），并用 good fixture 锁住不再复发
artifacts: LOBE-FIXED-WIDTH, scripts/lint-lobe.mjs, scripts/check-detail.mjs
regression: tests/fixtures/bad-visual.tsx (命中) + tests/fixtures/good-visual.tsx (误报反例)
version: 2.1.0
```

## LRN-20261014-08 · 工作区只有一个入口，git 提交里却仍有 6 个

```learning
id: LRN-20261014-08
date: 2026-10-14
status: landed
symptom: 端到端验收发现 projects/*/SKILL.md × 5 只在工作区删除、从未提交；git HEAD 仍跟踪 6 个 SKILL.md，新 clone 出来就是 6 个 skill
source: review
scenario: -
stage: 30-structure
occurrences: 1
root_cause: single-entry 只扫描文件系统，不看 git 索引；工作区状态掩盖了提交状态
layer: structure
layer_reason: 「提交树中只有一个 SKILL.md」可以用 git ls-files 机械判断，放进 check-structure.mjs 的 single-entry-git，并提交删除
artifacts: scripts/check-structure.mjs
regression: scripts/check-structure.mjs single-entry-git
version: 2.1.2
```

## LRN-20261014-09 · 组件约束过死：业务组合件被硬套通用组件

```learning
id: LRN-20261014-09
date: 2026-10-14
status: landed
symptom: 「必须用 base-ui」被当成全局铁律，chat 这类业务组合件也去套库里的通用组件，再打一堆覆盖补丁；同时有人在项目里重写 Button / Table
source: user-correction
scenario: operate-build
stage: 30-structure
occurrences: 2
previous_layer: rule
root_cause: C-01 把「原子层必须取用」写成了没有边界的硬性规则，没有声明组合层该自建；模型只能两个方向都错
layer: lint
layer_reason: 「重新实现了原子层」可以用声明形态确定性识别（`(export )?(const|function) Button|Modal|Table|Input…`），实现为 WARN 并附 good fixture 反例；分层判据本身留在 C-11
artifacts: LOBE-REIMPLEMENT-ATOM, C-11, C-01, C-02, scripts/lint-lobe.mjs
regression: tests/fixtures/bad-composite.tsx (命中) + tests/fixtures/good-composite.tsx (组合层自建不报)
version: 3.0.0
```

## LRN-20261014-10 · 抽象指令（体验不好 / 丑 / 难用）没有可执行内容就动手

```learning
id: LRN-20261014-10
date: 2026-10-14
status: landed
symptom: 用户说「体验不好」「丑」，Agent 直接开始改，改完双方都不知道算不算改好
source: user-correction
scenario: product-polish
stage: 40-flow
occurrences: 2
previous_layer: style
root_cause: 提示里只有「先理解业务」，没有把抽象说法归一化成「改哪里 + 看到什么算改好了」的机制
layer: structure
layer_reason: 归一化表可以放进 pipeline.json 的 intentSignals，由 route.mjs 在路由阶段执行，并新增 clarify 颗粒度强制追问——结构性保证，不依赖模型自觉
artifacts: scripts/intent.mjs, scripts/pipeline.json, stages/40-flow.md
regression: tests/run.mjs intent 小节（归一化 + clarify）
version: 3.0.0
```

## LRN-20261014-11 · reference 整份加载挤占注意力

```learning
id: LRN-20261014-11
date: 2026-10-14
status: landed
symptom: 只改一个间距，也要把 48KB 的 components.md 读进上下文；当前场景无关的条目占据注意力
source: user-correction
scenario: -
stage: 50-visual
occurrences: 1
root_cause: stage 的「只加载」只声明到文件级，没有声明到条目级
layer: structure
layer_reason: tidier 的做法是把加载粒度写进文件自身的 refs:meta 块（tier + entries + triggers），由 refs.mjs 解析、check-structure.mjs 校验，属于结构层
artifacts: scripts/refs.mjs, references/*.md, scripts/check-structure.mjs, SKILL.md
regression: scripts/check-structure.mjs refs-meta + tests/run.mjs refs 小节
version: 3.0.0
```

## LRN-20261014-12 · 新项目每次会话都要重新解释纪律

```learning
id: LRN-20261014-12
date: 2026-10-14
status: landed
symptom: 消费方项目没有 AGENTS.md，每个新会话都要重新交代入口、加载纪律和纠正往哪记；纠正只活在当次对话里
source: user-correction
scenario: -
stage: 05-init
occurrences: 2
previous_layer: rule
root_cause: skill 只描述了「进入某个 stage 之后怎么做」，没有定义「怎么被这个项目发现」
layer: structure
layer_reason: 新增 05-init stage + bootstrap 场景 + scripts/bootstrap.mjs，用托管块做幂等块级写入，块外内容不变由 tests 锁住
artifacts: stages/05-init.md, references/init.md, scripts/bootstrap.mjs, scripts/pipeline.json
regression: tests/run.mjs bootstrap 小节（块外内容不变 + 幂等 + --check）
version: 3.0.0
```

## LRN-20261014-13 · 通用经验回流会带进品牌印记与小众场景

```learning
id: LRN-20261014-13
date: 2026-10-14
status: landed
symptom: 消费方把自己的项目级经验直接提给上游仓库，里面混着内部代号和只对本项目成立的场景
source: user-correction
scenario: -
stage: 80-review
occurrences: 1
root_cause: 「回流」只有口头约定，没有机械判据，也没有筛掉品牌印记的手段
layer: structure
layer_reason: 五条回流判据（landed + 版本 / 层在前三层 / occurrences ≥ 2 / 无品牌词 / 字段齐全）都是机械判断，但落地物是一个筛选脚本 + 契约文档（不是 lint 规则本身），所以落在 structure 层：让不合格的条目不可能被提出来
artifacts: scripts/upstream.mjs, CONTRIBUTING.md
regression: tests/run.mjs upstream 小节（品牌词条目被挡、通用条目放行）
version: 3.0.0
```

## LRN-20261014-14 · 会话页（LobeHub 核心页面类型）没有场景可接

```learning
id: LRN-20261014-14
date: 2026-10-14
status: landed
symptom: 「做一个 Agent 会话页」落到模糊指令，给不出 pipeline；而它和后台列表页一样是有主任务区的构建型页面
source: review
scenario: operate-build
stage: 40-flow
occurrences: 1
root_cause: operate-build 的信号词只覆盖后台 / 看板 / 表单 / 工作流，漏了对话类；agent / 会话 / 消息流这些词当时只在 components.md 的 C-04 里出现，没有进路由
layer: structure
layer_reason: 场景信号表在 pipeline.json，属于结构层的输入；补词 + 配 route-case 是唯一能保证可复现的做法
artifacts: scripts/pipeline.json, tests/route-cases.json, stages/40-flow.md
regression: tests/route-cases.json（做一个 Agent 会话页 / 开发一个对话页面）
version: 3.0.1
```

## LRN-20261014-15 · 模型词挂在 stage keywords 上导致双重与不可达

```learning
id: LRN-20261014-15
date: 2026-10-14
status: landed
symptom: 「双钻」和「格式塔」都进不了正确的 stage：前者同时挂 00/40 命中两个、落成 medium；后者（只归 00）永远解析不到，落成模糊指令。点名 00 自己的规则时还会排出一个多余的 @selfcheck
source: user-correction
scenario: -
stage: 00-brief
occurrences: 2
previous_layer: rule
root_cause: 把模型的口语说法当成普通关注点关键词塞进了 stage.keywords，但（a）00-brief 被排除在 concernTable 之外，（b）一个模型可以挂多个 stage，关键字通道天然是一对多的
layer: structure
layer_reason: 新增 modelSignals（词 → 规则 id）由路由器第 1 步解析，归属唯一仍由 ruleOwners 决定；check-structure.mjs 增加 model-signals / model-signals-dual 两条校验，从结构上排除「模型词又混回 keywords」和「指向无归属 id」
artifacts: scripts/pipeline.json, scripts/route.mjs, scripts/check-structure.mjs, tests/route-cases.json
regression: tests/route-cases.json（8 个模型词各一条 + 双钻只归 00）
version: 3.0.1
```

## LRN-20261014-16 · 备份与临时验证脚本会随仓库一起腐化

```learning
id: LRN-20261014-16
date: 2026-10-14
status: landed
symptom: 仓库根堆了 786MB 的 temp/ 参考 clone、已被 git tag 覆盖的 .backup/ 归档、12 个 .verify-*.sh|.out.txt 临时脚本；README 是开发者笔记，新用户不知道从哪开始
source: user-correction
scenario: -
stage: 05-init
occurrences: 1
root_cause: 没有仓库级的 .gitignore 和安装入口，验证脚本靠「先写一个再删」的临时习惯维护，没人负责收口
layer: structure
layer_reason: 删掉冗余 + 加 .gitignore/install.sh/CI，把 bootstrap 的文件系统级验收折进 tests/run.mjs —— 让验证成为回归的一部分而不是外部脚本
artifacts: .gitignore, install.sh, .github/workflows/ci.yml, tests/run.mjs
regression: tests/run.mjs bootstrap 小节（落盘 + 块外逐字保留 + 幂等 + --check 三种语义）
version: 3.0.1
```

## LRN-20261014-17 · 消费方回流（3.1.0）

```learning
id: LRN-20261014-17
date: 2026-10-14
status: landed
symptom: 图标按钮、开关、下拉写了 aria-label，读屏里仍是无名控件或名字读两遍
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: 部分原子件只解构固定 props，aria-* 被静默丢掉；规则里只说了要写 aria-label，没说写在哪里才生效
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-12
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-18 · 消费方回流（3.1.0）（4.0.0 移除 C-13：非设计，改 rejected）

```learning
id: LRN-20261014-18
date: 2026-10-14
status: rejected
symptom: Alert 只剩一句通用标题，这次的具体内容不见了
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: 废弃 prop 与新 prop 同时传时组件只认新 prop，规则没有提到迁移期的覆盖关系
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-13
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-19 · 消费方回流（3.1.0）（5.0.0 移除 C-14：组件问题，归 lobe-ui，改 rejected）

```learning
id: LRN-20261014-19
date: 2026-10-14
status: rejected
symptom: 下拉选中后触发器空白、搜索下拉服务端有结果却显示未找到、小数显示成 0
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: Select 空值语义、AutoComplete 只按 value 过滤、InputNumber 默认精度都没有写进选型规则
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-14
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-20 · 消费方回流（3.1.0）（5.0.0 精简 C-15：组件接线部分移除，只留设计判据）

```learning
id: LRN-20261014-20
date: 2026-10-14
status: landed
symptom: 命令式确认弹窗调用后没有界面、按钮是英文 OK、请求未完成弹窗就关闭；面板里的二级菜单一按就关掉父面板
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: 命令式弹窗需要 Host、onOk 等待 Promise、浮层 portal 冒泡与嵌套关闭这些接线规则缺失
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-15
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-21 · 消费方回流（3.1.0）（5.0.0 移除 C-16：组件问题，归 lobe-ui，改 rejected）

```learning
id: LRN-20261014-21
date: 2026-10-14
status: rejected
symptom: 工具栏控件各占一行、Grid 列数不对、一句话被拆成几行、页签贴着下方内容
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: 原子件的默认宽度、Grid rows 含义、Text 默认块级、Tabs 无外边距没有成文
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-16
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-22 · 消费方回流（3.1.0）（5.0.0 精简 C-17：组件接线部分移除，只留设计判据）

```learning
id: LRN-20261014-22
date: 2026-10-14
status: landed
symptom: 独立字段报缺少 Form 上下文，重置后控件仍显示旧值
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: 选型表只写了 Form 骨架，没有区分独立字段与非受控控件的重置方式
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-17
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-23 · 消费方回流（3.1.0）

```learning
id: LRN-20261014-23
date: 2026-10-14
status: landed
symptom: 想要命令面板时找不到组件，或把 SearchBar 的 mod+k 当成打开弹层
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: 选型表把 SearchBar 写成带 spotlight 的搜索，C-05 没有列命令面板
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/components.md, C-02, C-05
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-24 · 消费方回流（3.1.0）

```learning
id: LRN-20261014-24
date: 2026-10-14
status: landed
symptom: 加载失败显示成 0 条或空态，加载中同时写着没有数据，同一个失败既画在区块上又弹 toast
source: review
scenario: -
stage: 70-detail
occurrences: 4
root_cause: K-05 只列了四种状态要回答的问题，没有写实现时最常见的三种伪装
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/craft.md, K-05, stages/70-detail.md
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-25 · 消费方回流（3.1.0）

```learning
id: LRN-20261014-25
date: 2026-10-14
status: landed
symptom: 面板里的卡片或代码块高度被压成 0，列不再滚动
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: K-10 没有覆盖定高纵向 flex 对 overflow 非 visible 子项的压缩
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/craft.md, K-10
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-26 · 消费方回流（3.1.0）

```learning
id: LRN-20261014-26
date: 2026-10-14
status: landed
symptom: 中文界面的空图表显示英文 No Data，厂商徽标是灰色插头或换成别的品牌
source: review
scenario: -
stage: 30-structure
occurrences: 4
root_cause: E-01 已知坑缺 NoData 默认文案与 loading；E-03 没写业务 id 要先折成映射关键字
layer: rule
layer_reason: 需要结合场景判断组件用法，无法用单行正则确定性识别，先落在 references 编号规则并挂进所属 stage 的症状表
artifacts: references/ecosystem.md, E-01, E-03
regression: scripts/check-structure.mjs no-dangling-ids
version: 3.1.0
```

## LRN-20261014-27 · 重排回流：不工作的控件与审核队列顺序（5.0.0）

```learning
id: LRN-20261014-27
date: 2026-10-14
status: landed
symptom: 切换后画面不变的控件、没接数据的占位图、重复出现的同一个数留在页面上；审核队列按创建时间倒序，最早的提交沉到最后一页
source: review
scenario: archetype
stage: 40-flow
occurrences: 2
root_cause: W-07 只问「服务哪个决定」，没有点名不工作的界面元素；P-06 只写「按提交时间或优先级」，没有写方向
layer: rule
layer_reason: 需要结合页面目的判断，无法用正则确定性识别；落在 W-07 / P-06 并由 40-flow 处理
artifacts: references/copy.md, W-07, references/admin-archetypes.md, P-06
regression: scripts/check-structure.mjs no-dangling-ids
version: 5.0.0
```

## LRN-20261014-28 · 重排回流：部分失败只重试失败的查询（5.0.0）

```learning
id: LRN-20261014-28
date: 2026-10-14
status: landed
symptom: 多查询拼成的页面里一个查询失败，整页显示红字或整页重刷，已成功的数据也被清掉
source: review
scenario: -
stage: 70-detail
occurrences: 2
root_cause: K-05 讲了整块失败与已有数据的刷新失败，没有讲同一页多个查询的部分失败
layer: rule
layer_reason: 是否部分失败取决于数据来源的拆分，无法用正则确定性识别；落在 K-05
artifacts: references/craft.md, K-05
regression: scripts/check-structure.mjs no-dangling-ids
version: 5.0.0
```

## LRN-20261014-29 · lint 误报：token 字体与不可聚焦 SVG 的 outline（5.0.0）

```learning
id: LRN-20261014-29
date: 2026-10-14
status: landed
symptom: fontFamily 写 inherit 或 cssVar 三元时被报 LOBE-FONT-FAMILY；地图 SVG path 上的 outline: none 被报 LOBE-OUTLINE-NONE
source: review
scenario: -
stage: 70-detail
occurrences: 2
root_cause: LOBE-FONT-FAMILY 只认紧跟冒号的 cssVar；LOBE-OUTLINE-NONE 逐行匹配，不看元素是否可聚焦、是否已有 :focus-visible 替代
layer: lint
layer_reason: 取值来源与所在样式块都能机械判断：按值分支判断 token / 继承，按样式块判断 SVG 图形与替代指示
artifacts: LOBE-FONT-FAMILY, LOBE-OUTLINE-NONE, scripts/lint-lobe.mjs
regression: tests/fixtures/bad-focus.tsx（good-fp-copyable.tsx / good-fp-model.tsx / good-outline.tsx 锁误报）
version: 5.0.0
```

## LRN-20261015-01 · 比较画面只给差值或只给两个值，评测控制台缺原型（5.1.0）

```learning
id: LRN-20261015-01
date: 2026-10-15
status: landed
symptom: 比较两次结果的画面只给差值或只给两个数，不写对齐口径；评测 / 实验控制台没有对应原型，计数、矩阵、失败归因各页各画
source: review
scenario: operate-build
stage: 50-visual
occurrences: 1
previous_layer:
root_cause: 规则缺失：K-08 只管图表本身，P-01 只管看板的基准，没有通用的比较判据，也没有评测类控制台的原型
layer: rule
layer_reason: 是否给了基准、口径和差异筛选要读页面结构判断，无法用正则确定性识别；通用部分落 K-11，评测专属部分落 P-09
artifacts: references/craft.md, K-11, references/admin-archetypes.md, P-09
regression: scripts/check-structure.mjs no-dangling-ids
version: 5.1.0
```

## LRN-20261016-01 · 规则仍按 lobe-ui 5.x 的导入入口与主题写法（5.3.0）

```learning
id: LRN-20261016-01
date: 2026-10-16
status: landed
symptom: 规则、示例和 lint 仍要求从 @lobehub/ui/base-ui 导入、用 antd-style 写样式、用 ThemeProvider 定主色与外观，lint 只拦 --ant-* 覆盖，看不到 --lobe-* 覆盖和 antd-style 导入
source: system-scan
scenario: product-polish
stage: 30-structure
occurrences: 1
previous_layer:
root_cause: lobe-ui 6 只有 @lobehub/ui 根入口（另有 /form、/pro-table），样式 API 与主题都在 lobe-ui 内部，主题变量前缀是 --lobe-；规则与 lint 的入口判断没有跟上
layer: lint
layer_reason: 导入来源与 !important 覆盖变量都能按源码机械判断：LOBE-ANTD-IMPORT 改为拦任何 antd / antd-style 导入，LOBE-FORM-ENTRY 只认 @lobehub/ui/form，LOBE-ANT-VAR-OVERRIDE 同时覆盖 --lobe-*
artifacts: LOBE-ANTD-IMPORT, LOBE-FORM-ENTRY, LOBE-ANT-VAR-OVERRIDE, scripts/lint-lobe.mjs, references/components.md, references/design.md
regression: tests/fixtures/bad.tsx
version: 5.3.0
```

## LRN-20261016-02 · 界面文案没有按产品类型分口吻，中文排版无人负责（5.4.0）

```learning
id: LRN-20261016-02
date: 2026-10-16
status: landed
symptom: 后台、开发者平台和 C 端聊天用同一套口吻改文案；中英文之间缺空格、中文里夹半角标点没人检查；文案只在 40 / 70 顺带处理
source: user-correction
scenario: product-polish
stage: 75-copy
occurrences: 1
previous_layer:
root_cause: W- 只规定文案要素，没有按产品类型区分语气、人称、术语与密度，也没有 zh-CN 排版规则与机械检查；把四套口吻塞进 40 又会每次整份加载
layer: structure
layer_reason: 新增 75-copy stage 与 tier profile（只加载选中的一份），由 pipeline.json、check-structure 的 refs-profile-owner 与 route-cases 锁住；排版中可正则判断的两条另落 lint（WARN）
artifacts: stages/75-copy.md, scripts/pipeline.json, scripts/refs.mjs, scripts/check-structure.mjs, references/copy-core.md, LOBE-CJK-LATIN-SPACE, LOBE-HALFWIDTH-PUNCT
regression: tests/route-cases.json, tests/fixtures/bad-copy.tsx
version: 5.4.0
```
