# @lobechat/file-loaders

`@lobechat/file-loaders` 是 LobeChat 項目中的一個工具包，專門用於從本地檔案路徑載入各種類型的檔案，並將其內容轉換為標準化的 `Document` 對象陣列。

它的主要目的是提供一個統一的接口來讀取不同的檔案格式，提取其核心文字內容，併為後續處理（例如在 LobeChat 中進行檔案預覽、內容提取或將其作為知識庫資料源）做好準備。

## ✨ 功能特性

- **統一接口**: 提供 `loadFile(filePath: string)` 函數作為核心入口點。
- **自動類型檢測**: 根據副檔名自動選擇合適的載入方式。
- **廣泛的格式支援**:
  - **純文字類**: `.txt`, `.csv`, `.md`, `.json`, `.xml`, `.yaml`, `.html` 以及多種程式碼和組態檔格式。
  - **PDF**: `.pdf` 檔案。
  - **Word**: `.docx` 檔案。
  - **Excel**: `.xlsx`, `.xls` 檔案，每個工作表作為一個 `Page`。
  - **PowerPoint**: `.pptx` 檔案，每個幻燈片作為一個 `Page`。
- **標準化輸出**: 始終返回 `Promise<Document>`。 `Document` 對象代表一個載入的檔案，其內部包含一個 `Page` 陣列，代表檔案的各個邏輯單元（頁、幻燈片、工作表、文字塊等）。
- **層級結構**: 採用 `Document` 包含 `Page[]` 的結構，更好地反映檔案原始組織方式。
- **豐富的元資料**: 在 `Document` 和 `Page` 層面提供詳細的元資料，包括檔案資訊、內容統計和結構資訊。

## 核心資料結構

`loadFile` 函數返回一個 `FileDocument` 對象，包含檔案級資訊和其所有邏輯頁面 / 塊 (`DocumentPage`)。

### `FileDocument` Interface

| 字段              | 類型              | 描述                                                           |
| :---------------- | :---------------- | :------------------------------------------------------------- |
| `content`         | `string`          | 檔案內容 (聚合後的內容)                                        |
| `createdTime`     | `Date`            | 檔案建立時間戳。                                               |
| `fileType`        | `string`          | 檔案類型或副檔名。                                             |
| `filename`        | `string`          | 原始檔案名。                                                   |
| `metadata`        | `object`          | 檔案級別的元資料。                                             |
| `metadata.author` | `string?`         | 文件作者 (如果可用)。                                          |
| `metadata.error`  | `string?`         | 如果整個檔案載入失敗，記錄錯誤訊息。                           |
| `metadata.title`  | `string?`         | 文件標題 (如果可用)。                                          |
| `...`             | `any`             | 其他檔案級別的元資料。                                         |
| `modifiedTime`    | `Date`            | 檔案最後修改時間戳。                                           |
| `pages`           | `DocumentPage[]?` | 包含文件中所有邏輯頁面 / 塊的陣列 (可選)。                     |
| `source`          | `string`          | 原始檔案的完整路徑。                                           |
| `totalCharCount`  | `number`          | 整個文件的總字符數 (所有 `DocumentPage` 的 `charCount` 之和)。 |
| `totalLineCount`  | `number`          | 整個文件的總行數 (所有 `DocumentPage` 的 `lineCount` 之和)。   |

### `DocumentPage` Interface

| 字段                       | 類型      | 描述                         |
| :------------------------- | :-------- | :--------------------------- |
| `charCount`                | `number`  | 此頁 / 塊內容的字符數。      |
| `lineCount`                | `number`  | 此頁 / 塊內容的行數。        |
| `metadata`                 | `object`  | 與此頁 / 塊相關的元資料。    |
| `metadata.chunkIndex`      | `number?` | 如果分割成塊，當前塊的索引。 |
| `metadata.error`           | `string?` | 處理此頁 / 塊時發生的錯誤。  |
| `metadata.lineNumberEnd`   | `number?` | 在原始檔案中的結束行號。     |
| `metadata.lineNumberStart` | `number?` | 在原始檔案中的起始行號。     |
| `metadata.pageNumber`      | `number?` | 頁碼 (適用於 PDF, DOCX)。    |
| `metadata.sectionTitle`    | `string?` | 相關的章節標題。             |
| `metadata.sheetName`       | `string?` | 工作表名稱 (適用於 XLSX)。   |
| `metadata.slideNumber`     | `number?` | 幻燈片編號 (適用於 PPTX)。   |
| `metadata.totalChunks`     | `number?` | 如果分割成塊，總塊數。       |
| `...`                      | `any`     | 其他特定於頁 / 塊的元資料。  |
| `pageContent`              | `string`  | 此頁 / 塊的核心文字內容。    |

## 🤝 參與貢獻

檔案格式和解析需求在不斷發展。我們歡迎社群貢獻來擴充功能格式支援和提高解析準確性。您可以通過以下方式參與改進：

### 如何貢獻

1. **新檔案格式支援**：新增對其他檔案類型的支援
2. **解析器改進**：增強現有解析器以更好地提取內容
3. **元資料增強**：改進元資料提取能力
4. **性能優化**：優化檔案載入和處理性能

### 貢獻流程

1. Fork [LobeChat 倉庫](https://github.com/lobehub/lobe-chat)
2. 新增新格式支援或改進現有解析器
3. 提交 Pull Request 並描述：

- 支援的新檔案格式或所做的改進
- 使用各種檔案樣本進行測試
- 性能影響分析
- 文件更新

## 📌 說明

這是 LobeHub 的內部模組（`"private": true`），專為 LobeChat 設計，不作為獨立包發佈。

如果你對我們的項目感興趣，歡迎在 [GitHub](https://github.com/lobehub/lobe-chat) 上查看、按讚或貢獻程式碼！
