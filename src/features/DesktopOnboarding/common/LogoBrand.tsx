/* eslint-disable @next/next/no-img-element */
import { createStaticStyles, cx } from 'antd-style';
import { motion } from 'motion/react';

const logoImage = new URL('../assets/lobe256.png', import.meta.url).href;
const logoText = new URL('../assets/logo-text.svg', import.meta.url).href;
// LogoBrand 组件的样式
const logoBrandStyles = createStaticStyles(({ css }) => ({
  // Logo 容器
  logoContainer: css`
    display: flex;
    flex-direction: column;
    align-items: center;
  `,

  // Logo 图片
  logoImage: css`
    object-fit: contain;
  `,

  // Logo 文字
  logoText: css`
    object-fit: contain;
  `,
}));

interface LogoBrandProps {
  // 是否启用动画
  animated?: boolean;
  // 动画配置
  animation?: {
    logo: {
      delay: number;
      duration: number;
      scale?: { from: number; to: number };
    };
    logoText: {
      delay: number;
      duration: number;
      yOffset?: number;
    };
  };
  // 自定义样式类名
  className?: string;
  // Logo 图片尺寸
  logoSize?: number;
  // Logo 和文字之间的间距
  spacing?: number;
  // Logo 文字高度
  textHeight?: number;
}

export const LogoBrand = ({
  logoSize = 200,
  textHeight = 56,
  spacing = -20,
  animated = false,
  animation = {
    logo: { delay: 0, duration: 0.7, scale: { from: 1, to: 1 } },
    logoText: { delay: 0.3, duration: 0.7, yOffset: 0 },
  },
  className,
}: LogoBrandProps) => {
  const styles = logoBrandStyles;

  if (animated) {
    return (
      <motion.div className={cx(styles.logoContainer, className)}>
        {/* Logo 图片 */}
        <motion.div
          animate={{
            opacity: 1,
            scale: animation.logo.scale?.to || 1,
          }}
          initial={{
            opacity: 0,
            scale: animation.logo.scale?.from || 1,
          }}
          style={{ marginBottom: spacing }}
          transition={{
            delay: animation.logo.delay,
            duration: animation.logo.duration,
          }}
        >
          <img
            alt="Logo"
            className={styles.logoImage}
            src={logoImage}
            style={{
              height: logoSize,
              width: logoSize,
            }}
          />
        </motion.div>

        {/* Logo 文字 */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{
            opacity: 0,
            y: animation.logoText.yOffset || 0,
          }}
          transition={{
            delay: animation.logo.delay + animation.logoText.delay,
            duration: animation.logoText.duration,
          }}
        >
          <img
            alt="Logo Text"
            className={styles.logoText}
            src={logoText}
            style={{ height: textHeight }}
          />
        </motion.div>
      </motion.div>
    );
  }

  // 静态版本（不带动画）
  return (
    <div className={cx(styles.logoContainer, className)}>
      {/* Logo 图片 */}
      <div style={{ marginBottom: spacing }}>
        <img
          alt="Logo"
          className={styles.logoImage}
          src={logoImage}
          style={{
            height: logoSize,
            width: logoSize,
          }}
        />
      </div>

      {/* Logo 文字 */}
      <img
        alt="Logo Text"
        className={styles.logoText}
        src={logoText}
        style={{ height: textHeight }}
      />
    </div>
  );
};
