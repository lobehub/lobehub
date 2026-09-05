# T-325 能力基线与验收场景 — 第 4 轮独立核验交付

基线代码：LobeHub worktree `feat/t-324-office-baseline` @ `950d3cd8cd`（2026-09-05 实测）。与第 2 轮基线（`2794037573`，只读预览）相比，本轮代码已包含 `src/features/FileViewer/Renderer/{PPTX,XLSX,DOCX}` 三个 Office 编辑器，基线随之重测。第 2 轮交付 `verifier-delivery.md` 保留为历史记录。

状态标注：**支持**（本轮实测通过）/ **部分支持**（部分实测通过或有明确边界）/ **不支持**（无实现）/ **未验证**（有入口但本轮未实测，或环境不可达）。

所有证据文件位于 `artifacts/t-325-office-baseline/r4/`（竞态对照组在 `r4-race/`），SHA-256 见附录 A；复现脚本为 `docs/development/t-325-office-baseline/run-editor-roundtrip.mjs`。

## 一、完整功能矩阵（3 文档 × 5 阶段）

对比列说明：ChatGPT/Codex 本轮可达浏览器但无账号会话，`chatgpt.com` 返回登录墙（截图 `chatgpt-login-wall.png`、`codex-login-wall.png`），全部标 **未验证**；对比结论只能基于 OpenAI 官方声明（ChatGPT Work 可 "create or edit documents, spreadsheets, presentations"，PowerPoint 高级 chart/shape/formatting 受限 — help.openai.com/en/articles/20001278、20001242、20001063），故为"声明基线对比"。

| 文档 | 阶段 | LobeHub 状态 | ChatGPT/Codex | 对比结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| PPT | 创建或导入 | 部分支持：既有 PPTX 导入并渲染 2 页实测通过；无空白新建入口 | 未验证（声明支持创建） | 导入侧 LobeHub 有实测、对侧仅声明；创建侧 LobeHub 缺口 | E1、pptx-1-import.png |
| PPT | 编辑 | 部分支持：新增文本/形状/图表、复制幻灯片、undo/redo 实测通过；移动/缩放/删除元素入口存在未实测；**快速连续操作会丢失编辑（P0-1）** | 未验证（声明支持编辑，高级格式受限） | 串行操作下 LobeHub 有实测证据强于对侧声明；可靠性有 P0 缺陷 | E2、E8、pptx-2-edited.png |
| PPT | 保存 | 部分支持：保存为浏览器 IndexedDB 草稿实测通过（Unsaved→Saved）；**不回写原文件或云端（P0-2）** | 未验证（声明文件可保存复用） | 语义不同：LobeHub 是本地草稿，非文件回写 | E3、pptx-3-saved.png |
| PPT | 再次打开 | 部分支持：整页重载后草稿恢复（3 页与新增内容保持）；**重开后状态误显 "Unsaved changes"（P1-4）** | 未验证 | LobeHub 有实测恢复证据 | E4、pptx-4-reopened.png |
| PPT | 导出/下载 | 支持：导出新 PPTX（SHA 与输入不同），zip 完整、3 页、marker/形状/chart1.xml 断言通过，QuickLook 可打开渲染 | 未验证（声明可生成 PPTX） | LobeHub 有实测导出与独立解析证据 | E5、E6、qlpreview/ |
| Excel | 创建或导入 | 部分支持：多 sheet XLSX 导入渲染实测通过（2 sheet + 网格）；无空白新建入口 | 未验证（声明支持创建） | 同 PPT | E1、xlsx-1-import.png |
| Excel | 编辑 | 部分支持：单元格写入、公式 `=2*3+4` 即时计算为 10、加粗、新增工作表、undo/redo 实测通过；复制/粘贴/插删行列/重命名入口存在未实测；**快速连续操作丢失编辑（P0-1）** | 未验证（声明支持多 tab、公式） | 串行操作下 LobeHub 有实测证据 | E2、E8、xlsx-2-edited.png |
| Excel | 保存 | 部分支持：IndexedDB 草稿保存实测通过；不回写文件（P0-2） | 未验证 | 同 PPT | E3、xlsx-3-saved.png |
| Excel | 再次打开 | 部分支持：重载后数据/公式/新工作表全部恢复，状态正确显示 "Saved"（与 PPT/Word 不一致，见 P1-4） | 未验证 | LobeHub 有实测恢复证据 | E4、xlsx-4-reopened.png |
| Excel | 导出/下载 | 支持：导出 XLSX 经 exceljs 独立解析：A1=marker、L30={formula:"2*3+4",result:10}、bold=true、Sheet3 存在；zip 完整、QuickLook 可打开 | 未验证 | LobeHub 有实测导出证据 | E5、E6 |
| Word | 创建或导入 | 部分支持：多段落 DOCX 导入渲染实测通过；无空白新建入口 | 未验证（声明支持创建） | 同 PPT | E1、docx-1-import.png |
| Word | 编辑 | 部分支持：段落文本改写、加粗、Heading 1、编号列表、3×3 表格、undo/redo 实测通过；链接/图片/居中入口存在未实测 | 未验证（声明支持编辑） | 串行操作下 LobeHub 有实测证据 | E2、docx-2-edited.png |
| Word | 保存 | 部分支持：IndexedDB 草稿保存实测通过；不回写文件（P0-2） | 未验证 | 同 PPT | E3、docx-3-saved.png |
| Word | 再次打开 | 部分支持：重载后编辑内容（marker/列表/表格）恢复；状态误显 "Unsaved changes"（P1-4） | 未验证 | LobeHub 有实测恢复证据 | E4、docx-4-reopened.png |
| Word | 导出/下载 | 支持：导出 DOCX 断言 marker/`<w:tbl>`/Heading1/`<w:numPr>`/`<w:b w:val="1"/>` 全部在 document.xml 中，zip 完整、QuickLook 可打开；**体积膨胀 6.5×（P2-8）** | 未验证（声明可生成 DOCX） | LobeHub 有实测导出证据 | E5、E6 |

整体结论：三类文档在**串行操作**下已具备"导入→编辑→保存（浏览器草稿）→重开→导出"的完整实测闭环，这是相对第 2 轮（编辑/保存/重开全不可用）的实质变化；但保存语义（仅本地草稿）、并发编辑竞态与工程化缺陷（依赖未声明）使其尚不能与 ChatGPT/Codex 官方声明的文件级能力直接判优劣，对侧 UI 仍未实测（登录墙）。

## 二、可复现测试样例（3 文档 × 5 阶段）

统一前置：`SPA_PORT=9876 bun run dev:spa` 启动后执行 `node docs/development/t-325-office-baseline/run-editor-roundtrip.mjs`。脚本把生产组件 `src/features/FileViewer/Renderer/<TYPE>/index.tsx` 挂载到真实 Vite 页面（`MotionProvider` 包裹，与产品一致），`url` 用 `/@fs/` 指向 fixture，`fileId=t325-r4-<type>`，运行前清空三个草稿库。marker 统一为 `T-325-R4`。fixture SHA-256：pptx `7338a6c2…3b8111`、xlsx `019597d1…77db06`、docx `25ee9d2f…f62433`（与第 2 轮相同文件）。

> 注意：干净 checkout 需先 `ln -s .pnpm/jszip@3.10.1/node_modules/jszip node_modules/jszip`，否则 PPTX/DOCX 编辑器加载即失败（P0-3 的复现方式）。

### PPT 链（对象：test.pptx，2 页）

| # | 阶段 | 操作对象与输入 | 预期结果 |
| --- | --- | --- | --- |
| P1 | 导入 | 挂载 PPTX 编辑器 | 工具栏 + 2 页缩略图 + 首页 "Hello/Page1"，状态 "Saved" |
| P2 | 编辑 | 依次（每步间隔 ≥3.5s）：Add text 输入 `T-325-R4-PPT 新增文本`；Add shape；Add chart 输入类目 `Q1,Q2,Q3` 值 `120,150,180`；Duplicate slide；Undo；Redo | 页数 2→3，新元素出现在画布（aria: TextBox 174/Shape 175/Chart 176）；Undo 后回 2 页、Redo 后回 3 页；状态 "Unsaved changes" |
| P3 | 保存 | 点 Save | 状态变 "Saved" |
| P4 | 再次打开 | 整页重载并以相同 fileId+url 重新挂载 | 3 页与全部新增内容恢复 |
| P5 | 导出 | 点 Download | 得到新 PPTX：SHA≠输入；`unzip -t` 通过；slide 数=3；slide1.xml 含 marker、`prst="roundRect"`；存在 ppt/charts/chart1.xml；QuickLook 生成预览 |

### Excel 链（对象：test.xlsx，2 sheet）

| # | 阶段 | 操作对象与输入 | 预期结果 |
| --- | --- | --- | --- |
| X1 | 导入 | 挂载 XLSX 编辑器 | 2 个 sheet 标签 + 表格数据 + 公式栏（第 2 个 input），状态 "Saved" |
| X2 | 编辑 | A1 选中态在公式栏输入 `T-325-R4 数据` 回车；点末尾单元格（L30）输入 `=2*3+4` 回车；点 Bold；点 Add sheet（+）；Undo；Redo | 网格出现 marker；L30 显示计算结果 10；新增 Sheet3；Undo 后 Sheet3 消失、Redo 恢复；状态 "Unsaved changes" |
| X3 | 保存 | 点 Save | 状态变 "Saved" |
| X4 | 再次打开 | 整页重载重挂载 | marker、公式、Sheet3 全部恢复，状态 "Saved" |
| X5 | 导出 | 点 Download | 新 XLSX：SHA≠输入；exceljs 读取 A1=`"T-325-R4 数据"`、L30=`{formula:"2*3+4",result:10}`、L30 bold=true、sheets=[表1, 表2 - 表格 2, Sheet3] |

### Word 链（对象：test.docx，多段落）

| # | 阶段 | 操作对象与输入 | 预期结果 |
| --- | --- | --- | --- |
| W1 | 导入 | 挂载 DOCX 编辑器 | 段落编辑区（textarea 块）+ 样式选择器 + 工具栏，状态 "Saved" |
| W2 | 编辑 | 首段 textarea 改为 `T-325-R4-WORD 简单报告（已编辑）` 后失焦；重选首段点 Bold；样式选 Heading 1；点 Numbered list；点 Add table（3×3）；Undo；Redo | 正文出现 marker 与 "List item"，表格块出现；Undo 后表格消失、Redo 恢复；状态 "Unsaved changes" |
| W3 | 保存 | 点 Save | 状态变 "Saved" |
| W4 | 再次打开 | 整页重载重挂载 | marker/列表/表格恢复 |
| W5 | 导出 | 点 Download | 新 DOCX：SHA≠输入；document.xml 含 marker、`<w:tbl>`、`Heading1`、`<w:numPr>`、`<w:b w:val="1"/>`；QuickLook 生成预览 |

### 竞态对照样例（P0-1 的复现步骤）

同上三链，但把编辑步骤间隔从 3.5s 缩到 0.6s（脚本第一次运行版本，产物在 `r4-race/`）：PPTX 导出中 marker 文本与图表全部丢失（仅形状与复制页存活）；XLSX 导出中 A1 marker 与公式丢失（仅 bold 与 Sheet3 存活）。

## 三、判定记录（本轮实跑）

判定：PASS=实测且断言通过；PARTIAL=部分通过或有明确边界；FAIL=不可用；NV=环境不可达未验证。原始机器日志：`r4/editor-roundtrip-log.json`（35 条，含每阶段 DOM 状态）。

| 环节 | 判定 | 实际观察（摘自原始日志/命令输出） |
| --- | --- | --- |
| PPT-IMPORT | PASS | `statusTexts:["Saved"]`，slide 列表 `HelloPage11 / WordPage22` |
| PPT-EDIT | PASS（串行）/ **FAIL（快速连续）** | aria 节点 `["TextBox 174","Shape 175","Chart Fallback 176","Chart 176"]`；undo 后页数 3→2、redo 后 2→3；r4-race 导出无 marker 无 chart |
| PPT-SAVE | PASS（草稿级） | 点击后 `statusTexts:["Saved"]` |
| PPT-REOPEN | PARTIAL | 3 页与新增内容全部恢复；但状态显示 `Unsaved changes` |
| PPT-EXPORT | PASS | `40047→42243 bytes`，SHA 变化；`unzip -t OK`；`marker in ppt/slides/slide1.xml`、`slide3.xml`；`slide count: 3`；`ppt/charts/chart1.xml` 存在；`file: Microsoft PowerPoint 2007+` |
| XLSX-IMPORT | PASS | 2 sheet 标签、网格渲染、公式栏、`Saved` |
| XLSX-EDIT | PASS（串行）/ **FAIL（快速连续）** | 网格出现 `T-325-R4 数据`（A1 为合并单元格，跨 5 列显示）；Sheet3 出现；undo/redo 正确；r4-race 导出 A1 仍为 `表格 1`、L30 无公式 |
| XLSX-SAVE | PASS（草稿级） | `statusTexts:["Saved"]` |
| XLSX-REOPEN | PASS | 重载后 marker/公式/Sheet3 恢复，状态 `Saved` |
| XLSX-EXPORT | PASS | exceljs 输出：`sheets:[表1, 表2 - 表格 2, Sheet3]`，`A1:"T-325-R4 数据"`，`L30:{"formula":"2*3+4","result":10} bold:true`；`unzip -t OK` |
| DOCX-IMPORT | PASS | 段落块渲染中文正文，样式选择器 `Normal/Heading 1/2/3`，`Saved` |
| DOCX-EDIT | PASS | DOM 出现 `T-325-R4-WORD 简单报告（已编辑）`、`List item`、表格块；undo 表格消失、redo 恢复 |
| DOCX-SAVE | PASS（草稿级） | `statusTexts:["Saved"]` |
| DOCX-REOPEN | PARTIAL | 内容全部恢复；状态显示 `Unsaved changes` |
| DOCX-EXPORT | PASS | `9387→61482 bytes` SHA 变化；document.xml：`marker:True table:True heading1:True numPr:True`、`<w:b w:val="1"/>`；`unzip -t OK`；`file: Microsoft Word 2007+` |
| ChatGPT/Codex 15 对侧环节 | NV | `agent-browser open https://chatgpt.com` → `Get started | ChatGPT  https://chatgpt.com/auth/login`（登录墙，无账号会话）；截图 chatgpt-login-wall.png / codex-login-wall.png |

背景门禁（非验收项）：编辑器单测 `pptxOperations/xlsxOperations/docxOperations` 3 文件 9 测试全部通过（6.03s）。

## 四、按优先级排序的问题清单

排序依据：P0=数据丢失或全生命周期阻断；P1=单类核心能力受损或高互操作风险；P2=工程化/一致性问题。

| # | 优先级 | 问题 | 文档类型 | 阶段 | 排序依据 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | P0 | 快速连续编辑发生静默丢失：`apply` 读取过期 bytes 且无操作队列/忙碌阻断，先行编辑被后续操作覆盖 | PPT、Excel（Word 未触发但同构） | 编辑 | 实测数据丢失且无任何报错，用户不可感知 | `r4-race/` 导出：PPTX 无 marker/chart（sha `9089fb6f…`）、XLSX A1/公式丢失（sha `92335719…`）；对照 `r4/` 全部存活 |
| 2 | P0 | "保存"仅写浏览器 IndexedDB 草稿，不回写原文件/云端；清缓存、换浏览器或换设备即丢失全部编辑 | 三类 | 保存/再次打开 | 保存语义与用户预期（文件已保存）不符，构成数据安全风险 | draftStorage 源码（IndexedDB put）；导出前原文件 SHA 不变 |
| 3 | P0 | `jszip` 未在根 package.json 声明，PPTX/DOCX 编辑器在干净安装下加载即失败 | PPT、Word | 全部 | 功能在真实部署中不可用 | Vite 原始报错：`Failed to resolve import "jszip" from "src/features/FileViewer/Renderer/PPTX/pptxOperations.ts"`；`node_modules/jszip` 不存在（仅 .pnpm 传递依赖） |
| 4 | P1 | 重开已保存草稿后 PPT/Word 状态误显 "Unsaved changes"（`setDirty(Boolean(draft))`），Excel 显示 "Saved"；三者语义互相矛盾，用户无法判断是否已保存 | 三类 | 再次打开 | 直接命中"无法判断是否保存"的验收红线 | r4 日志 `4-reopen`：pptx/docx `statusTexts:["Unsaved changes"]`，xlsx `["Saved"]`；PPTX/index.tsx `setDirty(Boolean(draft))` |
| 5 | P1 | 新增元素使用像素级坐标未换算 EMU（如 shape `off 704,540 ext 1152×360`，同页占位符 ext 为 21971000），在 PowerPoint 中新元素尺寸近乎不可见；编辑器内文本框过窄导致竖排 | PPT | 编辑/导出 | 导出结果与用户编辑意图不一致的兼容性风险 | 导出 slide1.xml 原文（附录 B）；pptx-2-edited.png 与 qlpreview 中 marker 竖排 |
| 6 | P1 | XLSX 编辑器 16 个 action 的 i18n key 缺失（copy/paste/insertRow/deleteRow/insertColumn/deleteColumn/italic/align\*/numberFormat/moveSheet\*/deleteSheet/clear 等），tooltip 显示原始 key | Excel | 一致性 | 核心操作入口不可理解 | `locales/en-US/file.json`、`zh-CN` 均缺 16 个 `xlsxEditor.*` key（对照 index.tsx 使用清单） |
| 7 | P1 | 三类均无"新建空白文档"入口，只能从既有文件进入编辑 | 三类 | 创建 | 缺创建侧核心能力，与 ChatGPT 声明能力差距 | FileViewer 仅按已有文件类型路由；UI 无创建按钮（r4 各 1-import 截图） |
| 8 | P2 | DOCX 导出所有 OOXML part 以 Stored（0% 压缩）写出，体积 9387→61482 字节（6.5×） | Word | 导出 | 文件可打开但体积异常，分发成本高 | `unzip -lv`：全部 `Stored 0%` |
| 9 | P2 | 三个编辑器草稿库命名与结构不一致（`lobehub-pptx-editor`/`lobehub-xlsx-editor`/`lobehub-office-drafts`），且 PPTX 草稿校验 sourceUrl 精确匹配、XLSX 剥离 query —— 清理与迁移策略难以统一 | 三类 | 保存 | 一致性债务，影响后续统一保存/恢复状态机 | 三个 draftStorage.ts 源码常量 |
| 10 | P2 | 导出文件未在真实 Microsoft Office/LibreOffice 中打开验证（本轮用 QuickLook、exceljs、XML 断言作独立解析）；跨应用视觉一致性仍属未验证 | 三类 | 导出 | 残余互操作风险 | qlpreview/\*.png 为目前最强的第三方渲染证据 |

## 附录 A — 证据文件 SHA-256

```text
1678dec3612b6b820c351b6a813ecb0a25764d38ab4baa44fcff1192b5274018  pptx-1-import.png
e11d5f50feba1363491d8d60cd96ae237c8d50456e6e42ee497c13b9a633b72b  pptx-2-edited.png
c28fccb27bf31205c39d552f38d19eb70c61d877efec25f91a986cdd21bfa5e8  pptx-3-saved.png
e493f9881d363dc48cbbca2ca8d6ee4b87371f9a898fadaba231f2695ef87385  pptx-4-reopened.png
dea348410ce24074a659e28edb693c317965b0a1928ff611cb27f32644069967  xlsx-1-import.png
4cb21c0341b0ad63073c0b1ff9173f465a0a64ed3363da243f0f39539d331c09  xlsx-2-edited.png
94fa7c72c65f007788a1ac0ea69b285b0dda452917b8de3ff81e5723e06fcf14  xlsx-3-saved.png
1a3c3a90b77c47dac10db219839b7fe44cd31265a4d9c4aaa3df650249858c5f  xlsx-4-reopened.png
cec8d5a8fa620ec4bf3e2ac9a9d5c2cc082df3974970710f62e3186a4e5181d2  docx-1-import.png
d518d1963fc0dcf3f210d22877eaab03aef4635e72e872d066a1abf2014f0074  docx-2-edited.png
b777e7ca3e3fce0d45f1e8fea387a2e05a824495d525ed18fcac5ff1cad99392  docx-3-saved.png
9d0e7d3a378c35b60e72b9667746c500280e7678cd821f55803aa7d56e7b663c  docx-4-reopened.png
85299a70e6b1a42738976eef4d47d1cf2e65cdfa2fc3302be413de14ce16be8d  export-T-325-R4-pptx.pptx（输入 7338a6c2…）
02cef49b7011aae5e74475f8113b384f3a7705e95efa2507da42b797fdc60331  export-T-325-R4-xlsx.xlsx（输入 019597d1…）
bd8636839abb8c53e729ef72aebdc926d44ad6af1cd5db5591d98456a8270689  export-T-325-R4-docx.docx（输入 25ee9d2f…）
9089fb6f1849dd0e0b5ca3d90cafac70bbe35fe69f4f007dbd66315d6d1bdb26  r4-race/export-T-325-R4-pptx.pptx（竞态丢失组）
92335719386a2f9ed11c4bc3546c035d408ee45d1f08a8668edd98877375b51b  r4-race/export-T-325-R4-xlsx.xlsx（竞态丢失组）
0790bb012c3a9bd8c73da5f7cc5d6eb66e850411ef3ecbfef03c555c20b022a1  qlpreview/export-T-325-R4-pptx.pptx.png
51a45cfc006b384a62ba47937600af5e3270c6afab3605e5ee7b46d27e0a0e65  qlpreview/export-T-325-R4-xlsx.xlsx.png
9cdc8f53fd125d1c21eaf1fd1bdc31d0a403cec66a3d50ab9b27916aa0df7bd5  qlpreview/export-T-325-R4-docx.docx.png
21981374abda620d5bdd08fab4938b93adb7859fc4f4d81d63e36a58b2872dd1  chatgpt-login-wall.png
024a71b87efe96f4cab653410315b13b320c9458e6759a1818e1e2d82a96a423  codex-login-wall.png
f5ffd657f5ea789a9e159983674f74a0b1b10db3e5ab5179f44d747102e41ccf  editor-roundtrip-log.json
```

## 附录 B — 关键原始输出摘录

导出 PPTX slide1.xml 中新增形状（px 未换算 EMU 的证据，对比占位符 `cx="21971000"`）：

```xml
<p:sp><p:nvSpPr><p:cNvPr id="174" name="Shape 174"/>…</p:nvSpPr>
<p:spPr><a:xfrm><a:off x="704" y="540"/><a:ext cx="1152" cy="360"/></a:xfrm>
<a:prstGeom prst="roundRect">…<a:solidFill><a:srgbClr val="1677FF"/></a:solidFill>…
```

文件类型与容器完整性（三个导出全部通过）：

```text
export-T-325-R4-pptx.pptx: Microsoft PowerPoint 2007+   unzip -t: OK
export-T-325-R4-xlsx.xlsx: Microsoft Excel 2007+        unzip -t: OK
export-T-325-R4-docx.docx: Microsoft Word 2007+         unzip -t: OK
```

exceljs 独立解析导出 XLSX：

```text
sheets: [ '表1', '表2 - 表格 2', 'Sheet3' ]
A1: "T-325-R4 数据" | bold: undefined
L30: {"formula":"2*3+4","result":10} | bold: true
```

jszip 缺依赖的 Vite 原始报错（P0-3）：

```text
Pre-transform error: Failed to resolve import "jszip" from
"src/features/FileViewer/Renderer/PPTX/pptxOperations.ts". Does the file exist?
```

ChatGPT/Codex 可达性原始输出（NV 依据）：

```text
$ agent-browser open https://chatgpt.com
✓ Get started | ChatGPT
  https://chatgpt.com/auth/login
```
