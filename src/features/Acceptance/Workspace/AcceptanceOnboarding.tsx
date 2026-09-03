'use client';

import { CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { Button, TabsIndicator, TabsList, TabsRoot, TabsTab } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Bot, ClipboardCheck, Terminal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import CommandLine from '@/components/CommandLine';
import { CLI_INSTALL_COMMAND } from '@/features/Apps/const';

import { acceptanceHomePath } from '../Viewer/routes';

const styles = createStaticStyles(({ css }) => ({
  description: css`
    max-width: 520px;

    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    text-align: start;
  `,
  container: css`
    overflow: auto;

    width: 100%;
    height: 100%;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    width: 100%;
    max-width: 960px;
    margin: auto;
    padding-block: 12px 16px;
    padding-inline: 24px;

    @media (width <= 680px) {
      padding-block: 8px 16px;
      padding-inline: 16px;
    }
  `,
  icon: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  method: css`
    min-width: 0;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  methodDescription: css`
    font-size: 13px;
    line-height: 1.55;
    color: ${cssVar.colorTextTertiary};
  `,
  methodIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  methodTitle: css`
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  step: css`
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;

    min-width: 0;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  stepIndex: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  steps: css`
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.9fr);
    gap: 10px;

    @media (width <= 680px) {
      grid-template-columns: 1fr;
    }
  `,
  tab: css`
    flex: 1;
    justify-content: center;
  `,
  tabList: css`
    width: 100%;
  `,
  tabs: css`
    width: 100%;
  `,
  page: css`
    width: 100%;
    min-width: 0;
    height: 100dvh;
    padding: 8px;

    background: ${cssVar.colorBgLayout};
  `,
  prompt: css`
    flex: 1;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    line-height: 1.65;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  promptBox: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  title: css`
    font-size: 22px;
    font-weight: 600;
    line-height: 1.25;
    color: ${cssVar.colorText};
    text-align: start;
    letter-spacing: -0.02em;
  `,
}));

const AcceptanceOnboarding = memo(() => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const [mode, setMode] = useState<'agent' | 'manual'>('agent');

  return (
    <Flexbox className={styles.page}>
      <Flexbox className={styles.container}>
        <Flexbox horizontal align={'center'} padding={16}>
          <Button icon={ArrowLeft} type={'text'} onClick={() => navigate(acceptanceHomePath())}>
            {t('back', { ns: 'common' })}
          </Button>
        </Flexbox>
        <Flexbox className={styles.content} gap={16}>
          <Flexbox horizontal align={'center'} gap={12}>
            <span className={styles.icon}>
              <Icon icon={ClipboardCheck} size={20} />
            </span>
            <Flexbox gap={4}>
              <span className={styles.title}>{t('acceptance.workspace.onboarding.title')}</span>
              <span className={styles.description}>
                {t('acceptance.workspace.onboarding.description')}
              </span>
            </Flexbox>
          </Flexbox>

          <Flexbox gap={12}>
            <span className={styles.sectionTitle}>
              {t('acceptance.workspace.onboarding.installSection')}
            </span>
            <TabsRoot
              className={styles.tabs}
              value={mode}
              onValueChange={(key) => setMode(key as 'agent' | 'manual')}
            >
              <TabsList className={styles.tabList}>
                <TabsIndicator />
                <TabsTab className={styles.tab} value={'agent'}>
                  <Icon icon={Bot} size={16} />
                  {t('acceptance.workspace.onboarding.agent.title')}
                </TabsTab>
                <TabsTab className={styles.tab} value={'manual'}>
                  <Icon icon={Terminal} size={16} />
                  {t('acceptance.workspace.onboarding.manual.title')}
                </TabsTab>
              </TabsList>
            </TabsRoot>

            {mode === 'agent' ? (
              <Flexbox className={styles.method} gap={12}>
                <span className={styles.methodDescription}>
                  {t('acceptance.workspace.onboarding.agent.description')}
                </span>
                <Flexbox horizontal align={'flex-start'} className={styles.promptBox} gap={8}>
                  <span className={styles.prompt}>
                    {t('acceptance.workspace.onboarding.agent.prompt')}
                  </span>
                  <CopyButton
                    content={t('acceptance.workspace.onboarding.agent.prompt')}
                    size={'small'}
                  />
                </Flexbox>
              </Flexbox>
            ) : (
              <div className={styles.steps}>
                {[
                  {
                    command: CLI_INSTALL_COMMAND,
                    description: t('acceptance.workspace.onboarding.install.description'),
                    title: t('acceptance.workspace.onboarding.install.title'),
                  },
                  {
                    command: 'lh acceptance install',
                    description: t('acceptance.workspace.onboarding.enable.description'),
                    title: t('acceptance.workspace.onboarding.enable.title'),
                  },
                  {
                    command: '/acceptance',
                    description: t('acceptance.workspace.onboarding.run.description'),
                    title: t('acceptance.workspace.onboarding.run.title'),
                  },
                ].map((step, index) => (
                  <div className={styles.step} key={step.title}>
                    <span className={styles.stepIndex}>{index + 1}</span>
                    <Flexbox gap={6}>
                      <span className={styles.methodTitle}>{step.title}</span>
                      <span className={styles.methodDescription}>{step.description}</span>
                      <CommandLine command={step.command} />
                    </Flexbox>
                  </div>
                ))}
              </div>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

AcceptanceOnboarding.displayName = 'AcceptanceOnboarding';

export default AcceptanceOnboarding;
