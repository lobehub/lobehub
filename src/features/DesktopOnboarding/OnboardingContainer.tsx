'use client';

import { ConfigProvider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { AnimatePresence, motion } from 'motion/react';
import React, { useCallback, useEffect, useState } from 'react';

import { TITLE_BAR_HEIGHT } from '@/features/ElectronTitlebar';
import { electronStylish } from '@/styles/electron';

import { Navigation } from './Navigation';
import LightRays from './effects/LightRays';
import { Screen1 } from './screens/Screen1';
import { Screen2 } from './screens/Screen2';
import { Screen3 } from './screens/Screen3';
import { Screen4 } from './screens/Screen4';
import { Screen5 } from './screens/Screen5';
import { customTheme } from './styles/theme';

const styles = createStaticStyles(({ css }) => ({
  backgroundLayer: css`
    position: relative;
    width: 100%;
    height: 100%;
  `,

  container: css`
    position: fixed;
    z-index: 1;
    inset-block: 0 0;
    inset-inline: 0 0;

    overflow: hidden;

    color: #fff;

    background-color: #000;
  `,

  content: css`
    position: relative;
    z-index: 10;
    height: 100%;
    background: transparent;
  `,

  navigationWrapper: css`
    position: relative;
    z-index: 100;
  `,

  screenContent: css`
    position: relative;
    z-index: 10;
    height: 100%;
  `,

  screenWrapper: css`
    width: 100%;
    height: 100%;
  `,

  titleBar: css`
    position: fixed;
    z-index: 1000;
    inset-block-start: 0;
    inset-inline: 0 0;

    width: 100%;
    height: ${TITLE_BAR_HEIGHT}px;
  `,
}));

interface OnboardingContainerProps {
  onComplete: () => void;
}

const screens = [Screen1, Screen2, Screen3, Screen4, Screen5];

// 统一的屏幕配置接口
interface ScreenConfig {
  // 背景配置
  background?: {
    animate?: boolean;
    animationDelay?: number;
    animationDuration?: number;
  };
  // 导航栏配置
  navigation: {
    animate?: boolean;
    animationDelay?: number;
    animationDuration?: number;
    nextButtonDisabled?: boolean;
    nextButtonHighlight?: boolean;
    nextButtonText?: string;
    prevButtonText?: string;
    showNextButton?: boolean;
    showPrevButton?: boolean;
  };
}

export const OnboardingContainer: React.FC<OnboardingContainerProps> = ({ onComplete }) => {
  // 从 URL hash 获取初始屏幕索引
  const getInitialStep = () => {
    const hash = window.location.hash;
    const match = hash.match(/^#(\d+)$/);
    if (match) {
      const step = parseInt(match[1], 10) - 1; // URL 使用 1-4，内部使用 0-3
      if (step >= 0 && step < screens.length) {
        return step;
      }
    }
    return 0; // 默认第一屏
  };

  const [currentStep, setCurrentStep] = useState(getInitialStep());
  const [screenConfig, setScreenConfig] = useState<ScreenConfig>({
    background: undefined,
    navigation: {},
  });
  const [backgroundKey, setBackgroundKey] = useState(0);
  const [previousStep, setPreviousStep] = useState(currentStep);
  const totalSteps = screens.length;

  // 监听 hash 变化
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#(\d+)$/);
      if (match) {
        const step = parseInt(match[1], 10) - 1;
        if (step >= 0 && step < screens.length && step !== currentStep) {
          setCurrentStep(step);
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [currentStep]);

  // 当 currentStep 改变时的处理
  useEffect(() => {
    // 更新 URL hash
    const newHash = `#${currentStep + 1}`;
    if (window.location.hash !== newHash) {
      window.location.hash = newHash;
    }

    // 只有从其他屏切换到第一屏时才重置背景动画
    if (currentStep === 0 && previousStep !== 0) {
      setBackgroundKey((prev) => prev + 1);
    }

    setPreviousStep(currentStep);
  }, [currentStep, previousStep]);

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const CurrentScreen = screens[currentStep];

  // 处理屏幕配置更改 - 统一处理导航和背景配置
  const handleScreenConfigChange = useCallback(
    (config: ScreenConfig) => {
      setScreenConfig(config);
      // 当背景配置改变时，更新 backgroundKey 以重新触发动画
      if (currentStep === 0 && config.background) {
        setBackgroundKey((prev) => prev + 1);
      }
    },
    [currentStep],
  );

  // 渲染背景 - 只在第一屏时处理动画，其他屏幕直接显示
  const renderBackground = () => {
    const backgroundContent = (
      <LightRays
        className="custom-rays"
        distortion={0}
        followMouse={true}
        lightSpread={1.5}
        mouseInfluence={0.1}
        noiseAmount={0.1}
        rayLength={1.5}
        raysColor="#732FAE"
        raysColorSecondary="#3A31C1"
        raysOrigin="top-center"
        raysSpeed={1.3}
      />
    );

    // 统一使用 motion.div，避免组件类型切换导致重新挂载
    const isFirstScreen = currentStep === 0;
    const hasAnimation = screenConfig.background?.animate === true;
    const backgroundConfig = screenConfig.background;
    // 第一屏根据配置决定是否需要动画
    const shouldAnimate = isFirstScreen && (hasAnimation || screenConfig.background === undefined);

    const animationDelay = shouldAnimate ? (backgroundConfig?.animationDelay ?? 5) : 0;
    const animationDuration = shouldAnimate ? (backgroundConfig?.animationDuration ?? 1) : 0;

    return (
      <motion.div
        animate={{ opacity: 1 }}
        className={styles.backgroundLayer}
        initial={{ opacity: shouldAnimate ? 0 : 1 }}
        key={`background-${backgroundKey}`} // 使用统一的动态key
        transition={{
          delay: animationDelay,
          duration: animationDuration,
          ease: 'easeOut',
        }}
      >
        {backgroundContent}
      </motion.div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Title Bar Drag Region */}
      <div className={cx(styles.titleBar, electronStylish.draggable)} />

      {/* LightRays Background Layer */}
      {renderBackground()}

      <div className={styles.content}>
        {/* Screen content */}
        <div className={styles.screenContent}>
          <AnimatePresence>
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className={styles.screenWrapper}
              exit={{ opacity: 0, x: -100 }}
              initial={{
                opacity: currentStep === 0 ? 1 : 0,
                x: currentStep === 0 ? 0 : 100,
              }}
              key={currentStep}
              transition={{ duration: currentStep === 0 ? 0 : 0.3 }}
            >
              <CurrentScreen onScreenConfigChange={handleScreenConfigChange} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className={styles.navigationWrapper}>
          <Navigation
            animate={screenConfig.navigation.animate}
            animationDelay={screenConfig.navigation.animationDelay}
            animationDuration={screenConfig.navigation.animationDuration}
            canGoNext={currentStep < totalSteps - 1}
            canGoPrev={currentStep > 0}
            currentStep={currentStep}
            nextButtonDisabled={screenConfig.navigation.nextButtonDisabled}
            nextButtonHighlight={screenConfig.navigation.nextButtonHighlight}
            nextButtonText={screenConfig.navigation.nextButtonText}
            onGoToStep={setCurrentStep}
            onNext={handleNext}
            onPrev={handlePrev}
            prevButtonText={screenConfig.navigation.prevButtonText}
            showNextButton={screenConfig.navigation.showNextButton}
            showPrevButton={screenConfig.navigation.showPrevButton}
            totalSteps={totalSteps}
          />
        </div>
      </div>
    </div>
  );
};

export const OnboardingContainerWithTheme: React.FC<OnboardingContainerProps> = ({
  onComplete,
}) => {
  return (
    <ConfigProvider theme={customTheme}>
      <OnboardingContainer onComplete={onComplete} />
    </ConfigProvider>
  );
};
