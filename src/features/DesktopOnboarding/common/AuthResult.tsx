import { createStaticStyles, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { LogoBrand } from './LogoBrand';

const authResultStyles = createStaticStyles(({ css, cssVar }) => ({
  connectionLine: css`
    position: relative;
    width: 60px;
    height: 2px;
    background: #666;
  `,

  container: css`
    display: flex;
    flex-direction: column;
    align-items: center;

    padding-block: 40px;
    padding-inline: 20px;

    text-align: center;
  `,

  description: css`
    max-width: 400px;
    margin: 0;

    font-size: ${cssVar.fontSize};
    line-height: 1.5;
    color: rgba(255, 255, 255, 60%);
  `,

  deviceIcon: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 80px;
    height: 72px;
    border-radius: ${cssVar.borderRadiusLG};

    background: #2d2d2d;

    &::before {
      content: '';

      position: absolute;
      inset-block-start: 8px;
      inset-inline: 8px;

      height: 6px;
      border-radius: 2px;

      background: #666;
    }

    &::after {
      content: '';

      position: absolute;
      inset-block: 20px 8px;
      inset-inline: 8px;

      border-radius: 4px;

      background: #444;
    }
  `,

  errorIcon: css`
    color: white;
    background: ${cssVar.colorError};
  `,

  iconContainer: css`
    display: flex;
    gap: 24px;
    align-items: center;
    margin-block-end: 32px;
  `,

  logoContainer: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 80px;
    height: 80px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 10%);
    border-radius: 50%;

    background: ${cssVar.colorBgElevated};
  `,

  statusIcon: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;
  `,

  successIcon: css`
    color: white;
    background: ${cssVar.colorSuccess};
  `,

  title: css`
    margin-block: 0 16px;
    margin-inline: 0;

    font-family: ${cssVar.fontFamily};
    font-size: 28px;
    font-weight: 600;
    color: ${cssVar.colorTextBase};
  `,
}));

interface AuthResultProps {
  animated?: boolean;
  description?: string;
  success: boolean;
  title?: string;
}

export const AuthResult = ({ success, title, description, animated = true }: AuthResultProps) => {
  const styles = authResultStyles;

  const { t } = useTranslation('desktop-onboarding');

  const defaultTitle = t(success ? 'authResult.success.title' : 'authResult.failed.title');
  const defaultDescription = t(success ? 'authResult.success.desc' : 'authResult.failed.desc');

  const content = (
    <>
      {/* 图标连接区域 */}
      <div className={styles.iconContainer}>
        {/* 设备图标 */}
        <div className={styles.deviceIcon} />

        {/* 连接线和状态图标 */}
        <div className={styles.connectionLine}>
          <div className={cx(styles.statusIcon, success ? styles.successIcon : styles.errorIcon)}>
            {success ? <Check size={14} /> : <X size={14} />}
          </div>
        </div>

        {/* Logo */}
        <div className={styles.logoContainer}>
          <LogoBrand animated={false} logoSize={88} spacing={0} textHeight={0} />
        </div>
      </div>

      {/* 文字内容 */}
      <h2 className={styles.title}>{title || defaultTitle}</h2>
      <p className={styles.description}>{description || defaultDescription}</p>
    </>
  );

  if (animated) {
    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={styles.container}
        initial={{ opacity: 0, y: 30 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {content}
      </motion.div>
    );
  }

  return <div className={styles.container}>{content}</div>;
};
