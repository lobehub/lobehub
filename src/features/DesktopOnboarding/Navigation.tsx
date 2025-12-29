import { Button } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as motion from 'motion/react-m';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { getThemeToken } from './styles/theme';

const themeToken = getThemeToken();

// 组件特有样式 - 仅用于 Navigation 组件
const styles = createStaticStyles(({ css, cssVar }) => ({
  // 布局容器
  container: css`
    position: fixed;
    inset-block-end: 0;
    inset-inline: 0 0;
  `,

  content: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: space-between;

    min-height: 48px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px;
    padding-inline: 24px;

    background: rgba(0, 0, 0, 85%);
    backdrop-filter: blur(10px);
  `,

  // 高亮按钮样式 - 仅在启用状态下生效
  highlightButton: css`
    &:not(:disabled) {
      border-color: ${themeToken.colorHighlight} !important;
      font-weight: 500;
      color: #000 !important;
      background: ${themeToken.colorHighlight} !important;

      & > * {
        color: #000 !important;
      }

      &:hover {
        border-color: #ffe227 !important;
        background: #ffe227 !important;
      }
    }
  `,

  // 确保按钮在指示器上方
  navigationButton: css`
    position: relative;
    z-index: 2;
    &:not(:disabled) > * {
      color: #000 !important;
    }
  `,

  // 导航按钮区域 - 已整合到 content 中，不再需要
  navigationContainer: css`
    display: contents;
  `,

  placeholder: css`
    width: 40px;
  `,

  // 进度指示器 - 绝对定位居中
  progressContainer: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: flex;
    gap: 8px;
    align-items: center;
  `,

  progressDot: css`
    cursor: pointer;
    height: 6px;
    border-radius: 9999px;
    transition: all 0.3s ease;
  `,

  progressDotActive: css`
    width: 24px;
    background-color: ${themeToken.colorHighlight};
  `,

  progressDotCompleted: css`
    width: 6px;
    background-color: ${cssVar.colorTextSecondary};
  `,

  progressDotPending: css`
    width: 6px;
    background-color: ${cssVar.colorTextQuaternary};
  `,

  squareButton: css`
    z-index: 2;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    min-width: 32px;
    height: 32px;
    padding: 0;
  `,
}));

interface NavigationProps {
  // 是否高亮下一步按钮
  // 动画配置
  animate?: boolean;
  // 动画持续时间（秒），默认 1
  animationDelay?: number;
  // 是否启用动画，默认 false
  animationDuration?: number;
  // 直接跳转到指定步骤
  canGoNext: boolean;
  canGoPrev: boolean;
  currentStep: number;
  nextButtonDisabled?: boolean;
  // 是否禁用下一步按钮
  nextButtonHighlight?: boolean;
  nextButtonText?: string;
  onGoToStep?: (step: number) => void;
  onNext: () => void;
  onPrev: () => void;
  prevButtonText?: string;
  showNextButton?: boolean;
  showPrevButton?: boolean;
  totalSteps: number; // 动画延迟时间（秒），默认 0
}

export const Navigation: React.FC<NavigationProps> = ({
  currentStep,
  totalSteps,
  onNext,
  onPrev,
  onGoToStep,
  canGoNext,
  canGoPrev,
  prevButtonText = '',
  nextButtonText,
  showPrevButton = true,
  showNextButton = true,
  nextButtonDisabled = false,
  nextButtonHighlight = false,
  animate = false,
  animationDuration = 1,
  animationDelay = 0,
}) => {
  const { t } = useTranslation('desktop-onboarding');
  const resolvedNextButtonText = nextButtonText ?? t('navigation.next');

  // 导航内容组件 - 单行布局
  const navigationContent = (
    <>
      {/* 左侧返回按钮 */}
      {showPrevButton ? (
        prevButtonText ? (
          // 有文字时显示完整按钮
          <Button
            className={styles.navigationButton}
            disabled={!canGoPrev}
            icon={<ChevronLeft size={16} />}
            onClick={onPrev}
            type={canGoPrev ? 'default' : 'dashed'}
          >
            {prevButtonText}
          </Button>
        ) : (
          // 无文字时只显示正方形图标按钮
          <Button
            className={cx(styles.squareButton, styles.navigationButton)}
            disabled={!canGoPrev}
            icon={<ChevronLeft size={16} />}
            onClick={onPrev}
            type={canGoPrev ? 'default' : 'dashed'}
          />
        )
      ) : (
        <div className={styles.placeholder} />
      )}

      {/* 中间进度指示器 */}
      <div className={styles.progressContainer}>
        {Array.from({ length: totalSteps }).map((_, index) => (
          <motion.div
            className={cx(
              styles.progressDot,
              index === currentStep && styles.progressDotActive,
              index < currentStep && styles.progressDotCompleted,
              index > currentStep && styles.progressDotPending,
            )}
            key={index}
            onClick={() => onGoToStep && onGoToStep(index)}
          />
        ))}
      </div>

      {/* 右侧下一步按钮 */}
      {showNextButton ? (
        <Button
          className={cx(styles.navigationButton, nextButtonHighlight && styles.highlightButton)}
          disabled={nextButtonDisabled}
          onClick={onNext}
          type="primary"
        >
          {resolvedNextButtonText}
          {canGoNext && !nextButtonDisabled && <ChevronRight size={16} />}
        </Button>
      ) : (
        <div className={styles.placeholder} />
      )}
    </>
  );

  // 根据是否需要动画选择容器
  if (animate) {
    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={styles.container}
        initial={{ opacity: 0, y: 20 }}
        transition={{
          delay: animationDelay,
          duration: animationDuration,
          ease: 'easeOut',
        }}
      >
        <div className={styles.content}>{navigationContent}</div>
      </motion.div>
    );
  }

  // 无动画版本
  return (
    <div className={styles.container}>
      <div className={styles.content}>{navigationContent}</div>
    </div>
  );
};
