// 统一导出所有样式模块
import { layoutStyles } from './layout';
import { mediaStyles } from './media';
import { spacingStyles } from './spacing';
import { typographyStyles } from './typography';

export { layoutStyles } from './layout';
export { mediaStyles } from './media';
export { spacingStyles } from './spacing';
export { customTheme } from './theme';
export { typographyStyles } from './typography';

// 组合样式对象（用于需要多个样式模块的场景）
export const commonStyles = {
  layout: layoutStyles,
  media: mediaStyles,
  spacing: spacingStyles,
  typography: typographyStyles,
};
