import { createStaticStyles, cx } from 'antd-style';
import { motion } from 'motion/react';

import { typographyStyles } from '../styles';

// TitleSection 组件的样式
const titleSectionStyles = createStaticStyles(({ css }) => ({
  // 标题区域容器
  titleSection: css`
    margin-block-end: 48px;
    line-height: 1.4;
    text-align: center;
  `,
}));

interface TitleSectionProps {
  // 是否启用动画
  animated?: boolean;
  // 动画配置
  animation?: {
    animate?: any;
    initial?: any;
    transition?: any;
  };
  // Badge 文字
  badge: string;
  // 自定义样式类名
  className?: string;
  // 描述文字
  description: string;
  // 主标题
  title: string;
}

export const TitleSection = ({
  badge,
  title,
  description,
  animated = true,
  animation = {
    animate: { opacity: 1, y: 0 },
    initial: { opacity: 0, y: -50 },
    transition: { duration: 0.7 },
  },
  className,
}: TitleSectionProps) => {
  const styles = titleSectionStyles;

  const content = (
    <>
      <div className={typographyStyles.badge}>{badge}</div>
      <h1 className={typographyStyles.subtitle}>{title}</h1>
      <p className={typographyStyles.description}>{description}</p>
    </>
  );

  if (animated) {
    return (
      <motion.div
        animate={animation.animate}
        className={cx(styles.titleSection, className)}
        initial={animation.initial}
        transition={animation.transition}
      >
        {content}
      </motion.div>
    );
  }

  // 静态版本（不带动画）
  return <div className={cx(styles.titleSection, className)}>{content}</div>;
};
