import { MCP } from '@lobehub/icons';
import { createStaticStyles, cx } from 'antd-style';
import { Flower, Globe, Image, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';

import { TitleSection } from '../common/TitleSection';
import { layoutStyles } from '../styles';
import { getThemeToken } from '../styles/theme';

const themeToken = getThemeToken();

// Screen2 特有的样式
const styles = createStaticStyles(({ css, cssVar }) => ({
  cardContent: css`
    position: relative;
    z-index: 2;
  `,

  // 网格布局
  cardGrid: css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  `,

  // 图标和小标题行
  cardHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    margin-block-end: 8px;
  `,

  cardIcon: css`
    width: 20px;
    height: 20px;
    color: var(--icon-color, currentColor);
  `,

  // 径向渐变蒙层
  cardOverlay: css`
    position: absolute;
    z-index: 1;
    inset: 0;
    background: radial-gradient(
      ellipse 150% 100% at 10% 10%,
      rgba(0, 0, 0, 90%) 0%,
      rgba(0, 0, 0, 80%) 35%,
      rgba(0, 0, 0, 20%) 60%,
      transparent 85%
    );
  `,

  cardSubtitle: css`
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    color: rgba(255, 255, 255, 80%);
  `,

  cardTitle: css`
    margin: 0;

    font-family: ${cssVar.fontFamily};
    font-size: 24px;
    font-weight: 500;
    line-height: 1.3;
    color: ${themeToken.colorTextBase};
    text-align: start;
  `,

  // 卡片样式
  featureCard: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;

    padding: ${cssVar.paddingLG};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${themeToken.colorBgBase};
    background-image: var(--card-bg-image, none);
    background-repeat: no-repeat;
    background-position: right bottom;
    background-size: cover;
    outline: 1px solid rgba(255, 255, 255, 10%);
  `,
}));

const cardBg1 = new URL('../assets/card-bg-1.webp', import.meta.url).href;
const cardBg2 = new URL('../assets/card-bg-2.webp', import.meta.url).href;
const cardBg3 = new URL('../assets/card-bg-3.webp', import.meta.url).href;
const cardBg4 = new URL('../assets/card-bg-4.webp', import.meta.url).href;
const cardBg5 = new URL('../assets/card-bg-5.webp', import.meta.url).href;
const cardBg6 = new URL('../assets/card-bg-6.webp', import.meta.url).href;

// 卡片数据
const features = [
  {
    backgroundImage: cardBg1,
    color: themeToken.colorPurple,
    icon: Image,
    id: 1,
    subtitle: 'Image Generation',
    title: 'Create What your feel',
  },
  {
    backgroundImage: cardBg2,
    color: themeToken.colorYellow,
    icon: MCP,
    id: 2,
    subtitle: 'MCP Marketplace',
    title: 'Discover, Connect, Extend',
  },
  {
    backgroundImage: cardBg3,
    color: themeToken.colorBlue,
    icon: Globe,
    id: 3,
    subtitle: 'Smart Web Search',
    title: 'World Knowledge Ready',
  },
  {
    backgroundImage: cardBg4,
    color: themeToken.colorBlue,
    icon: RefreshCw,
    id: 4,
    subtitle: 'Cross-Platform Sync',
    title: 'Your Workspace, Anywhere',
  },
  {
    backgroundImage: cardBg5,
    color: themeToken.colorGreen,
    icon: Flower,
    id: 5,
    subtitle: 'Artifacts',
    title: 'AI Meets Visual Creation',
  },
  {
    backgroundImage: cardBg6,
    color: themeToken.colorPurple,
    icon: RefreshCw,
    id: 6,
    subtitle: 'Multi AI Providers',
    title: 'One Platform, All Models',
  },
];

interface Screen2Props {
  onScreenConfigChange?: (config: {
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

export const Screen2 = ({ onScreenConfigChange }: Screen2Props) => {
  // 屏幕特定的配置
  const CONFIG = {
    screenConfig: {
      navigation: {
        animate: false,
        showNextButton: true,
        showPrevButton: true,
      },
    },
  };

  // 通知父组件屏幕配置
  useEffect(() => {
    if (onScreenConfigChange) {
      onScreenConfigChange(CONFIG.screenConfig);
    }
  }, [onScreenConfigChange]);

  return (
    <div className={layoutStyles.fullScreen}>
      {/* 内容层 */}
      <div className={layoutStyles.centered}>
        {/* 标题部分 */}
        <TitleSection
          animated={true}
          badge="Features"
          description="Advanced AI capabilities tailored to your workflow"
          title="Everything You Need"
        />

        {/* 卡片网格 */}
        <div className={cx(styles.cardGrid, layoutStyles.contentSection)}>
          {features.map((feature, index) => {
            const cssVariables: Record<string, string> = {
              '--card-bg-image': `url(${feature.backgroundImage})`,
              '--icon-color': feature.color,
            };

            return (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className={styles.featureCard}
                initial={{ opacity: 0, y: 50 }}
                key={feature.id}
                style={cssVariables}
                transition={{
                  delay: 0.2 + index * 0.1,
                  duration: 0.3,
                  ease: 'easeOut',
                }}
              >
                {/* 径向渐变蒙层 */}
                <div className={styles.cardOverlay} />

                {/* 内容 */}
                <div className={styles.cardContent}>
                  {/* 图标和小标题行 */}
                  <div className={styles.cardHeader}>
                    <feature.icon className={styles.cardIcon} />
                    <span className={styles.cardSubtitle}>{feature.subtitle}</span>
                  </div>

                  {/* 大标题 */}
                  <h3
                    className={styles.cardTitle}
                    dangerouslySetInnerHTML={{ __html: feature.title }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
