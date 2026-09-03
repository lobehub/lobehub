# 三类文档全生命周期复现手册与实际判定

本手册包含 15 个独立环节。每个环节均给出测试素材、可直接照做的编号步骤、实际观察和判定。工作目录统一为仓库根目录；源码基线为 `2794037573e1cc0dc5d02eb223463c61c5ca16d3`。

## 测试素材（内容与摘要内嵌）

### PPTX smoke fixture

- 文件：`packages/file-loaders/src/loaders/pptx/fixtures/test.pptx`
- SHA-256：`7338a6c2978a9fdaf6575af3dd6e8681d5fc589f91e19e731bc2012e143b8111`
- 内容摘录：至少两页；第一页包含文本 `Hello` 与 `Page1`。测试另包含 `corrupted-slides.pptx` 和 `empty-slides.pptx`，用于损坏和空文件路径。
- 富内容场景素材摘录：4 页，标题标记 `T-325-R1`；第 2 页含 SVG 和 “可恢复” 圆角矩形；柱状图数据 Q1/Q2/Q3=`120/150/180`；最终页序为 “封面、方案、结论、数据”。

### XLSX smoke fixture 与确定性数据

- 文件：`packages/file-loaders/src/loaders/excel/fixtures/test.xlsx`
- SHA-256：`019597d1701adb261b922d8a66e0f6f0db7d0bfd10659b8e822a8b6f4277db06`
- 结构：OOXML 包含 `xl/worksheets/sheet1.xml`、`sheet2.xml`、`sharedStrings.xml` 和 `styles.xml`。
- CSV 全量内容：

```csv
日期,地区,产品,数量,单价
2026-08-01,华东,Alpha,10,120
2026-08-02,华南,Beta,5,200
2026-08-03,华东,Gamma,3,150
2026-08-04,华南,Alpha,2,120
2026-08-05,华东,Beta,1,115
2026-08-06,华南,Gamma,1,110
```

- 判定 oracle：未税总额 `3115.00`；含税总额 `3519.95`；华东 `1765.00`；华南 `1350.00`；工作表顺序 `参数表→明细→汇总`。

### DOCX smoke fixture 与内容素材

- 文件：`packages/file-loaders/src/loaders/docx/fixtures/test.docx`
- SHA-256：`25ee9d2f05861810b44f6d866869f329b079a9a4d08b9ba7ec25cbeb06f62433`
- 内容摘录：标题 `简单报告`、副标题 `副标题`、小标题 `小标题`，以及第二页文本 `这是第二页的内容`。
- 富内容场景摘要：标题 `T-325 办公文档基线报告`；正文标记 `T-325-R1`；四步编号列表；三项风险项目符号列表；3×3 表格；OpenAI 链接；插入统一 SVG 图片。

### 统一图片素材

SVG 的 `viewBox="0 0 800 450"`，包含蓝色边框、橙色圆形、三条蓝色横条和白色文字 `T-325`。SHA-256：`b7bbf3589440ff50e061f0922496b4e203829819b313024c4a28e1933e3416fe`。

## PPT：5 个环节

### PPT-IMPORT — 创建或导入

1. 执行 `cd packages/file-loaders`。
2. 执行 `bunx vitest run --silent='passed-only' src/loaders/pptx/index.test.ts`。
3. 核对输出包含 `src/loaders/pptx/index.test.ts (6 tests)` 和 `6 passed`；测试断言要求页数大于 1，并覆盖缺失、损坏和空 slides 文件。

实际观察：6/6 通过，fixture 能按 slide 读取；源码及测试没有空白 PPT 创建入口。判定：`PARTIAL`。

### PPT-EDIT — 内容编辑

1. 回到仓库根目录。
2. 执行 `rg -n "contentEditable|onChange|PptxViewer.open" src/features/Portal/LocalFile/DocumentPreview.tsx`。
3. 核对是否存在可编辑 DOM、编辑事件或对象变更命令，并记录命中行。

实际观察：只命中 `210: viewer = await PptxViewer.open(blob, container, {`；`contentEditable` 和 `onChange` 均无命中。判定：`FAIL`。

### PPT-SAVE — 保存

1. 执行 `for token in saving saved writeFile exportPptx; do count=$(rg -i -c "$token" src/features/Portal/LocalFile/DocumentPreview.tsx || true); echo "$token=${count:-0}"; done`。
2. 核对 saving/saved 状态及 PPTX 写入器是否存在。

实际观察：`saving=0 saved=0 writeFile=0 exportPptx=0`。判定：`FAIL`。

### PPT-REOPEN — 再次打开

1. 连续两次执行 `cd packages/file-loaders && bunx vitest run --silent='passed-only' src/loaders/pptx/index.test.ts`。
2. 比较两次结果，确认原 fixture 均可读取。
3. 检查 PPT-SAVE 是否产生了编辑后文件；没有则不得声称编辑结果可重开。

实际观察：原文件可重复读取；PPT-SAVE 没有输出文件，因此不能重开编辑结果。判定：`PARTIAL`。

### PPT-EXPORT — 导出或下载

1. 执行 `rg -n "createObjectURL|anchor.download|exportPptx|writeFile" src/features/Portal/LocalFile/DocumentPreview.tsx`。
2. 判断下载对象来自输入 blob 还是新的 PPTX serializer。

实际观察：代码对输入 `blob` 调用 `URL.createObjectURL`，随后设置 `anchor.download = filename`；没有 exporter/writeFile。判定：`PARTIAL`，仅原文件下载。

## Excel：5 个环节

### XLSX-IMPORT — 创建或导入

1. 执行 `cd packages/file-loaders`。
2. 执行 `bunx vitest run --silent='passed-only' src/loaders/excel/index.test.ts`。
3. 核对输出为 4 项通过；断言覆盖 workbook 读取、sheet 聚合、缺失文件和仅表头文件。

实际观察：4/4 通过，既有 XLSX 可导入；没有空白 workbook 创建入口。判定：`PARTIAL`。

### XLSX-EDIT — 内容编辑

1. 回到仓库根目录。
2. 执行 `rg -n "workbook.xlsx.load|contentEditable|onChange|<td" src/features/Portal/LocalFile/DocumentPreview.tsx`。
3. 检查是否有单元格输入、公式栏或 workbook mutation。

实际观察：命中 `workbook.xlsx.load` 和 `<td key={cellIndex}>{cell}</td>`；没有 `contentEditable/onChange`。判定：`FAIL`。

### XLSX-SAVE — 保存

1. 执行 `for token in saving saved writeFile exportXlsx; do count=$(rg -i -c "$token" src/features/Portal/LocalFile/DocumentPreview.tsx || true); echo "$token=${count:-0}"; done`。
2. 再执行 `rg -n "workbook.xlsx.load" src/features/Portal/LocalFile/DocumentPreview.tsx`，区分 load 与 write。

实际观察：四个写入 / 状态 token 均为 0，只有 `327: await workbook.xlsx.load(...)`。判定：`FAIL`。

### XLSX-REOPEN — 再次打开

1. 连续两次运行 XLSX-IMPORT 的 Vitest 命令。
2. 执行 `rg -n "cell.formula|cell.result" src/features/Portal/LocalFile/DocumentPreview.tsx`。
3. 判断原文件能否重复读取，以及编辑公式是否能保存后恢复。

实际观察：原文件可重复读取；公式显示路径为 `return formatCellValue(cell.result)`，没有编辑后 workbook。判定：`PARTIAL`。

### XLSX-EXPORT — 导出或下载

1. 执行 `rg -n "createObjectURL|anchor.download|exportXlsx|writeFile" src/features/Portal/LocalFile/DocumentPreview.tsx`。
2. 确认是否生成新 workbook，并与输入 fixture SHA-256 区分。

实际观察：只有输入 blob 下载，`exportXlsx/writeFile` 无命中，未产生新 workbook。判定：`PARTIAL`。

## Word：5 个环节

### DOCX-IMPORT — 创建或导入

1. 执行 `cd packages/file-loaders`。
2. 执行 `bunx vitest run --silent='passed-only' src/loaders/docx/index.test.ts`。
3. 核对输出为 3 项通过；断言覆盖读取、聚合和缺失文件。

实际观察：3/3 通过，既有 DOCX 可导入；没有空白 DOCX 创建入口。判定：`PARTIAL`。

### DOCX-EDIT — 内容编辑

1. 回到仓库根目录。
2. 执行 `rg -n "renderAsync|contentEditable|onChange" src/features/Portal/LocalFile/DocumentPreview.tsx`。
3. 执行 `rg -n "extractRawText" packages/file-loaders/src/loaders/docx/index.ts`。
4. 检查富文本编辑事件和结构化文档模型。

实际观察：只读路径为 `renderAsync(blob, container)`，模型读取为 `mammoth.extractRawText({ buffer })`；没有编辑事件。判定：`FAIL`。

### DOCX-SAVE — 保存

1. 执行 `for token in saving saved writeFile exportDocx; do count=$(rg -i -c "$token" src/features/Portal/LocalFile/DocumentPreview.tsx || true); echo "$token=${count:-0}"; done`。
2. 核对是否有 DOCX serializer 和保存状态。

实际观察：`saving=0 saved=0 writeFile=0 exportDocx=0`。判定：`FAIL`。

### DOCX-REOPEN — 再次打开

1. 连续两次运行 DOCX-IMPORT 的 Vitest 命令。
2. 检查 DOCX-SAVE 是否生成包含 `T-325-R1` 的新文件。

实际观察：原 fixture 可重复读取；没有保存输出，因此不存在含新标记的文件可重开。判定：`PARTIAL`。

### DOCX-EXPORT — 导出或下载

1. 执行 `rg -n "createObjectURL|anchor.download|openLocalFile|exportDocx|writeFile" src/features/Portal/LocalFile/DocumentPreview.tsx`。
2. 判断结果是原 blob 下载、外部应用打开，还是新 DOCX 导出。

实际观察：命中 `anchor.download = filename` 与 `openLocalFile`；没有 exporter/writeFile。判定：`PARTIAL`。

## 对侧复现要求

ChatGPT/Codex 的每一环节都使用上面内嵌的相同内容和 oracle。执行者应在可用 UI 中依次创建 / 导入、编辑、保存、关闭重开、下载，并在每一步记录截图、输出文件大小和 SHA-256。本轮浏览器连接实际输出 `No browser is available`，因此所有对侧 UI 结果保持 `NV`，不能推定 PASS。
