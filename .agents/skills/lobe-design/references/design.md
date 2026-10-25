# design.md — 视觉事实源

<!-- refs:meta
tier: index
scope: 设计 token 与取值；cssVar 是唯一事实源
entries:
  D-01  | deep | token,cssvar,样式写法,事实源
  D-02  | deep | 视觉角色,配色角色,文字色
  D-03  | deep | 状态色,成功,失败,危险色
  D-04  | deep | 圆角,间距,字号,几何取值
  D-05  | deep | 色阶,分类色,互相区分
  D-06  | deep | 表面,卡片,边框,阴影工艺
  D-07  | deep | 品牌,主题,覆盖变量,品牌色,主色,色板,定制色板,调色,primaryColor,data-primary-color
  D-08  | deep | 暗色,深色,明暗
  D-09  | deep | 响应式,断点,窄屏
  D-10  | deep | 执行约束,裸值,硬编码
  D-11  | deep | 缺口,失败,上报,没有对应值
-->

定义视觉系统怎么表达、怎么取值、怎么派生、怎么暴露缺口。

不判断某个业务状态意味着什么（那是领域语义），也不评判一个页面用得是否克制（那是 [craft.md](craft.md)）。同一个红色，在这里只回答一件事：**它引用哪个 token**。

规则可被 [evaluator.md](evaluator.md) 按编号引用。

## D-01 唯一事实源是 cssVar

> 平台作用域：web / desktop。RN 项目的唯一事实源是项目主题（`useTheme()` token），写法见 50-visual；原则相同：组件里不写裸值。

```ts
import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar, cx, responsive }) => ({
  root: css`
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
    color: ${cssVar.colorText};
  `,
}));
```

`cssVar.xxx` 输出的是 CSS 变量引用，随明暗外观自动切换。这是它比 `token.xxx` 更重要的原因：**用 cssVar 写的样式天然支持暗色模式，不需要任何分支**。

只用 `createStaticStyles`，组件的 `style.ts` 一律这个写法。依赖 props 的样式写成变体（`cx(styles.base, active && styles.active)`），或挂在 `style` 上的 CSS 变量。

## D-02 先判断视觉角色，再取 token

把 token 当色板用（「看到蓝色就随手取一个接近的蓝」）是系统失去一致性的起点。

| 角色                   | token                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| 页面底色               | `colorBgLayout`                                                                  |
| 卡片 / 内容表面        | `colorBgContainer`                                                               |
| 介于两者之间的表面     | `colorBgContainerSecondary`（lobe-ui 自有，二者 50% 混合）                       |
| 浮层表面（弹窗、菜单） | `colorBgElevated`                                                                |
| 遮罩                   | `colorBgMask`                                                                    |
| 主文字                 | `colorText`                                                                      |
| 次要文字               | `colorTextSecondary`                                                             |
| 更弱的文字             | `colorTextTertiary` → 最弱 `colorTextQuaternary`                                 |
| 描述文字               | `colorTextDescription`                                                           |
| 边框                   | `colorBorder`，更弱 `colorBorderSecondary`                                       |
| 填充（悬停底、轨道）   | `colorFill` > `colorFillSecondary` > `colorFillTertiary` > `colorFillQuaternary` |
| 主 CTA / 品牌实色      | `colorPrimary`，悬停 `colorPrimaryHover`，按下 `colorPrimaryActive`              |
| 低强度品牌强调         | `colorPrimaryBg` / `colorPrimaryFillTertiary`                                    |
| 正文链接               | `colorLink`，悬停 `colorLinkHover`                                               |
| 阴影                   | `boxShadow` / `boxShadowSecondary` / `boxShadowTertiary`                         |

四档 `colorFill` 和四档 `colorText` 是**层级**而不是同义词。同一视觉层的两个元素不应该取不同档位。

## D-03 状态色一律从基础 token 派生

五组语义色，每组都有完整的角色派生。**不要为某个状态新造颜色**——没有派生机制，每个状态都会被重新发明一个值：今天按钮 hover 深一点，明天卡片 selected 浅一点，后天暗色模式又换一套。

```
color{Primary|Success|Warning|Error|Info} 各自提供：
  {}                       实色（主色）
  {}Hover / {}Active       交互态
  {}Bg / {}BgHover         浅色底
  {}Border / {}BorderHover 边框
  {}Text / {}TextHover / {}TextActive           文字
  {}Fill / {}FillSecondary / {}FillTertiary / {}FillQuaternary  填充档位
```

**已知缺口：** `colorErrorFillTertiary` 和 `colorErrorFillSecondary` 不在 `cssVar` 里。需要错误色浅底时用 `cssVar.colorErrorBg` / `cssVar.colorErrorBgHover`。

## D-04 几何与排版取值

| 用途     | token                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| 圆角     | `borderRadiusXS` 4 · `borderRadiusSM` 6 · `borderRadius` 8 · `borderRadiusLG` 12 |
| 控件高度 | `controlHeight` 36（组件尺寸另有常量：small 24 / middle 32 / large 40）          |
| 字体     | `fontFamily`（西文 → 中文 → 回退 → emoji 的完整栈）                              |
| 等宽字体 | `fontFamilyCode`                                                                 |

**没有** `borderRadiusLarge`，用 `borderRadiusLG`。

圆角是嵌套关系：内层 = 外层 − padding。外层 `borderRadiusLG`（12）配 4px padding，内层取 `borderRadius`（8）。两层同值会出现可见缝隙。

字体栈是 `theme.css` 里的 `fontFamily` token（`global.css` 把它设为页面字体），包含中文字体。需要自定义字体时走 `ConfigProvider` 的 `customFonts` / `enableCustomFonts`。**不要在组件里另写 `font-family`**——这是中文行高、标点和字重失真的主要来源。

## D-05 预设色阶用于「需要互相区分」的场合

13 个预设色：`red` `volcano` `orange` `gold` `yellow` `lime` `green` `cyan` `blue` `geekblue` `purple` `magenta` `gray`。

每个色提供：

```
{color}1 … {color}11      实色色阶
{color}1A … {color}11A    带透明度的色阶
{color}Fill / FillSecondary / FillTertiary / FillQuaternary
{color}Bg / {color}BgHover
{color}Border / {color}BorderSecondary / {color}BorderHover
{color}                   主色
{color}Hover / {color}Active
{color}Text / {color}TextHover / {color}TextActive
```

例如 `cssVar.geekblueText`、`cssVar.redFillTertiary`、`cssVar.gray7`。

这些用于**需要多个互相区分的颜色**：图表系列、分类标签、多维度对比。单个元素的主次强调走 `colorPrimary` 和中性灰阶，不要从预设色里随手挑一个。

## D-06 复用现成的表面工艺

不要每次重写边框和背景：

```ts
import { lobeStaticStylish } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cx }) => ({
  card: cx(
    lobeStaticStylish.variantFilled,
    css`
      padding: 12px;
    `,
  ),
}));
```

| 工艺                                                                        | 用途                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------ |
| `variantFilled` / `variantOutlined` / `variantBorderless`                   | 三种表面形态，各自带 hover                       |
| `variantFilledDanger` / `variantOutlinedDanger` / `variantBorderlessDanger` | 危险态版本                                       |
| `variant*WithoutHover`                                                      | 不需要交互反馈的静态表面                         |
| `active`                                                                    | 选中态（文字 + 填充）                            |
| `disabled`                                                                  | `cursor: not-allowed; opacity: 0.5`              |
| `shadow`                                                                    | 多层阴影，明暗模式取值不同                       |
| `blur` / `blurStrong`                                                       | 模糊 10px / 36px——只给语义浮层，见 K-04          |
| `gradientAnimation`                                                         | 品牌循环渐变（gold → magenta → geekblue → cyan） |
| `noScrollbar` / `bottomScrollbar`                                           | 滚动条处理                                       |
| `resetLinkColor`                                                            | 次要文字色的链接                                 |

`Block`、`ActionIcon`、`Alert` 等组件的 `variant` prop 就是这套工艺的封装。**能用 prop 表达就不要自己写 CSS。**

## D-07 品牌气质通过主题声明，不靠覆盖 token

主色和中性色是 `<html>` 上的两个属性：

```tsx
setLobeTheme({ primaryColor: 'geekblue', neutralColor: 'slate' }); // 客户端
<LobeThemeScript primaryColor="geekblue" neutralColor="slate" />; // 服务端渲染，首帧前写好
```

静态 HTML 直接写 `<html data-primary-color="geekblue" data-neutral-color="slate">`。页面里一块要用另一套主题时包 `<ThemeScope primaryColor neutralColor appearance>`，不要手动给任意元素设属性。

- `primaryColor`：`blue` `cyan` `geekblue` `gold` `green` `lime` `magenta` `orange` `purple` `red` `volcano` `yellow`
- `neutralColor`：`mauve` `olive` `sage` `sand` `slate`

中性色温决定页面底色偏暖、纯灰还是偏冷，会联动 `colorBgLayout` / `colorBgContainer` / `colorText` / `colorBorder` 一整组中性色。品牌色会派生出完整色阶，再挑出 hover / active / surface / border / text 各角色。

**换品牌主色、定制企业色板、重调状态色或色阶时**，不要在本 skill 里手改 hex / 覆盖 `--lobe-color-primary*`：改去 lobe-ui 的 [`tuning-color-palettes`](https://github.com/lobehub/lobe-ui/tree/master/.agents/skills/tuning-color-palettes) skill（若本机已安装，按技能名 `tuning-color-palettes` 调用）。本规则只覆盖「用哪个具名主题声明」；生成 / 审计 / pin 色阶属于那个 skill。

项目自己的 token 用项目自己的前缀写在应用 CSS 里，不要写成 `--lobe-*`，也不要改写 lobe-ui 的变量。

## D-08 暗色模式默认不需要分支

外观由 `<html data-theme="light|dark">` 决定：客户端用 `setLobeTheme({ appearance })`，服务端渲染用 `LobeThemeScript`（跟随系统传 `appearance="system"`）；用 next-themes 时设 `attribute="data-theme"`，由它管这个属性。

绝大多数样式不需要为暗色写任何分支——D-01 已经处理了。只在「token 选择本身要变」时才读运行时状态：

```ts
import { useThemeMode } from '@lobehub/ui';

const { isDarkMode } = useThemeMode();
const resolvedVariant = variant ?? (isDarkMode ? 'filled' : 'outlined');
```

如果发现自己在写 `isDarkMode ? '#fff' : '#000'`，说明该换成 token。需要具体色值（canvas、图表、颜色运算）时用 `useTheme()`，它带 token 值和 `isDarkMode`。

## D-09 响应式只管视觉规则

```ts
createStaticStyles(({ css, responsive }) => ({
  root: css`
    padding-inline: 24px;

    ${responsive.sm} {
      padding-inline: 12px;
    }
  `,
}));
```

这一层管断点下字号如何缩放、间距如何收缩、触达面积如何保持。**页面从几栏变几栏属于骨架**，走 `Layout` 或换用 `@lobehub/ui/mobile` 的组件。

## D-10 执行约束

1. 颜色、圆角、阴影、字体一律走 `cssVar`。代码里不应出现裸 hex 或裸 rgba。
2. 间距可以写数值（库内普遍如此），但要用 4 的倍数并在同一区域内保持一致；`Flexbox` 的 `gap` 优先取预设档位 `2|4|8|12|16|24`。
3. 动效时长和缓动不要为了「活泼一点」改成弹跳曲线（见 K-06）。
4. 焦点态不可降级为 `outline: none`（见 K-07）。
5. 不写 `.ant-` 类名，也不按生成的哈希类名写选择器；定制走 `className` / `style`、`classNames` / `styles` 槽位和组件文档里的 `data-*` 属性（`LOBE-ANT-CLASS`）。
6. `//` 在 css 模板里不是注释，用 `/* */`（见 K-10）。
7. 描述单个实例的 CSS 自定义属性要挂在该实例自己的元素上。写到 `:root` 会被页面上所有实例共享，第二个挂载的实例会读到第一个的值当基线。
8. lobe-ui 的样式都在 `@layer lobe-base, lobe-popup, lobe-ui` 里，应用里不分层的样式天然优先，不需要 `!important`。反过来，应用的全局 reset（`* { margin: 0 }`、`button { background: none }`、normalize、未分层的 Tailwind preflight）也会盖掉组件样式：把它们放进一个在 lobe-ui 之前声明的层（`@layer reset, lobe-base, lobe-popup, lobe-ui;`）。

## D-11 合法失败：明示缺口，不要绕过

遇到规范缺口时用约定格式暴露它。

**有合理替代**——采用 fallback 并记录：

```
[low] 设计要求的 aurora 背景色不在 token 体系内
      fallback: 用 cssVar.colorBgLayout 纯色底；视觉略平
[med] active 态的 scale 因子(0.97) 无对应 token
      fallback: 内联写 0.97，违反 D-10.1 但无替代
```

**没有合理替代**——拒绝生成那一部分，说明缺什么 token，等补齐。

比起悄悄写一个 hex，明示缺口更有价值：它告诉团队哪些 token 还没覆盖真实场景，会进入下一轮设计系统迭代。悄悄写死的那个值只会在换品牌色、调密度或修暗色模式时，变成一个要逐个搜索替换的债。
