# Page 模块 E2E 测试覆盖

本目录包含 Page（文稿）模块的所有 E2E 测试用例。

## 模块概述

Page 模块是 LobeHub 的文档管理功能，允许用户创建、编辑和管理文稿页面。

**路由**: `/page`, `/page/[id]`

## 功能清单与测试覆盖

### 1. 侧边栏 - 文稿列表管理

| 功能点       | 描述                           | 优先级 | 状态 | 测试文件       |
| ------------ | ------------------------------ | ------ | ---- | -------------- |
| 创建文稿     | 点击 + 按钮创建新文稿          | P0     | ✅   | `crud.feature` |
| 重命名文稿   | 右键菜单 / 三点菜单重命名      | P0     | ✅   | `crud.feature` |
| 复制文稿     | 复制文稿（自动添加 Copy 后缀） | P1     | ✅   | `crud.feature` |
| 删除文稿     | 删除文稿（带确认弹窗）         | P0     | ✅   | `crud.feature` |
| 复制全文     | 复制文稿内容到剪贴板           | P2     | ⏳   |                |
| 列表分页设置 | 设置显示数量（20/40/60/100）   | P2     | ⏳   |                |
| 全部文稿抽屉 | 打开完整列表 + 搜索            | P2     | ⏳   |                |
| 搜索文稿     | 按标题 / 内容搜索过滤          | P1     | ⏳   |                |

### 2. 编辑器 - 文稿头部

| 功能点        | 描述                       | 优先级 | 状态 | 测试文件              |
| ------------- | -------------------------- | ------ | ---- | --------------------- |
| 返回按钮      | 返回上一页                 | P2     | ⏳   |                       |
| 标题编辑      | 大标题输入框，自动保存     | P0     | ✅   | `editor-meta.feature` |
| Emoji 选择    | 点击选择 / 更换 / 删除图标 | P1     | ✅   | `editor-meta.feature` |
| 自动保存提示  | 显示保存状态               | P2     | ⏳   |                       |
| 全宽模式切换  | 大屏幕下切换全宽 / 定宽    | P2     | ⏳   |                       |
| 复制链接      | 复制文稿 URL               | P2     | ⏳   |                       |
| 导出 Markdown | 导出为 .md 文件            | P2     | ⏳   |                       |
| 页面信息      | 显示最后编辑时间           | P2     | ⏳   |                       |

### 3. 编辑器 - 富文本编辑

| 功能点        | 描述                     | 优先级 | 状态 | 测试文件                 |
| ------------- | ------------------------ | ------ | ---- | ------------------------ |
| 基础文本输入  | 输入和编辑文本           | P0     | ✅   | `editor-content.feature` |
| 斜杠命令 (/)  | 打开命令菜单             | P1     | ✅   | `editor-content.feature` |
| 标题 H1/H2/H3 | 插入标题                 | P1     | ✅   | `editor-content.feature` |
| 任务列表      | 插入待办事项             | P2     | ✅   | `editor-content.feature` |
| 无序列表      | 插入项目符号列表         | P2     | ✅   | `editor-content.feature` |
| 有序列表      | 插入编号列表             | P2     | ⏳   |                          |
| 图片上传      | 插入图片                 | P2     | ⏳   |                          |
| 分隔线        | 插入水平分隔线           | P2     | ⏳   |                          |
| 表格          | 插入表格                 | P2     | ⏳   |                          |
| 代码块        | 插入代码块（带语法高亮） | P2     | 🚧   | `editor-content.feature` |
| LaTeX 公式    | 插入数学公式             | P2     | ⏳   |                          |
| 文本加粗      | 使用快捷键加粗           | P1     | ✅   | `editor-content.feature` |
| 文本斜体      | 使用快捷键斜体           | P2     | ✅   | `editor-content.feature` |

### 4. Copilot 侧边栏

| 功能点          | 描述                | 优先级 | 状态 | 测试文件          |
| --------------- | ------------------- | ------ | ---- | ----------------- |
| 打开 / 关闭面板 | 展开 / 收起 Copilot | P1     | ⏳   | `copilot.feature` |
| Ask Copilot     | 选中文本后询问      | P0     | ⏳   | `copilot.feature` |
| Agent 切换      | 选择不同的 Agent    | P2     | ⏳   |                   |
| 新建话题        | 创建新的对话话题    | P2     | ⏳   |                   |
| 话题历史        | 查看和切换历史话题  | P2     | ⏳   |                   |
| 对话交互        | 发送消息、接收回复  | P0     | ⏳   | `copilot.feature` |
| 模型选择        | 切换使用的模型      | P2     | ⏳   |                   |
| 文件上传        | 拖放上传文件        | P2     | ⏳   |                   |

## 测试文件结构

```
e2e/src/features/page/
├── README.md              # 本文档
├── crud.feature           # 侧边栏 CRUD 操作 (5 scenarios)
├── editor-meta.feature    # 编辑器元数据（标题、Emoji）(6 scenarios)
└── editor-content.feature # 富文本编辑功能 (8 scenarios)
```

## 测试统计

- **总场景数**: 19 (通过) + 1 (跳过)
- **总步骤数**: 109+
- **执行时间**: \~3 分钟

## 测试执行

```bash
# 运行 Page 模块所有测试
cd e2e
BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@page and not @skip"

# 运行特定测试
pnpm exec cucumber-js --config cucumber.config.js --tags "@PAGE-CREATE-001"

# 调试模式（显示浏览器）
HEADLESS=false pnpm exec cucumber-js --config cucumber.config.js --tags "@PAGE-TITLE-001"
```

## 状态说明

- ✅ 已完成 - 测试用例已实现并通过
- ⏳ 待实现 - 功能已识别，测试待编写
- 🚧 进行中 - 测试用例正在开发中或需要修复

## 已知问题

1. **代码块测试 (@PAGE-SLASH-005)**: 斜杠命令 `/codeblock` 触发不稳定，已标记 @skip

## 更新记录

| 日期       | 更新内容                                  |
| ---------- | ----------------------------------------- |
| 2025-01-12 | 初始化功能清单，完成侧边栏 CRUD           |
| 2025-01-12 | 完成编辑器标题 / Emoji 测试 (6 scenarios) |
| 2025-01-12 | 完成富文本编辑测试 (8 scenarios，1 跳过)  |
