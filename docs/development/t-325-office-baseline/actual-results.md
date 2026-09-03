# 实际执行判定记录

执行日期：2026-09-03。LobeHub 版本：`2794037573e1cc0dc5d02eb223463c61c5ca16d3`。

这里的 `PASS/PARTIAL/FAIL` 是当前基线结果，不是未来验收预期。导入环节实际执行已有 fixture 的 loader 测试；其他环节实际执行针对当前用户界面实现的源码探测。源码探测能证明当前开源快照是否提供入口和回写路径，但不替代未来产品 E2E。ChatGPT/Codex 浏览器连接实际返回 `No browser is available`，故对侧逐环节均记为 `NV`，只在功能矩阵中附官方声明。

| 文档  | 环节        | 可照做的执行步骤                                                                                        | 实际观察                                                                                    | 判定    |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- |
| PPT   | 创建 / 导入 | 在 `packages/file-loaders` 执行 `bunx vitest run --silent='passed-only' src/loaders/pptx/index.test.ts` | 6/6 通过；断言包含多页、聚合、缺失文件、损坏 XML、空 slides。没有空白创建入口。             | PARTIAL |
| PPT   | 编辑        | 对 `DocumentPreview.tsx` 检索 `contentEditable/onChange`，检查 PptxPane                                 | 两项均为 0；pane 只执行 `PptxViewer.open(blob, container, ...)`。                           | FAIL    |
| PPT   | 保存        | 检索 `saving/saved/writeFile/exportPptx`                                                                | 四项均为 0，没有 PPTX 序列化或编辑状态。                                                    | FAIL    |
| PPT   | 再次打开    | 再次运行同一 fixture loader 测试                                                                        | 原文件仍可读取；因无编辑 / 保存，无法产生 “编辑后重开” 结果。                               | PARTIAL |
| PPT   | 导出 / 下载 | 检查 fallback 的 `handleDownload`                                                                       | 创建输入 blob URL 后设置 `anchor.download = filename`；这是原文件下载，没有 PPTX exporter。 | PARTIAL |
| Excel | 创建 / 导入 | 执行 `... src/loaders/excel/index.test.ts`                                                              | 4/4 通过；断言覆盖 sheet→page、聚合、缺失文件和仅表头文件。无空白 workbook 创建入口。       | PARTIAL |
| Excel | 编辑        | 检查 XlsxPane 及 `contentEditable/onChange`                                                             | 只调用 `workbook.xlsx.load` 并输出 `<td>{cell}</td>`；编辑事件计数为 0。                    | FAIL    |
| Excel | 保存        | 检索 `saving/saved/writeFile/exportXlsx`                                                                | 全部为 0，只有 load 没有 write/export。                                                     | FAIL    |
| Excel | 再次打开    | 再次执行 fixture loader 测试并检查公式显示函数                                                          | 原文件可读；公式只显示缓存 `cell.result`，不存在编辑状态。                                  | PARTIAL |
| Excel | 导出 / 下载 | 检查 fallback 下载与 exporter 探测                                                                      | 只能下载输入 blob；`exportXlsx=0`。                                                         | PARTIAL |
| Word  | 创建 / 导入 | 执行 `... src/loaders/docx/index.test.ts`                                                               | 3/3 通过；断言覆盖读取、聚合和缺失文件。没有空白创建入口。                                  | PARTIAL |
| Word  | 编辑        | 检查 DocxPane、loader 与编辑事件                                                                        | pane 只执行 `renderAsync`；loader 执行 `mammoth.extractRawText`；编辑事件为 0。             | FAIL    |
| Word  | 保存        | 检索 `saving/saved/writeFile/exportDocx`                                                                | 全部为 0，没有 DOCX serializer。                                                            | FAIL    |
| Word  | 再次打开    | 再次执行 fixture loader 测试                                                                            | 原 DOCX 可读；无编辑后版本可供重开。                                                        | PARTIAL |
| Word  | 导出 / 下载 | 检查 fallback 下载和外部打开                                                                            | 只能下载输入 blob 或调用默认应用；`exportDocx=0`。                                          | PARTIAL |

## ChatGPT/Codex 实际记录

| 环节                                | 操作                                       | 实际观察                  | 判定                   |
| ----------------------------------- | ------------------------------------------ | ------------------------- | ---------------------- |
| 创建 / 导入、编辑、保存、重开、导出 | 初始化本会话默认浏览器以进入可访问产品界面 | `No browser is available` | NV；不得作为通过或失败 |

官方文档声明仍可用于确定后续对比预期：ChatGPT Work 可创建或编辑 documents/spreadsheets/presentations；可用性依赖 plan、workspace settings、file type 和 surface。实际验收必须在可用 UI 中重新执行 `test-scenarios.md`。
