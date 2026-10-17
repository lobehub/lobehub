# components.md — 组件选择

<!-- refs:meta
tier: index
scope: LobeUI 组件选型；导入入口是硬性规则，其余按需求查
entries:
  C-01         | always | 导入入口与禁用清单（硬性规则）
  C-02 §表单与输入  | deep | 表单,输入,选择,日期,上传,校验
  C-02 §反馈与状态  | deep | 加载,空态,提示,反馈,进度,骨架
  C-02 §覆盖层与菜单 | deep | 弹层,弹窗,抽屉,菜单,modal,drawer
  C-02 §布局与容器  | deep | 布局,容器,栅格,侧栏,外壳,滚动
  C-02 §内容展示   | deep | 表格,列表,文本,代码,图表,标签
  C-02 §图标与头像  | deep | 图标,头像,emoji,logo
  C-03         | deep | 易混,区别,语义,Tag,Badge,Modal,Drawer
  C-04         | deep | 对话,chat,消息,输入区,会话
  C-05         | deep | 没有的组件,找不到组件,缺失
  C-06         | deep | 命名空间,其他入口,导入路径
  C-07         | deep | 控制台套件,consoleshell,pageheader,surface
  C-08         | deep | 控制台,后台,按场景选组件
  C-09         | deep | titlewithtips,列名解释,标题提示
  C-10         | deep | barlist,构成,排名条,占比条
  C-11         | deep | 自建,组合组件,业务组件,分层,原子层,chat,自研,封装
  C-12         | deep | 可访问名,aria,读屏,无名,switch,checkbox,图标按钮
  C-15         | deep | confirmmodal,确认弹窗,菜单,popover,浮层,二级菜单
  C-17         | deep | 表单,设置页,重置,就地编辑,短表单
-->

物料清单只说「有什么」。这份文件说「什么时候该用，什么时候不该用」。

同一个组件外观看起来相似，语义可能完全不同。选之前先判断这段信息表达的是**状态、分类、动作、容器还是导航关系**。

规则可被 [evaluator.md](evaluator.md) 按编号引用。

## C-01 原子层从 `@lobehub/ui` 取用（硬性规则，只管原子层）

**先看 C-11 的分层。** 本条的硬约束只覆盖**原子层**（按钮、输入、表格、弹层这类不可再分的零件）。

组件从 `@lobehub/ui` 根入口导入（基于 `@base-ui/react`）。独立入口只有这几个：表单 `@lobehub/ui/form`、请求驱动的表格 `@lobehub/ui/pro-table`、控制台 `@lobehub/ui/dashboard`，其余见 C-06。样式 API（`createStaticStyles` · `cssVar` · `cx` · `css` · `keyframes` · `responsive` · `useTheme` · `useThemeMode` · `lobeStaticStylish`）同样从 `@lobehub/ui` 导入。

**应用里不用 `antd` 和 `antd-style`**（`LOBE-ANTD-IMPORT`）：它们拿不到 lobe-ui 的主题与层叠顺序。按需求取对应件：

| 需要 | 用 |
| --- | --- |
| 卡片 | `Block`；控制台里的面板用 dashboard 的 `Surface` |
| 排版文字 | `Text`（默认渲染块级 `div`，行内用 `as="span"`） |
| 浮动按钮 | 没有对应件，用定位过的 `ActionIcon` / `Button` |
| 常驻导航 | 控制台侧栏 `ConsoleNav`；固定窄栏 `SideNav`；通用可选行 `List`（`items` + `activeKey`） |
| 操作结果提示 | `toast`（应用里渲染一次 `ToastHost`） |
| 命令式弹窗 / 确认 | `createModal` / `confirmModal`（应用里渲染一次 `ModalHost`） |
| 折叠 | `Accordion`（多节）/ `Collapsible`（单区域） |
| 挂在触发元素上的菜单 | `DropdownMenu`（默认点击打开；要悬停打开传 `trigger="hover"`） |
| 主按钮带下拉 | `SplitButton` |
| 图标 | `lucide-react` 字形交给 `Icon`（`<Icon icon={X} />`），不用 `@ant-design/icons`（`LOBE-ANT-ICONS`） |
| 加载转圈 | `Spin`（AI 等待用 `variant="network"`），不引第三方加载包 |
| 后台列表 / 表单 / 只读字段 / 整页外壳 | `ProTable`（`@lobehub/ui/pro-table`）/ `@lobehub/ui/form` / `Descriptions` / `ConsoleShell`（C-07） |

在消费方项目里接上配套 eslint 就能拦住这些误用：

```js
import restrictedImports from '@lobehub/ui/eslint';
```

**表单是单独入口。** `Form` 从 `@lobehub/ui/form` 导入（`LOBE-FORM-ENTRY`）；根入口的 `Form` 是不带校验的非受控表单，不要用。见 C-02。

## C-02 按需求查（原子层与皮肤层的选型表）

> 先看 C-11：本节的表用来查**原子层和皮肤层**该取哪个现成件。业务组合件请按 C-11 自建。

### 表单与输入

| 需要                                 | 用                                                                       | 来源                       |
| ------------------------------------ | ------------------------------------------------------------------------ | -------------------------- |
| 文本 / 多行 / 数字 / 密码 / 验证码   | `Input` · `TextArea` · `InputNumber` · `InputPassword` · `InputOTP`      | `@lobehub/ui`              |
| 从固定选项里选                       | `Select`                                                                 | `@lobehub/ui`              |
| 自由输入 + 建议                      | `AutoComplete`                                                           | `@lobehub/ui`              |
| 开关（立即生效的设置）               | `Switch`                                                                 | `@lobehub/ui`              |
| 勾选 / 单选                          | `Checkbox` · `CheckboxGroup` · `Radio` · `RadioGroup`                    | `@lobehub/ui`              |
| 区间取值                             | `Slider`，要配数字输入用 `SliderWithInput`                               | `@lobehub/ui`              |
| 结构化表单骨架                       | `Form` + `useForm` + `Form.Field` / `.Group` / `.List` / `.SubmitFooter` | `@lobehub/ui/form` |
| 日期 / 月份 / 年份 / 范围            | `DatePicker` / `DateRangePicker`（值为 `Dayjs`）                         | `@lobehub/ui`              |
| 点击就地改文字                       | `EditableText`                                                           | `@lobehub/ui`              |
| 录制键盘快捷键                       | `HotkeyInput`                                                            | `@lobehub/ui`              |
| 搜索框（`mod+k` 只把焦点放进本框，命令面板见 C-05）    | `SearchBar`                                                              | `@lobehub/ui`              |
| 从一组预设色里点选                   | `ColorSwatches`                                                          | `@lobehub/ui`              |
| 拾取任意 hex（饱和度 / 色相 / 吸管） | `ColorPicker`（`onChange` 拖动中，`onChangeComplete` 落笔）              | `@lobehub/ui`              |
| 选头像 / emoji                       | `EmojiPicker`                                                            | `@lobehub/ui`              |
| 选文件 / 拖拽上传                    | `Upload`（`dragger` 时根节点是 `div`）                                   | `@lobehub/ui`              |

表单从自己的入口导入，这样没有表单的页面不会带上表单引擎：

```tsx
import { Form, useForm, useWatch } from '@lobehub/ui/form';

const form = useForm<Values>({ schema, initialValues, onSubmit });

<Form form={form} layout="vertical">
  <Form.Field name="email" label="Email" required>
    <Input />
  </Form.Field>
</Form>;
```

- schema 和 `validate` 放在模块作用域（或 `useMemo`）。写在渲染里会被 `@lobehub/ui/eslint` 的 `no-inline-form-schema` 警告，而且每次渲染都会重建。
- `useForm({ schema })` 只读一次 schema；要换用 `form.setSchema(next)`。
- `items` 数组同样放在组件外或 `useMemo` 里，否则父组件一次渲染会带动每个字段壳。
- 改一个字段只重渲染该字段和 `useWatch` 它的组件。`onValuesChange` 只对用户编辑触发；代码写入要算作用户编辑时传 `{ asUser: true }`。
- 弹层里的表单就是 `Modal` 包一层 `Form`。

### 反馈与状态

| 需要                                      | 用                                                                         | 注意                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 一闪而过的操作结果                        | `toast()`（命令式）                                             | 需在应用里渲染一次 `ToastHost`                                  |
| 常驻的行内提示 / 横幅                     | `Alert`（`variant`: `soft`/`outlined`/`plain`）                 | 不要用 Alert 做瞬时反馈                                         |
| 内容加载中的占位                          | `Skeleton` + `Skeleton.Avatar` / `Skeleton.Text`              | 形状要贴近真实内容；布局已知时用它                              |
| 按钮或图标动作进行中                      | `Button` / `ActionIcon` 的 `loading`                                       | 不要再套一个 Spin                                               |
| 行内同步、遮住现有内容                    | `Spin`（`size`: `small`/`middle`/`large`）                      | 有 `children` 时盖在内容上；`spinning={false}` 只渲染子节点     |
| 模型 / Agent 在思考；控制台卡片或外壳刷新 | `Spin variant="network"`                                      | 控制台里的不确定等待统一用它；dashboard 组件的 `loading` 已内置 |
| 聊天里等第一个 token                      | `LoadingDots`（`chat`，`variant`: `dots`/`pulse`/`wave`/`orbit`/`typing`） | —                                                               |
| 整页结果（成功 / 失败）                   | `Result`（`status`: `success`/`error`/`info`/`warning`）        | 比 Alert 重，比 toast 持久                                      |
| 没有数据                                  | `Empty`（`type`: `default`/`page`，可带 `action`）                   | 必须给下一步动作，不能只写「暂无数据」                          |
| 进度（线 / 环 / 分段）                    | `Progress`                                                    | 确定百分比用它；不确定的等待用 Spin                             |
| 悬停提示                                  | `Tooltip`                                                     | 不能放可交互内容                                                |
| 可交互的浮层内容                          | `Popover`（`trigger`: `hover`/`click`/`both`）                  | 要放链接或按钮就用它                                            |

### 覆盖层与菜单

| 需要                    | 用                                                          | 真实差别                                    |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| 打断流程、要求关注      | `Modal`（命令式 `createModal` / `confirmModal`） | 焦点锁在内部，背景对屏幕阅读器惰性；命令式调用要先渲染一次 `ModalHost` |
| 从边缘滑入的面板        | `Drawer`                                       | 打断程度低于 Modal，可承载更多信息          |
| 底部 / 侧边 sheet       | `FloatingSheet`                                | 移动端常替代 Modal                          |
| 锚定在触发元素上的菜单  | `DropdownMenu`                                 | 有 `trigger`，跟着某个元素                  |
| 右键 / 程序化唤起的菜单 | `showContextMenu()` + `ContextMenuHost`        | 命令式、出现在指针位置，无 trigger 子元素   |
| 常驻导航                | 控制台用 `ConsoleNav`；通用可选行用 `List`（`items` + `activeKey`） | 持久存在，不是浮层 |
| 编辑器里的斜杠命令      | `EditorSlashMenu`                                   | 编辑器专用，不是通用 Select                 |

### 布局与容器

| 需要             | 用                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| flex 排布        | `Flexbox` / `Center`（`gap` 取 `2\|4\|8\|12\|16\|24`）                                    |
| 带表面语义的容器 | `Block`（`variant`: `filled`/`outlined`/`borderless`，另有 `glass`/`shadow`/`clickable`） |
| 自适应列数的网格 | `Grid`（`maxItemWidth`）                                                                  |
| 整页外壳         | `Layout` + `LayoutHeader` / `LayoutSidebar` / `LayoutMain` / `LayoutToc` / `LayoutFooter`       |
| 可拖拽伸缩的面板 | `DraggablePanel`（`placement` 四向，`mode`: `fixed`/`float`）                        |
| 固定窄导航栏     | `SideNav`（`avatar` + `topActions` + `bottomActions`）                                    |
| 可伸缩侧栏容器   | `DraggableSideNav`（仅左右，折叠宽度 = `minWidth`，默认 64px）                            |
| 自定义滚动条     | `ScrollArea`（`scrollFade`）                                                         |
| 滚动到边缘的渐隐 | `ScrollShadow`（保留原生滚动）或 `MaskShadow`（单边静态遮罩）                       |
| 页内目录         | `Anchor`（滚动监听）                                                                            |
| 移动端汉堡菜单   | `Burger`（打开抽屉里的 `List`，或全屏大字）                                          |

`Block` 是 `Flexbox` 的超集（多了表面语义），`Grid` 是 `Flexbox` 之上的 CSS auto-fit 网格。**需要卡片就用 `Block`**。控制台里抬高一档的面板用 dashboard 的 `Surface`，不要用 `Block` 再套一层工作区底色。

`HtmlPreview` 渲染的是不可信 HTML，**不要覆盖它的 `sandbox` 属性**。另外没有 `<html>` 外层的片段会留在 source 视图、不进 iframe，`fullFeatured` / `showLanguage` 在这个组件上是空操作。

### 内容展示

| 需要                               | 用                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 排版文字（省略号、语义色）         | `Text`（`type`: `secondary`/`success`/`warning`/`danger`/`info`；默认渲染 `div`，行内用 `as="span"`）        |
| 完整 markdown / 流式输出           | `Markdown`（`variant`: `default`/`chat`，可开 `enableStream`/`enableMermaid`/`enableLatex`/`enableHtmlPreview`） |
| 只读代码块                         | `Highlighter`（shiki）                                                                                           |
| 可编辑代码                         | `CodeEditor`（`language` 必填）                                                                                  |
| 代码差异                           | `CodeDiff` / `PatchDiff`（`viewMode`: `split`/`unified`）                                                        |
| 可复制的单行命令                   | `Snippet`（支持 `prefix`）                                                                                       |
| 流程图（mermaid）                  | `Mermaid`                                                                                                      |
| 渲染 HTML 产物                     | `HtmlPreview`（沙箱 iframe，`mode`: `preview`/`source`）                                                         |
| 图片（含预览画廊）                 | `Image` / `Image.PreviewGroup`；自定义触发器用 `useImagePreview`，渲染它返回的 `outlet`                        |
| 标签（分类 / 状态）                | `Tag`                                                                                                     |
| 可选择的行（图标、描述、尾部操作） | `List`（`items` + `activeKey`）；带时间、置顶这类业务字段的会话行按 C-11 自建                                |
| 数据表格                           | `Table`（列形状接近 antd，内核是 TanStack Table。服务端排序用 `sorter: true` + `onChange`）                 |
| 增删改查 / 后台列表（请求驱动）    | `ProTable`（`@lobehub/ui/pro-table`，`request` 拉数据，带查询表单或轻量筛选、工具栏、`actionRef` / `formRef`）                       |
| 计数或状态点                       | `Badge`（锚在子元素角上）                                                                                   |
| 页码                               | `Pagination`                                                                                              |
| 评分                               | `Rate`（只读可以是小数）                                                                                    |
| 标签-值描述列表                    | `Descriptions`                                                                                            |
| 带千分位的指标数字                 | `Statistic`；控制台指标瓦片用 dashboard 的 `StatCard`                                                     |
| 多步流程                           | `Steps`                                                                                                   |
| 轮播                               | `Carousel`                                                                                                |
| 二维码                             | `QRCode`（两套主题都是深色码、白底）                                                                        |
| 分隔线                             | `Divider`                                                                                                 |
| 可拖拽排序的列表                   | `SortableList`（dnd-kit）                                                                                        |
| 键盘快捷键展示                     | `Hotkey`                                                                                                       |
| 图表                               | `@lobehub/charts` —— 见 [ecosystem.md](ecosystem.md)                                                                   |

### 图标与头像

| 需要                         | 用                                                                      |
| ---------------------------- | ----------------------------------------------------------------------- |
| 渲染一个图标                 | `Icon`（lucide）                                                  |
| 可点击的图标按钮             | `ActionIcon`                                               |
| 一组图标动作（可带溢出菜单） | `ActionIconGroup`                                               |
| 头像                         | `Avatar` / `AvatarGroup`                                   |
| 多人马赛克头像               | `GroupAvatar`（`grid`: `2`/`3`/`auto`）                           |
| AI 模型 / 厂商 logo          | `@lobehub/icons` —— 见 [ecosystem.md](ecosystem.md)                     |
| OAuth / 社交平台 logo        | `@lobehub/ui/icons`（Auth0、Discord、Slack、WeChat 等）                 |
| emoji                        | `FluentEmoji`（`type`: `anim`/`flat`/`modern`/`mono`/`raw`/`3d`） |
| 文件类型图标                 | `FileTypeIcon`（内置 SVG）或 `MaterialFileTypeIcon`（CDN）              |

## C-03 易混组件对照

外观相似、语义不同。混用会让用户重新学习每个组件在这个产品里的含义。

| 组件对                                                | 看起来像       | 真正差别                                                                                                                           |
| ----------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Tag` / `Badge`                                       | 都是小标签     | `Tag` 表分类、独立、可移除；`Badge` 附着在别的元素上、表计数或状态                                                                 |
| `Modal` / `Drawer` / `FloatingSheet`                  | 都是弹出层     | 打断程度、信息密度、退出方式递减；Modal 最强打断                                                                                   |
| `Tabs` / `Segmented`                                  | 都能切换       | Tabs 管同空间内的多个面板；Segmented 管少量互斥选项，没有独立面板区                                                                |
| `DropdownMenu` / `ContextMenu`                        | 都是菜单       | DropdownMenu 挂在 trigger 上；ContextMenu 命令式、出现在指针处。常驻导航不是菜单，用 `List` / `ConsoleNav`                        |
| `Tooltip` / `Popover`                                 | 都是浮层       | Tooltip 只放简短提示、不能含可交互内容；要放链接或按钮必须用 Popover                                                               |
| `Alert` / `toast`                                     | 都是提示       | Alert 常驻行内；toast 瞬时且命令式调用                                                                                             |
| `Skeleton` / `Spin` / `Spin variant="network"`        | 都是等待       | Skeleton 模拟已知布局、只给首屏；默认 Spin 是通用不确定等待或遮罩；`network` 用于等模型，以及控制台卡片 / 外壳的刷新               |
| `Accordion` / `Collapsible`                           | 都能折叠       | Accordion 管多节（可单开）；Collapsible 只管一个区域                                                                               |
| `SideNav` / `DraggableSideNav` / `LayoutSidebar`      | 都是侧栏       | SideNav 固定窄栏不可调；DraggableSideNav 是通用可伸缩容器（不限导航）；LayoutSidebar 是整页骨架插槽                                |
| `ScrollArea` / `ScrollShadow` / `MaskShadow`          | 都处理滚动边缘 | ScrollArea 替换滚动条 UI；ScrollShadow 保留原生滚动只加阴影；MaskShadow 是单边静态遮罩                                             |
| `Highlighter` / `CodeEditor` / `Snippet` / `CodeDiff` | 都是代码块     | 只读 / 可编辑 / 单行可复制命令 / 前后差异                                                                                          |
| `FileTypeIcon` / `MaterialFileTypeIcon`               | 都是文件图标   | 前者内置 SVG 按扩展名；后者走 CDN 的 Material 图标按文件名，失败回退前者                                                           |
| `Icon` / `ActionIcon` / `ActionIconGroup`             | 都是图标       | 纯展示 / 可点击按钮 / 一组按钮带溢出菜单                                                                                           |
| `Text` / `Markdown`                                   | 都渲染文字     | Text 是排版原语；Markdown 是完整管线（代码、公式、mermaid、流式）                                                                  |
| `Select` / `AutoComplete` / `EmojiPicker`             | 都是选择       | 固定选项 / 自由文本加建议 / 头像与 emoji 选择弹层                                                                                  |
| `ColorSwatches` / `ColorPicker`                       | 都是选颜色     | Swatches 点预设色；ColorPicker 拾取任意 hex，写入放在 `onChangeComplete`                                                           |
| `List` / `ConsoleNav`                                 | 都能做导航     | `List` 是通用可选行（`activeKey` 标当前项）；`ConsoleNav` 是控制台分组侧栏，会随 `ConsoleShell` 收成图标轨                         |
| `Block` / `Surface`                                   | 都是卡片表面   | `Block` 是通用表面（`variant` / `shadow`）；`Surface` 是控制台工作区里抬高一档的面板                                               |
| `Table` / `ProTable`                                  | 都是表格       | `Table` 展示已在手上的数据，排序 / 筛选简单；`ProTable` 用于请求驱动的后台列表：查询表单或轻量筛选、分页请求、刷新 / 密度 / 列设置 |
| `Statistic` / `StatCard`                              | 都是数字       | `Statistic` 只排一个带格式的数；`StatCard` 是控制台指标瓦片，带标签和语义涨跌                                                      |

### 一个具体例子

资产列表里同时有「运行中」「高危」「ECS」「生产环境」四类短文本。全做成同一种 `Tag` 视觉上最整齐，但语义被抹平了，用户的判断会变慢。正确的拆分：

| 字段     | 语义     | 选择                                     |
| -------- | -------- | ---------------------------------------- |
| 运行中   | 运行状态 | 状态标签，取值集合封闭                   |
| 高危     | 风险等级 | 稳定映射到语义色（见 design.md 的 D-03） |
| ECS      | 资源类型 | 分类 `Tag`，不可移除                     |
| 生产环境 | 业务分类 | 分类 `Tag`，可移除                       |

## C-04 对话界面的组合顺序

`@lobehub/ui/chat` 的组件是为固定的组合关系设计的：

```
ChatHeader（可选，配 ChatHeaderTitle）
ChatList                          ← 可滚动区，消费 ChatMessage[]
  └─ ChatItem                     ← ChatList 自动为每条消息渲染
       ├─ EditableMessage         ← 默认消息体
       └─ ChatActionsBar          ← 默认操作栏（复制/编辑/重新生成/删除）
ChatInputArea                     ← 底部输入区
  ├─ ChatInputArea.ActionBar
  ├─ ChatInputArea.Inner
  └─ ChatInputArea.SendButton
BackBottom                        ← 浮层，指向滚动容器
```

要点：

- `ChatList` 接 `data: ChatMessage[]`，通过按角色分派的 `renderMessages` / `renderActions` / `renderErrorMessages` 定制，**不要绕过它自己 map**。
- `ChatItem` 的 `placement`（`left`/`right`）和 `variant`（`bubble`/`docs`）决定气泡形态。
- `ChatInputArea` 基于 `DraggablePanel`，本身可拖拽调高；用 `.Inner` / `.ActionBar` / `.SendButton` 自行组装更自由的布局。
- 移动端换成 `@lobehub/ui/mobile` 的 `ChatHeader` / `ChatInputArea`（带 `safeArea`，不含 DraggablePanel），配 `TabBar` 和 `SafeArea`。这是**显式的另一套组件，不会按视口自动切换**。
- `TokenTag` 显示 token 用量（`mode`: `remained`/`used`），通常放在头部或工具栏。
- 工具调用和思考过程**没有现成的消息块**。`ChatMessage` 上有 `plugin` 字段，结构自己渲染；等待模型时用 `Spin variant="network"`，不要用默认 `Spin` 或第三方加载包。

对话流之外还有三个编辑器组件，容易被漏掉：

| 需要                                               | 用                                         |
| -------------------------------------------------- | ------------------------------------------ |
| 调 prompt：编辑 system / user / assistant 消息列表 | `EditableMessageList`（收 `LLMMessage[]`） |
| 代码编辑器形态的消息编辑（带确认/取消）            | `MessageInput`                             |
| 把消息编辑放进弹层                                 | `MessageModal`                             |

`EditableMessage` 会在内部用到后两者。

## C-05 这个库里没有的组件

| 期望的组件                                                                       | 去哪里拿                                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 卡片                                                                             | `Block`，或 dashboard 的 `Surface`                                         |
| 浮动按钮                                                                         | 定位过的 `ActionIcon` / `Button`。没有浮动按钮组件                          |
| 虚拟滚动                                                                         | `MenuVirtualList` / `VirtualScrollArea` / `useMenuVirtualList`              |
| 命令面板 / 全局搜索弹层 | 没有现成件。用 `Modal`（`footer={false}`）包一个 `SearchBar`：文档级 `Mod+K` 负责开关，弹层里的 `SearchBar` 关掉 `enableShortKey`，避免两层抢同一个键。`destroyOnHidden` 时在 `afterOpenChange` 里聚焦输入框，跟着 `open` 的 `useEffect` 会在输入框挂上之前聚焦落空。结果条数会变时给结果区最小高度，或把弹窗钉在视口顶部，免得整块上下跳。`awesome` 的 `Spotlight` 是光斑效果，不是搜索界面 |

## C-06 其他命名空间

| 命名空间                   | 装什么                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lobehub/ui/form`        | 受控表单：`Form` · `useForm` · `useWatch`。不要从别的入口导入 `Form`                                                                                                                     |
| `@lobehub/ui/pro-table`   | 请求驱动的后台列表：`ProTable`。只展示已有数据用根入口的 `Table`（见 C-08）|
| `@lobehub/ui/dashboard`    | 控制台骨架，见 C-07                                                                                                                                                                      |
| `@lobehub/ui/awesome`      | 营销页。整页组合交给 `building-landing-home`。效果件：`AuroraBackground` · `GradientButton` · `Spotlight` · `SpotlightCard` · `FluidGradient` · `TypewriterEffect` · `Spline` · `Giscus` |
| `@lobehub/ui/brand`        | `LobeHub` · `LobeChat` 及其文字标 · `Logo3d` / `LogoFlat` / `LogoMono` · `BrandLoading`                                                                                                  |
| `@lobehub/ui/mdx`          | 文档渲染：`Mdx` · `mdxComponents` · `Callout` · `Cards` · `Steps` · `FileTree` · `Tabs`                                                                                                  |
| `@lobehub/ui/color`        | 色阶数据：`colors` / `colorScales` / `neutrals`（见 [design.md](design.md)）                                                                                                             |
| `@lobehub/ui/i18n`         | `I18nProvider` · `useTranslation` · `en` / `zhCn` 资源                                                                                                                                   |
| `@lobehub/ui/storybook`    | 演示用：`StoryBook` · `useControls`（不是生产 UI）                                                                                                                                       |
| `@lobehub/ui/eslint`       | 强制 C-01 导入规则的 eslint 配置，另有 `no-inline-form-schema`                                                                                                                       |

`awesome` 里的东西是给落地页的。**不要把 `AuroraBackground`、`GradientButton`、`SpotlightCard`、`FluidGradient` 搬进控制台或应用内页面**——那正是 AI 味的来源之一（见 [craft.md](craft.md) 的 K-01）。

## C-07 控制台套件

`@lobehub/ui/dashboard` 是产品控制台的骨架，不是另一套按钮。品牌、导航项、账户槽都空着，由应用填。

| 需要                     | 用                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| 整页：可折侧栏 + 工作区  | `ConsoleShell`。宽屏收成图标轨，窄屏变抽屉，Mod+B 切换；`storageKey` 记住折叠。品牌用 `ConsoleBrand`  |
| 分组侧栏导航             | `ConsoleNav`。链接渲染交给应用，不绑路由器。徽章在图标轨上变成点                                      |
| 页头（标题、说明、操作） | `PageHeader`                                                                                          |
| 顶栏位置                 | dashboard 的 `Breadcrumb`（当前页是纯文本，窄屏丢掉分组名）。应用内通用路径用 `Breadcrumb` |
| 工作区里的面板           | `Surface`。底、边框、明暗由组件处理；选型见「控制台：按场景选组件」                                   |
| 指标瓦片                 | 单个用 `StatCard`，一组用 `MetricStrip`（`joined` / `split`），见「控制台：按场景选组件」             |
| 页内切换                 | `PageTabs`。条带横向滚动，不换行                                                                      |
| 左侧筛选 + 右侧内容      | `FilterSidebar`。窄屏收进抽屉。`FilterRow` 是树节点，`FilterOption` 是平铺选项                        |
| 登录 / 注册框            | `AuthLayout`。父级要有高度                                                                            |
| 路由切换时的顶栏         | `RouteProgress`。把路由器的 loading 传进去                                                            |
| 控制台页的加载形         | `PageLoading` / `PageHeaderSkeleton` / `StatCardSkeleton` / `TableSkeleton`                           |

控制台密度见 [craft.md](craft.md) 的 K-09。不要在 `Surface` 上再叠玻璃、渐变或等大卡片墙。

## C-08 控制台：按场景选组件

`@lobehub/ui/dashboard` 的卡片底、边框、阴影、明暗、嵌套、固定列都已在组件里处理。这里只记「什么场景用哪个」和调用方必须知道的注意事项，不记组件内部的取值。

| 场景                                                      | 用                                                                           | 注意                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单个指标，独立成卡（和图表卡并排、单独占一格）            | `StatCard`                                                                   | 长得和一格 `MetricStrip` 一样。`prominent` / `wash` 已废弃、不生效，语义只放在 `delta` / `direction` / `valueTone`                                                                                                                                                                                                                                                                                                                |
| 一组等权指标，只展示                                      | `MetricStrip`（默认 `variant="joined"`：一张卡，格间分割线）                 | 不要拆成一排自己写的卡片                                                                                                                                                                                                                                                                                                                                                                                                          |
| 一组指标要各自成卡（每格可点、带 `action`、和别的卡混排） | `MetricStrip variant="split"`                                                | split 的每格和 `StatCard` 完全一致，不要混用自写指标卡                                                                                                                                                                                                                                                                                                                                                                            |
| 点了会筛表的计数                                          | `FilterStrip`                                                                | 只展示用 `MetricStrip`                                                                                                                                                                                                                                                                                                                                                                                                            |
| 工作区里的面板（标题 / 说明 / `extra` / 表 / 图）         | `Surface`                                                                    | 有 `href` 时右上角箭头总在 `extra` 之后、最右。表放进来会自动贴边，不要再套外框                                                                                                                                                                                                                                                                                                                                                   |
| 只有标题 + 正文的简单面板，加载时保留旧内容               | `PanelSurface`                                                               | `loading` 且有内容时 `extra` 位置换成刷新指示                                                                                                                                                                                                                                                                                                                                                                                     |
| 页面里的分区（标题 + 一组卡片）                           | `Section`                                                                    | 分区用标题，不要卡片套卡片                                                                                                                                                                                                                                                                                                                                                                                                        |
| 登录 / 注册 / 一次性确认                                  | `AuthLayout`                                                                 | `background="grid"` + `variant="elevated"` 是登录页形态；`logo` / `alert` / `footer` 用槽位，不要往 children 里塞；`loading` 出表单骨架；右侧插画用 `AuthLayout.Aside` + `@lobehub/ui/awesome` 的 `Grainient lightMode="auto"`；角落工具用 `AuthThemeSwitch` / `AuthLocaleSwitch`（受控，自己接 store）。404 / 无权限等状态页用 `card={false}` 复用页头和工具。默认 `min-block-size: 100dvh`，嵌在定高容器里要覆盖 `minBlockSize` |
| 会话 / 菜单还没就绪时的整页外壳                           | `ConsoleShell loading`                                                       | 品牌、`tools`、`storageKey` 照常传；导航和底栏自动换成 `ConsoleNavSkeleton`，正文默认 `PageLoading`，可用 `loadingContent` 换掉；要和真实菜单对齐就传 `loadingNavigation={<ConsoleNavSkeleton groups={groups} />}`                                                                                                                                                                                                                |
| 首次加载、版面已知                                        | `Skeleton` / `PageLoading` / `StatCardSkeleton` / `TableSkeleton`            | 骨架只给首屏无数据时；已有数据的刷新不要盖骨架                                                                                                                                                                                                                                                                                                                                                                                    |
| 卡片 / 外壳里的刷新、不确定等待                           | 组件自己的 `loading` / `refreshing`；自己放指示时用 `Spin variant="network"` | 控制台里统一 network 形态。按钮、图标动作用它们自己的 `loading`                                                                                                                                                                                                                                                                                                                                                                   |
| 删除、撤销等破坏性图标动作                                | `ActionIcon danger`                                                          | 颜色梯度组件内已处理，不要自己给图标涂 `colorError`                                                                                                                                                                                                                                                                                                                                                                               |

注意事项：

- 卡片放在非默认页面底上（例如自定义画布色）时，在外层设 `--lobe-surface-canvas`，固定列等需要不透明底的地方才能算对。
- 卡片头里的控件（`Segmented`、`ActionIcon`、`Select`）用紧凑尺寸：`Segmented size="small"`、`ActionIcon size="small"`。头部行高固定在标题行，大控件不会撑高卡片但会溢出显得挤；同一行卡片有的带控件有的不带时，标题、数字和图表仍应横向对齐。
- 应用里确实要自己画卡片状的边框或分割线时，用 `colorFillSecondary`（悬停 / 聚焦用 `colorFill`），不要用实色 `colorBorder` / `colorBorderSecondary`。布局容器（`ConsoleShell`、`ConsoleNav`、`FilterSidebar` 分栏线）不在此列。
- 表格选型：数据已经加载好、只做展示和简单排序 / 筛选，用 `Table`；数据由接口按页码、搜索条件、排序拉取，并需要查询表单、刷新、密度、列设置等工具栏能力的增删改查列表，用 `ProTable`。不要用 `Table` 手拼查询表单 + 请求 + 工具栏。
- `Table` / `ProTable` 的 `variant` 按所处容器选：放在 `Surface`、卡片等已有边框的容器里用 `borderless`（默认），独立放在页面上没有外框时用 `outlined`，不要在带框容器里再给表格加一圈框。
- `ProTable` 筛选形态：字段少（约 4 个以内）、选完即查、和标题工具栏同一行即可的，用 `search={{ filterType: 'light' }}`；字段多、需要标签、校验或显式「查询 / 重置」的，用默认查询表单（`filterType: 'query'`）；只按一个关键字搜时用工具栏 `options.search`，不要另开表单。
- 不要在应用里覆盖 lobe-ui 主题变量（如 `--lobe-color-border`、`--lobe-color-border-secondary` 加 `!important`）。看起来不对就修 lobe-ui 上游组件。

## C-09 需要解释的列名和卡片标题用 `TitleWithTips`

| 场景 | 用 | 注意 |
| --- | --- | --- |
| 表格列名需要一句解释（口径、排除条件） | 列的 `title` 传 `@lobehub/ui/dashboard` 的 `<TitleWithTips title="…" tips="…" />` | 不要把列名文字直接包进 `Tooltip`：纯字符串子节点会落进 `Tooltip.Trigger` 默认的 `<button>`，渲染成一块灰底。说明挂在列名后的信息图标上，列名本身不加样式 |
| 这一列同时可排序 | 再设 `showSorterTooltip={false}` | 不关时悬停会叠出两层提示：表格的排序提示和列名说明 |
| 卡片标题需要口径说明、长解释 | `Surface` 的 `title` 传 `TitleWithTips` | 卡片 `description` 只留一句。长段口径不要放进卡片里的小字号展开面板（`Accordion`、「查看说明」） |

核对：悬停信息图标只出一层提示，列名在表头里没有灰底块。

## C-10 构成 / 排名条用 `BarList`

| 场景 | 用 | 注意 |
| --- | --- | --- |
| 一组类别的人数、占比构成或排名 | `@lobehub/charts` 的 `BarList`（项目有 `@/components/Charts` 封装时从那里引入） | 不要手写 `div` 轨道加百分比宽度。值写进 `valueFormatter`（例如「人数 · 占比」）；类别顺序本身有含义时设 `sortOrder="none"` |
| 构成里某一项还要再拆 | 明细做成同级的另一张卡，和原卡在 `ChartGrid` 里并排 | 不要在条下面嵌第二层列表或缩进的子条 |
| 构成的口径需要长解释 | 卡片标题用 `TitleWithTips`（C-09） | 不要用小字号的行内展开面板 |

核对：页面里搜不到自绘的百分比宽度轨道；拆出的明细是独立的卡片。

## C-11 分层边界：原子层取用，组合层自建

组件库能覆盖的深度是有限的。**越是贴近业务语义的组合，越应该由项目自己构建**——`chat` 这类系列组件就是从这个判断里长出来的。

| 层 | 例子 | 怎么办 | 为什么 |
| --- | --- | --- | --- |
| **原子层** | `Button` · `Input` · `Modal` · `Table` · `Tag` · `Tooltip` | **必须**从 `@lobehub/ui` 取用（C-01 硬性规则，由 lint 兜底） | 视觉与交互细节需要全局一致；自建只会漂移 |
| **皮肤层** | `Block` · `Surface` · `ConsoleShell` · `PageHeader` | 用 lobe-ui / dashboard 现成的 | 表面工艺、暗色、嵌套已经处理好（D-06） |
| **组合层** | 会话区、消息体、工作流画布、业务卡片簇 | **优先自建**，用原子层和皮肤层拼 | 业务语义只属于这个产品；库里的通用组合必然要妥协 |
| **领域层** | Agent 会话、模型调用、审批流 | **必须自建** | 这是产品本身，不是组件库的职责 |

**判据（组合层该不该自建）：**

1. 这个组合的**布局由业务语义决定**（例如「用户消息靠右、工具调用折叠、错误消息另起一栏」）→ 自建。库里按角色分派的 `renderMessages` 就是为这件事留的口子。
2. 这个组合需要**跨多个页面复用**，且各处取值一致 → 自建一个项目内组件，而不是每处用原子层拼一遍。
3. 只是为了**外观**相近（想要卡片、想要标签）→ 不自建，用皮肤层现成件。

**组合层的三条约束：**

- 内部只能用原子层和皮肤层，不再引入第二套基础件（不引入 antd 这类组件库、不引入第二个图标库）。
- 取值仍然走 `cssVar`（D-01），自建 ≠ 可以写裸色值。
- 项目内自建组件放在项目的组件目录（如 `src/components/<域>/`），**不要去改 lobe-ui 的源码**——那样会在升级时全部丢失。

**反过来的误用同样要避免：** 把 `Table`、`Modal`、`Input` 这类原子件在项目里重写一遍。这不会更贴合业务，只会让暗色、键盘、焦点管理各自为政。

`chat` 系列是这条边界的参照实现：**布局顺序由业务定 → 自建；气泡、输入框、加载点这些零件 → 取用库里的。** 新做业务组合件时照这个比例来。

## C-12 可访问名：以可访问性树为准

适用：聊天输入区和消息上的图标按钮、设置页的开关与下拉、任何页面的筛选栏。

- 名字优先来自可见的标签（作为 `Form.Field` 的子节点，把文案传给 `label`）；紧凑的筛选栏可以用 `Select` 的 `prefix` 写标签文字，它同时成为触发器的可访问名。要隐藏标签时做成读屏文本，不要 `display: none`。
- 纯图标按钮写 `aria-label`，描述动作；`ActionIcon` 的字符串 `title` 只是 tooltip。
- 复选框的名字只放名称，说明放在兄弟节点上，用 `aria-describedby` 关联，避免名字读两遍。
- 验收在可访问性树里核对名字，不要用 `textContent` 自己拼。某个组件把 `aria-*` 丢掉属于组件问题，报给 lobe-ui，这里不记绕法。

## C-15 确认弹窗与浮层菜单

适用：会话列表的行菜单、头像面板里的语言 / 外观切换、删除确认、表格或列表里的悬停提示。

- 确认按钮写动作本身（W-01），不留默认的 `OK` / `Cancel`；`title` 只放动词加对象，数量、不可撤销等后果写在 `content`。
- 确认要等这次写入完成才关：进行中显示在按钮上，失败写在弹窗里。不可逆操作提交期间不允许关闭。
- 整块已经是链接的卡片或行里不要再放按钮；浮层里的点击不应触发外层的行点击。
- 面板里的二级选择（语言、外观）用菜单，不要再套一层弹层面板；单选菜单勾出当前值。

## C-17 表单：就地编辑

适用：聊天应用的设置页、登录与改密码、任何对象的属性设置。

- 对象的属性就地编辑：左边标题加一句说明，右边是控件，底栏保存。不要画成只读的键值卡再打开编辑弹窗。没有权限的项显示为文字或 `Snippet`，不要一排灰掉的输入框。
- 登录、改密码这类短表单字段排得紧，间距只留在字段之间；设置页的分组表单保留分割线和组间距。
- 重置和稍后才到的已保存值都要回显到控件上；保存成功后控件显示的就是刚保存的值。

