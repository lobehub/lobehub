import { createStaticStyles, cx } from 'antd-style';
import { CheckCircle, HeartHandshake, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { TitleSection } from '../common/TitleSection';
import { layoutStyles } from '../styles';
import { getThemeToken } from '../styles/theme';

const themeToken = getThemeToken();

// Screen4 特有的样式
const screen4Styles = createStaticStyles(({ css, cssVar }) => ({
  // 卡片描述
  cardDescription: css`
    margin-block-end: 24px;

    font-size: ${cssVar.fontSize};
    line-height: 1.5;
    color: rgba(255, 255, 255, 60%);
    text-align: center;
  `,

  // 卡片头部
  cardHeader: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;

    margin-block-end: 8px;
  `,

  // 卡片标题
  cardTitle: css`
    margin: 0;

    font-family: ${cssVar.fontFamily};
    font-size: 20px;
    font-weight: 700;
    color: ${themeToken.colorTextBase};
    text-align: center;
  `,

  // 选中标记
  checkIcon: css`
    position: absolute;
    inset-block-start: 20px;
    inset-inline-end: 20px;

    color: ${themeToken.colorGreen};

    opacity: 0;

    transition: opacity 0.3s ease;
  `,

  // 内容区容器
  contentContainer: css`
    display: flex;
    flex-direction: column;
    gap: 32px;
    align-items: center;

    max-width: 900px;
    margin-block: 0;
    margin-inline: auto;
  `,

  // 特性列表
  featureList: css`
    display: flex;
    flex-direction: column;
    align-items: center;

    margin: 0;
    padding: 0;

    list-style: none;

    li {
      position: relative;

      padding-inline-start: 20px;

      font-size: ${cssVar.fontSize};
      line-height: 1.5;
      color: rgb(255, 255, 255);

      &::before {
        content: '•';
        position: absolute;
        inset-inline-start: 0;
        color: rgba(255, 255, 255, 40%);
      }

      &:last-child {
        margin-block-end: 0;
      }
    }
  `,

  // 底部说明文字
  footerNote: css`
    margin-block-start: 24px;
    font-size: ${cssVar.fontSize};
    color: rgba(255, 255, 255, 50%);
    text-align: center;
  `,

  // 数据选项卡片
  optionCard: css`
    cursor: pointer;

    position: relative;

    flex: 1;

    max-width: 400px;
    padding-block: 32px;
    padding-inline: 28px;
    border: 1px solid rgba(255, 255, 255, 10%);
    border-radius: ${cssVar.borderRadiusLG};

    background: rgba(255, 255, 255, 2%);

    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-4px);
      border-color: rgba(255, 255, 255, 15%);
      background: rgba(255, 255, 255, 4%);
    }

    &.selected {
      border-color: ${themeToken.colorGreen};
      background: rgba(255, 255, 255, 8%);

      .check-icon {
        opacity: 1;
      }
    }
  `,

  // 选项卡容器
  optionsContainer: css`
    display: flex;
    gap: 16px;
    justify-content: center;
    width: 100%;
  `,
}));

type DataMode = 'share' | 'privacy';

interface Screen4Props {
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

export const Screen4 = ({ onScreenConfigChange }: Screen4Props) => {
  const { t } = useTranslation('desktop-onboarding');
  const telemetryEnabled = useUserStore(userGeneralSettingsSelectors.telemetry);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);
  const selectedMode: DataMode = telemetryEnabled ? 'share' : 'privacy';

  // 屏幕特定的配置
  const CONFIG = {
    screenConfig: {
      navigation: {
        animate: false,
        nextButtonText: t('screen4.navigation.next'),
        showNextButton: true,
        showPrevButton: true,
      },
    },
  };

  const setMode = useCallback(
    (mode: DataMode) => {
      const nextTelemetry = mode === 'share';
      if (telemetryEnabled === nextTelemetry) return;

      void updateGeneralConfig({ telemetry: nextTelemetry });
    },
    [telemetryEnabled, updateGeneralConfig],
  );

  // 通知父组件屏幕配置
  useEffect(() => {
    if (onScreenConfigChange) {
      onScreenConfigChange(CONFIG.screenConfig);
    }
  }, [onScreenConfigChange, t]);

  return (
    <div className={layoutStyles.fullScreen}>
      {/* 内容层 */}
      <div className={layoutStyles.centered}>
        {/* 标题部分 */}
        <TitleSection
          animated={true}
          badge={t('screen4.badge')}
          description={t('screen4.description')}
          title={t('screen4.title')}
        />

        {/* 选项卡区域 */}
        <div className={screen4Styles.contentContainer}>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={screen4Styles.optionsContainer}
            initial={{ opacity: 0, y: 20 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            {/* 共享数据选项 */}
            <div
              className={cx(screen4Styles.optionCard, selectedMode === 'share' && 'selected')}
              onClick={() => setMode('share')}
            >
              <CheckCircle className={cx(screen4Styles.checkIcon, 'check-icon')} size={24} />

              <div className={screen4Styles.cardHeader}>
                <HeartHandshake color={themeToken.colorGreen} size={48} />
                <h3 className={screen4Styles.cardTitle}>{t('screen4.share.title')}</h3>
              </div>

              <p className={screen4Styles.cardDescription}>
                {t('screen4.share.description')}
              </p>

              <ul className={screen4Styles.featureList}>
                <li>{t('screen4.share.items.1')}</li>
                <li>{t('screen4.share.items.2')}</li>
                <li>{t('screen4.share.items.3')}</li>
              </ul>
            </div>

            {/* 隐私模式选项 */}
            <div
              className={cx(screen4Styles.optionCard, selectedMode === 'privacy' && 'selected')}
              onClick={() => setMode('privacy')}
            >
              <CheckCircle className={cx(screen4Styles.checkIcon, 'check-icon')} size={24} />

              <div className={screen4Styles.cardHeader}>
                <Shield color={themeToken.colorBlue} size={48} />
                <h3 className={screen4Styles.cardTitle}>{t('screen4.privacy.title')}</h3>
              </div>

              <p className={screen4Styles.cardDescription}>
                {t('screen4.privacy.description')}
              </p>

              <ul className={screen4Styles.featureList}>
                <li>{t('screen4.privacy.items.1')}</li>
                <li>{t('screen4.privacy.items.2')}</li>
                <li>{t('screen4.privacy.items.3')}</li>
              </ul>
            </div>
          </motion.div>

          {/* 底部说明 */}
          <motion.p
            animate={{ opacity: 1 }}
            className={screen4Styles.footerNote}
            initial={{ opacity: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            {t('screen4.footerNote')}
          </motion.p>
        </div>
      </div>
    </div>
  );
};
