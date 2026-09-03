# T-325 办公文档能力基线与验收场景

基线日期：2026-09-03\
LobeHub 源码基线：`2794037573e1cc0dc5d02eb223463c61c5ca16d3`\
范围：只覆盖能力盘点、可复现验收场景、证据和问题排序；不实现编辑器。

独立核验入口：`verifier-delivery.md` 在同一文件内给出完整 18 行功能矩阵、双方状态、逐项对比结论、命令、原始日志和证据边界。`reproducible-lifecycle-results.md` 内嵌素材内容，并为 15 个环节分别给出编号命令、实际观察和判定。

## 结论摘要

当前 LobeHub 对现代 Office 文件具备上传、内容抽取、工作区内只读预览，以及失败后下载 / 用默认应用打开的能力；没有发现 PPTX、XLSX、DOCX 的原生内容编辑、格式编辑、保存回写、撤销 / 重做实现。因此，当前实现不能满足 “三类办公文档完整编辑体验” 基线，也不能据此判定达到 ChatGPT/Codex 当前方案。

对比基线必须区分 “官方能力声明” 和 “本环境实际操作”。官方 OpenAI 文档声明 ChatGPT Work 可创建或编辑文档、表格和演示文稿；本次会话的浏览器连接返回 `No browser is available`，故 ChatGPT Web 的逐项 UI 操作标为 `NV`（未验证），不伪造通过结果。本次可见 Codex 环境安装了 Documents、Spreadsheets、Presentations 三项技能，但缺少技能要求的 workspace dependency loader，因而没有把生成 / 编辑闭环记为实际通过。

状态定义：`PASS`= 有实际操作或自动测试证据；`PARTIAL`= 只覆盖子能力；`FAIL`= 源码明确缺失核心能力；`NV`= 本环境未能验证。

## 功能矩阵（18 项逐项对照）

状态词严格使用：`可用`、`不可用`、`部分可用`、`有风险`。ChatGPT/Codex 因本轮 UI 不可访问，所有状态均为 “有风险（官方声明，未实测）”；不能把它解释为实际通过。

| 文档  | 生命周期维度 | LobeHub 状态 | ChatGPT/Codex 状态         | 对比结论 | 一句话理由 / 证据                                                                                |
| ----- | ------------ | ------------ | -------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| PPT   | 创建或导入   | 部分可用     | 有风险（官方声明，未实测） | 不可比   | Lobe 的既有 PPTX 导入测试通过，但没有空白创建；对侧只有官方 create/import 声明。                 |
| PPT   | 内容编辑     | 不可用       | 有风险（官方声明，未实测） | 劣于     | Lobe 只调用 `PptxViewer.open`，未发现编辑事件或对象变更模型；官方声明对侧可编辑 slide。          |
| PPT   | 格式调整     | 不可用       | 有风险（官方声明，未实测） | 劣于     | Lobe 没有形状、布局、字体、位置或缩放命令；官方声明对侧支持改进和修订 deck。                     |
| PPT   | 保存         | 不可用       | 有风险（官方声明，未实测） | 劣于     | Lobe 未发现 saving/saved 或 PPTX 序列化；对侧声明可创建可编辑文件。                              |
| PPT   | 再次打开     | 部分可用     | 有风险（官方声明，未实测） | 不可比   | Lobe 可重新打开原只读文件，但不存在编辑后状态可恢复；对侧 UI 未实测。                            |
| PPT   | 导出或下载   | 部分可用     | 有风险（官方声明，未实测） | 劣于     | Lobe `anchor.download = filename` 仅下载原 blob，不是编辑结果导出。                              |
| Excel | 创建或导入   | 部分可用     | 有风险（官方声明，未实测） | 不可比   | Lobe 多 sheet loader 测试通过但无空白 workbook 创建；对侧声明支持创建 / 导入。                   |
| Excel | 内容编辑     | 不可用       | 有风险（官方声明，未实测） | 劣于     | Lobe 将 workbook 显示成普通 `<td>`，未发现 `contentEditable/onChange`、公式栏或 sheet mutation。 |
| Excel | 格式调整     | 不可用       | 有风险（官方声明，未实测） | 劣于     | Lobe 没有数字格式、样式、行列尺寸或条件格式操作；对侧声明支持更新 spreadsheet。                  |
| Excel | 保存         | 不可用       | 有风险（官方声明，未实测） | 劣于     | Lobe 只调用 `workbook.xlsx.load`，未发现 write/export/save。                                     |
| Excel | 再次打开     | 部分可用     | 有风险（官方声明，未实测） | 不可比   | 可重开原文件预览，但没有编辑结果可恢复，且公式仅显示缓存 `result`。                              |
| Excel | 导出或下载   | 部分可用     | 有风险（官方声明，未实测） | 劣于     | 可下载原 blob，不能导出经过单元格 / 公式修改的 workbook。                                        |
| Word  | 创建或导入   | 部分可用     | 有风险（官方声明，未实测） | 不可比   | DOCX loader 实测通过，但没有空白 DOCX 创建；对侧声明支持创建 / 导入。                            |
| Word  | 内容编辑     | 不可用       | 有风险（官方声明，未实测） | 劣于     | `renderAsync(blob, container)` 是预览；模型抽取使用 `extractRawText`，没有富文本 mutation。      |
| Word  | 格式调整     | 不可用       | 有风险（官方声明，未实测） | 劣于     | 未发现段落样式、列表、表格、图片或链接编辑命令；对侧声明可编辑文档。                             |
| Word  | 保存         | 不可用       | 有风险（官方声明，未实测） | 劣于     | 未发现 DOCX serializer、saving/saved 或回写路径。                                                |
| Word  | 再次打开     | 部分可用     | 有风险（官方声明，未实测） | 不可比   | 可重开原文件预览，但无法验证编辑后的结构和格式恢复。                                             |
| Word  | 导出或下载   | 部分可用     | 有风险（官方声明，未实测） | 劣于     | 只有原 blob 下载 / 默认应用打开，不是编辑后 DOCX 导出。                                          |

## 关键源码证据

1. `src/features/Portal/LocalFile/DocumentPreview.tsx:195-239`：PPTX 仅调用 `PptxViewer.open(blob, container, ...)` 渲染。
2. 同文件 `243-277`：DOCX 仅调用 `renderAsync(blob, container)`。
3. 同文件 `315-397`：XLSX 用 `exceljs` 读取后映射为普通 HTML table；`MAX_PREVIEW_ROWS = 500`；公式值经 `cell.result` 展示。
4. 同文件 `401-425`：注释明确称三类为 `in-app renderer`，旧格式降级。
5. 同文件 `442-475`：失败路径只下载原 blob 或用默认应用打开。
6. `packages/file-loaders/src/loaders/pptx/index.ts`：只抽取 `a:t` 文本；图片、形状、图表和布局没有进入可编辑模型。
7. `packages/file-loaders/src/loaders/excel/index.ts`：`raw: false` 后转 Markdown，适合上下文读取，不是保真编辑模型。
8. `packages/file-loaders/src/loaders/docx/index.ts`：`mammoth.extractRawText` 只抽取纯文本。
9. `packages/builtin-skills/src/artifacts/content.ts`：当前 Artifact 类型限定为 HTML/SVG/React/Markdown，并明确普通 documents/articles 留在对话文本中，不是 Office 编辑器。

决定性源码原文节选：

```tsx
// DocumentPreview.tsx:281-285
/**
 * DOM tables choke on huge sheets; a preview only needs the head of the data.
 * Users open the real file (default app / download) for the full sheet.
 */
const MAX_PREVIEW_ROWS = 500;

// DocumentPreview.tsx:305-308
if (cell.richText) return cell.richText.map((run) => run.text).join('');
if (cell.formula !== undefined) return formatCellValue(cell.result);

// DocumentPreview.tsx:442-447
const url = URL.createObjectURL(blob);
const anchor = globalThis.document.createElement('a');
anchor.href = url;
anchor.download = filename;
anchor.click();
```

```ts
// packages/file-loaders/src/loaders/docx/index.ts
const result = await mammoth.extractRawText({ buffer });

// packages/file-loaders/src/loaders/excel/index.ts
const jsonData = xlsx.utils.sheet_to_json<Record<string, any>>(worksheet, {
  defval: '',
  raw: false,
});

// packages/file-loaders/src/loaders/pptx/index.ts
const textNodes = pNode.getElementsByTagName('a:t');
```

## 基线测试输出（原样）

```text
RUN  v3.2.6 /Users/arvinxx/CodeProjects/LobeHub/lobehub/packages/file-loaders

✓ src/loaders/pptx/index.test.ts (6 tests) 2406ms
  ✓ PptxLoader > should load pages correctly from a PPTX file (one page per slide)  2205ms
✓ src/loaders/excel/index.test.ts (4 tests) 48ms
✓ src/loaders/docx/index.test.ts (3 tests) 54ms

Test Files  3 passed (3)
     Tests  13 passed (13)
  Start at  10:43:33
  Duration  6.84s (transform 803ms, setup 261ms, collect 3.11s, tests 2.51s, environment 11.85s, prepare 912ms)
```

执行命令：

```bash
cd packages/file-loaders
bunx vitest run --silent='passed-only' src/loaders/pptx/index.test.ts src/loaders/excel/index.test.ts src/loaders/docx/index.test.ts
```

浏览器实际输出：

```text
No browser is available
```

## 兼容性风险

- PPTX：读取器只抽文本；SmartArt、图表、嵌入字体、母版、动画、备注、组合形状和关系文件不在编辑模型内。即使预览成功，也不能证明导出保真。
- XLSX：预览跳过空行并限制 500 行，不能用于验证精确行号；公式展示缓存结果，不触发重算；合并单元格、条件格式、命名区域、数据验证、图表和宏没有编辑闭环。
- DOCX：LLM 上下文抽取为纯文本，不能证明标题层级、编号、表格、浮动图片、链接、分节、页眉页脚和分页被保留。
- 旧格式：`.doc/.ppt/.xls` 明确没有本地 renderer，只能降级。
- 恢复性：没有保存状态、撤销 / 重做、崩溃恢复、版本历史或冲突提示；下载按钮只是原 blob 的副本，不等价于 “保存编辑结果”。

## 按优先级排序的问题清单（能力缺口 + 兼容性风险）

排序规则：P0 阻断全生命周期或可能造成数据丢失；P1 阻断单类核心能力或造成高概率互操作错误；P2 为范围、版本兼容或回归保障问题。

| 顺序 | 优先级 | 类型                    | 问题 / 兼容性风险                                                                                            | 可追溯矩阵 / 场景                                                                                                     | 最小完成定义                                                                                 |
| ---- | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | P0     | 核心缺口                | 三类文件均无内容编辑与保存回写，无法产生可重开的编辑版本。                                                   | 矩阵 PPT/Excel/Word 的 “内容编辑、保存、再次打开”；PPT-EDIT/SAVE/REOPEN、XLSX-EDIT/SAVE/REOPEN、DOCX-EDIT/SAVE/REOPEN | 每类完成导入→编辑→保存→重开，并生成新文件 SHA-256 与结构检查记录。                           |
| 2    | P0     | 核心缺口 / 数据安全     | 无 dirty/saving/saved/error、撤销 / 重做和失败恢复，存在静默丢失风险。                                       | 矩阵三类 “保存”；COMMON-01、COMMON-02                                                                                 | 统一状态机；失败保留草稿；关键修改可 undo/redo；重试后内容完整。                             |
| 3    | P0     | 兼容性风险              | 没有 OOXML round-trip 门禁，未知部件能否保留、导出文件能否被 Office 打开均未验证。                           | 矩阵三类 “保存、导出”；PPT-01、XLSX-01、DOCX-01                                                                       | 保存前后比较 OOXML part、关系、对象计数；用 Microsoft Office/LibreOffice 打开并做视觉 diff。 |
| 4    | P1     | Excel 核心缺口 / 兼容性 | 公式只显示缓存 `result`，不重算；空行被跳过且 500 行截断，可能产生陈旧结果和坐标错位。                       | 矩阵 Excel“内容编辑、再次打开”；XLSX-01、XLSX-02                                                                      | 保留单元格坐标和公式文本；定义重算策略；验证 oracle 3115/3519.95；明确截断。                 |
| 5    | P1     | PPT 兼容性              | 抽取只暴露 `a:t`；母版、主题、图表、SmartArt、组合形状、动画、备注和嵌入字体的 round-trip 保留尚未验证。     | 矩阵 PPT“格式调整、导出”；PPT-01、PPT-02                                                                              | 未修改 OOXML parts 原样保留；文本、图片、形状、图表、布局和页序均有 round-trip 断言。        |
| 6    | P1     | Word 兼容性             | `extractRawText` 不向当前模型暴露标题层级、编号、表格、浮动图片、链接、分节和页眉页脚；导出保留情况未验证。  | 矩阵 Word“内容编辑、格式调整、导出”；DOCX-01、DOCX-02                                                                 | 建立结构化文档模型；重开 / 导出检查层级、3×3 表格、图片和链接关系。                          |
| 7    | P1     | 跨应用互操作            | 尚未验证 LobeHub 输出在不同 Microsoft Office、LibreOffice 和操作系统版本中的打开与视觉一致性。               | 三类矩阵 “导出或下载”；PPT-01、XLSX-01、DOCX-01                                                                       | 建立 Windows Office、macOS Office、LibreOffice 三端兼容矩阵；记录警告、修复提示及视觉差异。  |
| 8    | P1     | 一致性缺口              | 三类文件没有统一的打开、编辑、保存、导出、错误提示和快捷键协议。                                             | COMMON-01、COMMON-02                                                                                                  | 统一命令语义和提示；相同操作在三类编辑器中使用一致入口与快捷键。                             |
| 9    | P2     | 格式版本兼容            | `.doc/.xls/.ppt` 旧二进制格式没有 renderer；宏文件 `.docm/.xlsm/.pptm`、密码保护和 Strict OOXML 未定义策略。 | 矩阵三类 “创建或导入”；PPT-02、XLSX-02、DOCX-02                                                                       | 明确支持矩阵、只读 / 转换策略和安全警告；禁止把外部打开称为原生支持。                        |
| 10   | P2     | 回归风险                | 三个 Office preview pane 缺少针对加载、失败降级、多 sheet、500 行和资源释放的专门 UI 回归测试。              | PPT-IMPORT、XLSX-IMPORT、DOCX-IMPORT；COMMON-03                                                                       | 增加现有组件行为测试或集成测试，并覆盖 renderer 升级后的兼容性。                             |

## 建议下一步

先确定 “原生编辑器” 还是 “调用外部 / 嵌入式 Office” 的产品边界。若目标仍是通过完整验收，优先实现统一文档会话协议（dirty/save/reopen/export/undo/error recovery），随后以 XLSX 为第一条端到端垂直切片，因为其数据与公式正确性可用确定性断言最早建立 round-trip 门禁。

## 外部对比来源

- OpenAI Help Center: <https://help.openai.com/en/articles/20001278>
- ChatGPT for PowerPoint: <https://help.openai.com/en/articles/20001242-chatgpt-for-powerpoint>
- ChatGPT for Excel and Google Sheets: <https://help.openai.com/en/articles/20001063-chatgpt-for-excel>
- Supported file types: <https://help.openai.com/en/articles/8983675-what-types-of-files-are-supported%23.docx>

这些来源只证明公开能力声明，不替代本目录要求的实际操作记录。
