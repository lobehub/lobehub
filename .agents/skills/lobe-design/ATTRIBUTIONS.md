# 出处与许可

本技能的部分方法改写自下列第三方作品。正文只保留可执行的设计规则；出处、许可、钉扎提交与改编对应关系集中在此文件。执行任务不必读取。许可全文与 Apache NOTICE 在 `licenses/`。

下列改编均已按 Lobe 主题、组件分层与既有规则改写，不把外部作品的工具链、字体表、色板、硬阈值或动效参数表拷进本目录。除另有说明外，改编段落不因本仓库的 MIT 许可而被重新许可，仍按其原许可使用。

## Taste Skill

- 作品：Taste Skill（方向来自主体、字阶少而远、带日期的反 AI 味清单、截图评审）
- 对应：`stages/00-brief.md` 的 subject 模式；`stages/20-direction.md`；`references/aesthetics.md` 的 A-01 / A-02 / A-04；`stages/80-review.md` 的 critique 模式。Taste 的 house rules（全面禁渐变、禁阴影、禁 1px 边框、禁玻璃）未照搬，因与 Lobe 表面体系冲突，见 A-07。

## Impeccable

- 作品：[Impeccable](https://github.com/pbakaus/impeccable)
- 许可：[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)，Copyright 2025 Paul Bakaus
- 钉扎提交：[`ec229b48547f24685ffb22aa51c462c5ae27908c`](https://github.com/pbakaus/impeccable/commit/ec229b48547f24685ffb22aa51c462c5ae27908c)
- 通知：[NOTICE-impeccable.md](licenses/NOTICE-impeccable.md)
- 许可全文：[LICENSE-impeccable.txt](licenses/LICENSE-impeccable.txt)
- 这些段落仍按 Apache License 2.0 使用。
- 对应：
  - `stages/40-flow.md`：简化、澄清、首次到达；检查清单第 11 条（其 distill）
  - `stages/60-system.md`：先盘点漂移再分诊派发；四类漂移
  - `stages/70-detail.md`：按清单加固细节
  - `stages/80-review.md`：五项技术体检
  - `references/craft.md`：K-01 加力 / 收束与原生选择态、焦点、输入反馈检查；K-01「彩底不用灰字」；K-09 表达强度
  - `references/copy.md`：W-04 首次使用的三项要素、用户清空与无权限分型；W-07 简化判据

未引入其 live、generate 或检测 CLI，不要求另装引擎，也未纳入其 ios、android 平台参考。

## unslop

- 作品：Damir Sokolovsky（[@heydamir](https://x.com/heydamir)）的 [unslop](https://github.com/heydamir/unslop)
- 许可：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 钉扎提交：[`97daa3eb365670ea3f87ed85356cbfcee18105a5`](https://github.com/heydamir/unslop/commit/97daa3eb365670ea3f87ed85356cbfcee18105a5)
- 这些段落仍按 CC BY 4.0 使用。
- 对应：
  - `references/aesthetics.md`：A-01 气质、产品意象、签名细节；A-04.16–.19
  - `references/craft.md`：K-01 改动范围与「重要内容 / 通用控件」；K-06 / K-08 的短补
  - `references/copy-core.md`：标题招呼的判据（已按既有句式规则改写；感叹号仍只遵循 T-03，不一刀切禁止）

未拷贝其 token 色板、字体清单或工具链。

## oil-ui

- 作品：[oil-ui](https://github.com/oil-oil/oil-ui)
- 许可：[MIT License](https://github.com/oil-oil/oil-ui/blob/28948c3d88e5d141fa0e943ff385560c5ffba979/LICENSE)，Copyright 2026 oil-oil
- 钉扎提交：[`28948c3d88e5d141fa0e943ff385560c5ffba979`](https://github.com/oil-oil/oil-ui/commit/28948c3d88e5d141fa0e943ff385560c5ffba979)
- 许可全文：[LICENSE-oil-ui.txt](licenses/LICENSE-oil-ui.txt)
- 对应：
  - `stages/00-brief.md` 检查清单第 10–11 条
  - `stages/20-direction.md` 检查清单第 9–11 条
  - `stages/30-structure.md` 检查清单第 8–9 条
  - `stages/50-visual.md` 检查清单第 13–15 条
  - `stages/80-review.md` 检查清单第 11–14 条

未吸收其风格对比页生成器、截图 / 生图 / 测量 / 更新检查工具链、`.oil-ui/` 工作区约定、独立评审打分流程、字体表、色板、动效时长与弹簧参数表。

## Pretzel Interface 及相关短方法

下列作品均为 MIT。未吸收 canvas-design 的出图 / PDF 工具链、prototype 的现场选择器、extract-design-system 的抽 token 工具链，也不搬硬阈值、字体表或色板。

### Vercel Web Interface Guidelines

- 作品：[vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines)，Copyright 2025 Vercel Labs
- 钉扎提交：[`434b7f91364665f2f733b310ec54809bf8f37937`](https://github.com/vercel-labs/web-interface-guidelines/commit/434b7f91364665f2f733b310ec54809bf8f37937)
- 对应：`stages/40-flow.md` 检查清单第 12 条；`references/craft.md` K-02 中 `text-wrap: balance` / `pretty` 的使用注意；`references/detail-checklist.md` X-3.8–X-3.11（部分）、X-5.9、X-6.5（部分）

### ui-skills（improve-ui / baseline-ui）

- 作品：Julien Thibeaut 的 [ibelick/ui-skills](https://github.com/ibelick/ui-skills)
- 钉扎提交：[`97dea9e747ea94d5671ef1468cbb8f9bd5f32542`](https://github.com/ibelick/ui-skills/commit/97dea9e747ea94d5671ef1468cbb8f9bd5f32542)
- 对应：`stages/80-review.md` 检查清单第 9 条（improve-ui）；`references/detail-checklist.md` X-5.9 与 X-6.5（baseline-ui，部分）

### extract-design-system

- 作品：Arvind Ram Singh Kishore 的 [extract-design-system](https://github.com/arvindrk/extract-design-system)
- 钉扎提交：[`1873741ba8dea755e35e6e15134f7918cd58e036`](https://github.com/arvindrk/extract-design-system/commit/1873741ba8dea755e35e6e15134f7918cd58e036)
- 对应：`stages/80-review.md` 检查清单第 10 条的安全边界（取值映射到宿主主题，不从外部网站抽取色板或字体覆盖已有系统）

### make-interfaces-feel-better

- 作品：[Jakub Krehel 的 make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better)，Copyright 2026 Jakub Krehel
- 钉扎提交：[`35545ea1512ad59fa463e6b1f95ca9c052981fe6`](https://github.com/jakubkrehel/make-interfaces-feel-better/commit/35545ea1512ad59fa463e6b1f95ca9c052981fe6)
- 对应：`stages/70-detail.md` 检查清单第 12 条的回放核验（部分）；`references/craft.md` K-02 的 `text-wrap` 注意、K-03 阴影与描边的职责；`references/detail-checklist.md` X-3.8–X-3.11（部分）

### design-eng

- 作品：[Emil Kowalski 的 design-eng](https://github.com/emilkowalski/skills)，Copyright 2026 Emil Kowalski
- 钉扎提交：[`715c1807e08c497cfd1dc4feb450a2a3300ef2a9`](https://github.com/emilkowalski/skills/commit/715c1807e08c497cfd1dc4feb450a2a3300ef2a9)
- 对应：`stages/70-detail.md` 检查清单第 12 条的回放核验（部分）；`references/detail-checklist.md` X-3.8–X-3.11（部分）

### oklch-skill

- 作品：[Jakub Krehel 的 oklch-skill](https://github.com/jakubkrehel/oklch-skill)，Copyright 2026 Jakub Krehel
- 钉扎提交：[`0e81f040e16d48fcc61d3e1b7ea548542371321f`](https://github.com/jakubkrehel/oklch-skill/commit/0e81f040e16d48fcc61d3e1b7ea548542371321f)
- 对应：`references/craft.md` 向上游谈新色时按感知明度推理的一句。不引入色板、硬阈值，也不把应用层改写成 `oklch()`。

## Tech-Doc-Style-Chinese

- 作品：[Tech-Doc-Style-Chinese](https://github.com/Fenng/Tech-Doc-Style-Chinese)，MIT，作者 Fenng
- 对应：`stages/75-copy.md` 与 `references/copy-core.md` 的排版、术语与优先级（仅覆盖界面短文案；长篇文档仍请直接使用原 skill）。
