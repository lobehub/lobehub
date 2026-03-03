# @lobechat/file-loaders

`@lobechat/file-loaders` 是 LobeHub 项目中的一个工具包，专门用于从本地文件路径加载各种类型的文件，并将其内容转换为标准化的 `Document` 对象数组。

它的主要目的是提供一个统一的接口来读取不同的文件格式，提取其核心文本内容，并为后续处理（例如在 LobeHub 中进行文件预览、内容提取或将其作为知识库数据源）做好准备。

## ✨ 功能特性

- **统一接口**: 提供 `loadFile(filePath: string)` 函数作为核心入口点。
- **自动类型检测**: 根据文件扩展名自动选择合适的加载方式。
- **广泛的格式支持**:
  - **纯文本类**: `.txt`, `.csv`, `.md`, `.json`, `.xml`, `.yaml`, `.html` 以及多种代码和配置文件格式。
  - **PDF**: `.pdf` 文件。
  - **Word**: `.docx` 文件。
  - **Excel**: `.xlsx`, `.xls` 文件，每个工作表作为一个 `Page`。
  - **PowerPoint**: `.pptx` 文件，每个幻灯片作为一个 `Page`。
- **标准化输出**: 始终返回 `Promise<Document>`。 `Document` 对象代表一个加载的文件，其内部包含一个 `Page` 数组，代表文件的各个逻辑单元（页、幻灯片、工作表、文本块等）。
- **层级结构**: 采用 `Document` 包含 `Page[]` 的结构，更好地反映文件原始组织方式。
- **丰富的元数据**: 在 `Document` 和 `Page` 层面提供详细的元数据，包括文件信息、内容统计和结构信息。

## 核心数据结构

`loadFile` 函数返回一个 `FileDocument` 对象，包含文件级信息和其所有逻辑页面 / 块 (`DocumentPage`)。

### `FileDocument` Interface

| 字段              | 类型              | 描述                                                           |
| :---------------- | :---------------- | :------------------------------------------------------------- |
| `content`         | `string`          | 文件内容 (聚合后的内容)                                        |
| `createdTime`     | `Date`            | 文件创建时间戳。                                               |
| `fileType`        | `string`          | 文件类型或扩展名。                                             |
| `filename`        | `string`          | 原始文件名。                                                   |
| `metadata`        | `object`          | 文件级别的元数据。                                             |
| `metadata.author` | `string?`         | 文档作者 (如果可用)。                                          |
| `metadata.error`  | `string?`         | 如果整个文件加载失败，记录错误信息。                           |
| `metadata.title`  | `string?`         | 文档标题 (如果可用)。                                          |
| `...`             | `any`             | 其他文件级别的元数据。                                         |
| `modifiedTime`    | `Date`            | 文件最后修改时间戳。                                           |
| `pages`           | `DocumentPage[]?` | 包含文档中所有逻辑页面 / 块的数组 (可选)。                     |
| `source`          | `string`          | 原始文件的完整路径。                                           |
| `totalCharCount`  | `number`          | 整个文档的总字符数 (所有 `DocumentPage` 的 `charCount` 之和)。 |
| `totalLineCount`  | `number`          | 整个文档的总行数 (所有 `DocumentPage` 的 `lineCount` 之和)。   |

### `DocumentPage` Interface

| 字段                       | 类型      | 描述                         |
| :------------------------- | :-------- | :--------------------------- |
| `charCount`                | `number`  | 此页 / 块内容的字符数。      |
| `lineCount`                | `number`  | 此页 / 块内容的行数。        |
| `metadata`                 | `object`  | 与此页 / 块相关的元数据。    |
| `metadata.chunkIndex`      | `number?` | 如果分割成块，当前块的索引。 |
| `metadata.error`           | `string?` | 处理此页 / 块时发生的错误。  |
| `metadata.lineNumberEnd`   | `number?` | 在原始文件中的结束行号。     |
| `metadata.lineNumberStart` | `number?` | 在原始文件中的起始行号。     |
| `metadata.pageNumber`      | `number?` | 页码 (适用于 PDF, DOCX)。    |
| `metadata.sectionTitle`    | `string?` | 相关的章节标题。             |
| `metadata.sheetName`       | `string?` | 工作表名称 (适用于 XLSX)。   |
| `metadata.slideNumber`     | `number?` | 幻灯片编号 (适用于 PPTX)。   |
| `metadata.totalChunks`     | `number?` | 如果分割成块，总块数。       |
| `...`                      | `any`     | 其他特定于页 / 块的元数据。  |
| `pageContent`              | `string`  | 此页 / 块的核心文本内容。    |

## 🤝 参与贡献

文件格式和解析需求在不断发展。我们欢迎社区贡献来扩展格式支持和提高解析准确性。您可以通过以下方式参与改进：

### 如何贡献

1. **新文件格式支持**：添加对其他文件类型的支持
2. **解析器改进**：增强现有解析器以更好地提取内容
3. **元数据增强**：改进元数据提取能力
4. **性能优化**：优化文件加载和处理性能

### 贡献流程

1. Fork [LobeHub 仓库](https://github.com/lobehub/lobe-chat)
2. 添加新格式支持或改进现有解析器
3. 提交 Pull Request 并描述：

- 支持的新文件格式或所做的改进
- 使用各种文件样本进行测试
- 性能影响分析
- 文档更新

## 📌 说明

这是 LobeHub 的内部模块（`"private": true`），专为 LobeHub 设计，不作为独立包发布。

如果你对我们的项目感兴趣，欢迎在 [GitHub](https://github.com/lobehub/lobe-chat) 上查看、点赞或贡献代码！
