import { createStaticStyles } from 'antd-style';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LogoBrand } from '../common/LogoBrand';
import { layoutStyles, mediaStyles, typographyStyles } from '../styles';

const styles = createStaticStyles(({ css }) => ({
  logoContainer: css`
    transform: translate(0, var(--logo-target-y, 0));
    margin-block-end: 60px;
  `,
}));

const introVideo = new URL('../assets/intro-video.mp4', import.meta.url).href;
interface Screen1Props {
  onScreenConfigChange?: (config: {
    background?: {
      animate?: boolean;
      animationDelay?: number;
      animationDuration?: number;
    };
    navigation: {
      animate?: boolean;
      animationDelay?: number;
      animationDuration?: number;
      nextButtonText?: string;
      prevButtonText?: string;
      showNextButton?: boolean;
      showPrevButton?: boolean;
    };
  }) => void;
}

export const Screen1 = ({ onScreenConfigChange }: Screen1Props) => {
  const { t } = useTranslation('desktop-onboarding');
  const [animationPhase, setAnimationPhase] = useState<'playing' | 'transitioning' | 'finished'>(
    'playing',
  );
  const [videoOpacity, setVideoOpacity] = useState(1);
  const [shouldStartAnimation, setShouldStartAnimation] = useState(false);
  const [shouldStartFadeOut, setShouldStartFadeOut] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 屏幕特定的动画配置
  const CONFIG = {
    // 动画序列配置 - 按顺序执行
    animations: {
      description: {
        delay: 0.7, // 说明文字延迟时间 (相对于视频开始 fade)
        duration: 0.7, // 说明文字动画持续时间
        yOffset: 20, // 向上移动距离
      },
      logo: {
        delay: 0.5, // Logo 出现延迟 (相对于视频开始 fade)
        duration: 0.7, // Logo 动画持续时间
        scale: { from: 1, to: 1 }, // Logo 缩放动画
      },
      logoText: {
        delay: 0.3, // Logo 文字延迟出现时间 (相对于 Logo)
        duration: 0.7, // Logo 文字动画持续时间
        yOffset: 0, // 文字向上移动距离
      },
      slogan: {
        delay: 0.5, // Slogan 延迟时间 (相对于视频开始 fade)
        duration: 0.7, // Slogan 动画持续时间
        yOffset: 20, // 向上移动距离
      },
    },

    // 位置和尺寸控制
    layout: {
      // Logo 最终Y轴位置 (相对于中心)
      logoTargetSize: 200,
      logoTargetY: 0, // Logo 最终尺寸 (px)
      logoTextHeight: 56, // Logo 文字高度 (px)
      logoTextSpacing: -20, // Logo 和文字之间的间距 (px)
    },

    // 统一的屏幕配置
    screenConfig: {
      background: {
        animate: true, // 启用背景动画
        animationDelay: 4, // 背景延迟出现（视频完成后）
        animationDuration: 1, // 背景动画持续1秒
      },
      navigation: {
        animate: true,
        // 动画持续1秒
        animationDelay: 4.5,

        // 启用动画
        animationDuration: 1,

        nextButtonText: t('screen1.navigation.next'),

        showNextButton: true,

        showPrevButton: false, // 延迟出现
      },
    },

    // 视频播放控制
    video: {
      // 缩放动画持续时间 (秒)
      endTime: 4,

      // 开始渐隐的时间点 (秒)
      fadeOutDuration: 1.3,

      fadeStartTime: 2.7,

      // 开始缩放的时间点 (秒)
      scaleDuration: 2,
      // 淡出动画持续时间 (秒)
      scaleStartTime: 1,
      // 视频最终宽度 (px)
      targetHeight: 630,
      // 视频完全消失的时间点 (秒)
      targetWidth: 1120, // 视频最终高度 (px)
      targetY: -102, // 视频最终Y轴位置 (相对于中心)
    },
  };

  // 通知父组件屏幕配置 - 统一通知
  useEffect(() => {
    if (onScreenConfigChange) {
      onScreenConfigChange(CONFIG.screenConfig);
    }
  }, [onScreenConfigChange, t]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 监听视频播放时间
    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;

      // 开始渐隐动画
      if (currentTime >= CONFIG.video.fadeStartTime && !shouldStartFadeOut) {
        setShouldStartFadeOut(true);
        // 开始 Motion 淡出动画
        setVideoOpacity(0);
      }

      // 开始缩放动画
      if (currentTime >= CONFIG.video.scaleStartTime && !shouldStartAnimation) {
        setShouldStartAnimation(true);
      }

      // 显示内容 - 当开始缩放时就进入 transitioning 阶段
      if (currentTime >= CONFIG.video.scaleStartTime && animationPhase === 'playing') {
        setAnimationPhase('transitioning');
      }

      // 视频结束
      if (currentTime >= CONFIG.video.endTime && animationPhase !== 'finished') {
        setAnimationPhase('finished');
        setVideoOpacity(0);
        // 只暂停视频，不重置位置避免闪烁
        video.pause();
      }
    };

    // 如果没有视频文件，直接显示内容
    const handleError = () => {
      setAnimationPhase('finished');
      setVideoOpacity(0);
    };

    // 视频结束时的处理
    const handleEnded = () => {
      setAnimationPhase('finished');
      setVideoOpacity(0);
      video.pause();
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error', handleError);
    video.addEventListener('ended', handleEnded);

    // 自动播放视频
    video.play().catch(() => {
      // 如果自动播放失败，直接显示内容
      setAnimationPhase('finished');
      setVideoOpacity(0);
    });

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error', handleError);
      video.removeEventListener('ended', handleEnded);
    };
  }, [shouldStartAnimation, shouldStartFadeOut, animationPhase]);

  // @ts-ignore
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={layoutStyles.fullScreen}
      exit={{ opacity: 0 }}
      initial={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* 全屏视频 */}
      {animationPhase !== 'finished' && (
        <motion.div
          animate={{
            opacity: videoOpacity,
          }}
          className={layoutStyles.absolute}
          transition={{
            duration: CONFIG.video.fadeOutDuration,
            ease: 'easeInOut',
          }}
        >
          <motion.video
            animate={{
              height: shouldStartAnimation ? CONFIG.video.targetHeight : window.innerHeight,
              width: shouldStartAnimation ? CONFIG.video.targetWidth : window.innerWidth,
              x: shouldStartAnimation ? (window.innerWidth - CONFIG.video.targetWidth) / 2 : 0,
              y: shouldStartAnimation
                ? (window.innerHeight - CONFIG.video.targetHeight) / 2 + CONFIG.video.targetY
                : 0,
            }}
            className={mediaStyles.responsiveVideo}
            initial={{
              height: window.innerHeight,
              width: window.innerWidth,
              x: 0,
              y: 0,
            }}
            muted
            playsInline
            ref={videoRef}
            src={introVideo}
            transition={{
              duration: CONFIG.video.scaleDuration,
              ease: 'easeInOut',
            }}
          />
        </motion.div>
      )}

      {/* Logo 和文字内容 */}
      <AnimatePresence>
        {shouldStartFadeOut && (
          <motion.div
            animate={{ opacity: 1 }}
            className={layoutStyles.centered}
            initial={{ opacity: 0 }}
            transition={{ duration: 1 }}
          >
            {/* Logo 组合 */}
            <div
              className={styles.logoContainer}
              style={{
                // @ts-ignore
                '--logo-target-y': `${CONFIG.layout.logoTargetY}px`,
              }}
            >
              <LogoBrand
                animated={true}
                animation={{
                  logo: {
                    delay: CONFIG.animations.logo.delay,
                    duration: CONFIG.animations.logo.duration,
                    scale: CONFIG.animations.logo.scale,
                  },
                  logoText: {
                    delay: CONFIG.animations.logoText.delay,
                    duration: CONFIG.animations.logoText.duration,
                    yOffset: CONFIG.animations.logoText.yOffset,
                  },
                }}
                logoSize={CONFIG.layout.logoTargetSize}
                spacing={CONFIG.layout.logoTextSpacing}
                textHeight={CONFIG.layout.logoTextHeight}
              />
            </div>

            {/* Slogan */}
            <motion.h1
              animate={{ opacity: 1, y: 0 }}
              className={typographyStyles.heroTitle}
              initial={{
                opacity: 0,
                y: CONFIG.animations.slogan.yOffset,
              }}
              transition={{
                delay: CONFIG.animations.slogan.delay,
                duration: CONFIG.animations.slogan.duration,
              }}
            >
              {t('screen1.slogan.line1')} <br />
              {t('screen1.slogan.line2')}
            </motion.h1>

            {/* 说明文字 */}
            <motion.p
              animate={{ opacity: 1, y: 0 }}
              className={typographyStyles.body}
              initial={{
                opacity: 0,
                y: CONFIG.animations.description.yOffset,
              }}
              transition={{
                delay: CONFIG.animations.description.delay,
                duration: CONFIG.animations.description.duration,
              }}
            >
              {t('screen1.description')}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
