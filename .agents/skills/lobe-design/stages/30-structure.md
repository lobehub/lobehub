# Stage 30 · 结构与组件（structure）

> 只回答一个问题：**这块界面是不是用对的 lobe-ui 零件、按对的骨架搭起来的。**
> **LobeUI 架构规范只在本 stage 讨论。** 其他 stage 遇到架构问题，只记一行 `遗留 → 30`。

## 聚焦

- 导入入口、Provider、样式写法（下方「硬性前提」）
- **分层判定**：这段界面里的每个部分，属于原子层 / 皮肤层 / 组合层 / 领域层里的哪一层（C-11）；组合层与领域层自建，原子层取用
- 页面类型 → 骨架（外壳、主区 / 侧栏 / 操作区 / 状态区的关系）
- 区域顺序：按 00 brief 的「决定所需信息」排，不按字段排
- 每段信息的组件语义：状态、分类、动作、容器还是导航，再选组件
- 生态包选型：图表、模型徽标、emoji、流式 markdown
- 有没有自己重写组件已经处理好的东西（卡片底、边框、明暗、加载形）

## 不负责

- 间距大小、颜色深浅、字号字重、对齐、密度微调、AI 味 → 50
- 视觉方向、构图、字阶 → 20
- 流程是否顺 → 40；文案措辞 → 75；状态和边界是否齐全 → 70
- 打分、放行 → 80
- 「好不好看」。组件和骨架选对，就交给 50。

## 输入

- 00 brief：`原型` → 选骨架；`决定所需信息` → 区域顺序（**必需**）
- 按场景不同，以下之一：40 规划模式的 L1–L6 / 20 的方向卡与 section 序列 / 10 的区域清单 / 60 派发的组件收敛清单
- 目标代码

## 只加载（只读和本次改动相关的条目）

- [components.md](../references/components.md)：C-01 原子层从 `@lobehub/ui` 取用（硬性规则）· **C-11 分层边界：原子层取用，组合层自建** · C-02 按需求查 · C-03 易混组件 · C-04 对话界面组合顺序 · C-05 库里没有的组件 · C-06 其他命名空间 · C-07 控制台套件 · C-08 控制台按场景选组件 · C-09 `TitleWithTips` · C-10 `BarList`
- [ecosystem.md](../references/ecosystem.md)：E-01 图表 · E-03 模型徽标 · E-04 emoji · E-05 流式 markdown · E-06 边界
- [design.md](../references/design.md)：D-01 cssVar 是唯一事实源（写法层面） · D-06 复用现成表面工艺 · D-07 品牌气质走主题（**定制色板 / 换品牌主色** → lobe-ui [`tuning-color-palettes`](https://github.com/lobehub/lobe-ui/tree/master/.agents/skills/tuning-color-palettes)，本机已安装则按名调用）
- [craft.md](../references/craft.md)：K-10 编码陷阱

## 硬性前提（由 `scripts/lint-lobe.mjs` 机械校验，规则 id 见括号）

**这些约束只覆盖原子层**（按钮、输入、表格、弹层这类不可再分的零件）。业务组合件按 C-11 自建，不受下面这些条目的限制——但仍要遵守「取值走 cssVar」。

1. 组件从 `@lobehub/ui` 导入，表单从 `@lobehub/ui/form`、请求驱动的表格从 `@lobehub/ui/pro-table` 导入；应用里不用 `antd` / `antd-style`（`LOBE-ANTD-IMPORT`、`LOBE-FORM-ENTRY`）；操作结果提示用 `toast`；图标用 `lucide-react` + `Icon`（`LOBE-ANT-ICONS`）。
2. 样式只写 `createStaticStyles` + `cssVar`（从 `@lobehub/ui` 导入），不用 `createStyles`（`LOBE-CREATE-STYLES`）。css 模板里注释只用 `/* */`（`LOBE-CSS-LINE-COMMENT`）。
3. 应用根部导入一次 `@lobehub/ui/theme.css` 与 `@lobehub/ui/style.css`；`ConfigProvider` 包住应用并显式传 `motion`，文案走它的 `locale` / `resources`，不嵌套 `I18nProvider`（`LOBE-I18N-PROVIDER`）；用到 `toast` / `createModal` / `confirmModal` 时各渲染一次 `ToastHost` / `ModalHost`。
4. 不用 `!important` 覆盖主题变量（`--lobe-*`，`LOBE-ANT-VAR-OVERRIDE`），不写 `.ant-` 类名（`LOBE-ANT-CLASS`）；定制走 `className` / `classNames` 槽位和组件文档里的 `data-*` 属性。

```ts
import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));
```

```tsx
import '@lobehub/ui/theme.css';
import '@lobehub/ui/style.css';

<ConfigProvider locale="zh-CN" motion={motion} resources={zhCn}>
  <App />
  <ToastHost />
  <ModalHost />
</ConfigProvider>
```

## 骨架

| 场景 | 起点 |
| --- | --- |
| 文档 / 应用页面外壳 | `Layout` + `LayoutHeader` / `LayoutSidebar` / `LayoutMain` / `LayoutToc` / `LayoutFooter` |
| 产品控制台 | `@lobehub/ui/dashboard`：`ConsoleShell` + `ConsoleNav` + `PageHeader` + `Surface`（C-07） |
| 对话界面 | `ChatHeader` → `ChatList` → `ChatInputArea`（C-04） |
| 移动端外壳 | `@lobehub/ui/mobile` 的 `ChatHeader` / `ChatInputArea` / `TabBar` / `SafeArea` |
| 固定窄导航 / 可伸缩面板 | `SideNav` / `DraggableSideNav` / `DraggablePanel` |
| 0→1 视觉页 | `@lobehub/ui/awesome` 的区块组件作为零件；**楼层顺序以 20 的 section 序列为准**，不要按组件库示例的顺序拼 |

骨架决定主区、侧栏、操作区和状态区的关系。这一步错了，整页都会偏：列表页被做成卡片墙、批量任务页没有批量操作区，后面怎么换组件都救不回来。

## 检查清单

1. `node scripts/lint-lobe.mjs <目标路径>` 无 FAIL（硬性前提由脚本判定，不用逐条人工看）。
2. 骨架和 brief 的原型 / 页面类型匹配；没有把列表页做成卡片墙，没有卡片套卡片。
3. 区域顺序和 brief「决定所需信息」的顺序一致。
4. 每个短文本、图标、按钮都按语义选组件，易混组件按 C-03 区分。
5. 卡片、表面、加载形用现成组件，不手写底色和边框。
6. 同类需求不引入第二个依赖（例如第二个图表库、远程抓 SVG 徽标）。
7. **分层判断过一遍（C-11）**：原子层和皮肤层没有被重写；业务组合件没有硬套库里不贴合的通用组件。自建的组合件内部只用原子层和皮肤层，取值仍走 `cssVar`。

## 症状 → 规则

| 症状 | 规则 |
| --- | --- |
| 引入了 antd / antd-style 的组件或样式 API | C-01 |
| 表单从错误入口导入，或 schema 写在渲染里 | C-02 |
| 组件外观像但语义用错（Badge/Tag、Modal/Drawer） | C-03 |
| 落地页效果被搬进控制台 | C-06 |
| 列名包进 Tooltip 后成了一块灰底 | C-09 |
| 构成 / 排名条是手写 div 轨道 | C-10 |
| 自己给卡片写底、边框、阴影 | D-06 |
| 把 `Table` / `Modal` / `Input` 这类原子件在项目里重写了一遍 | C-11（原子层必须取用） |
| 业务组合直接套库里的通用组件，再打一堆覆盖补丁 | C-11（组合层应自建） |
| 图标按钮、开关或下拉在读屏里没有名字，或名字读两遍 | C-12 |
| 确认按钮是英文 OK 或「确定」；请求还没完成弹窗就关了，失败落在弹窗外 | C-15 |
| 对象属性画成只读键值卡，改一个值要另开编辑弹窗；重置后控件仍显示旧值 | C-17 |
| 想要命令面板，却找不到组件或自己重写了一个 | C-05 |
| 面板里的卡片或代码块高度为 0，列不再滚动 | K-10 |
| 厂商徽标是灰色插头，或换成了别的品牌 | E-03 |
| 中文界面的空图表显示英文 No Data | E-01 |

## 输出

```
[30 · structure] 完成
lint：<命令 + RESULT 行>
改动：<文件 / 区域 —— 一句话，带规则编号>
遗留：<问题 → 40 / 50 / 70>
缺口：<D-11 格式，没有写「无」>
```
