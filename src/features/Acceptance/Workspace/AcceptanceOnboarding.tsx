'use client';

import {
  Button,
  CopyButton,
  Flexbox,
  Icon,
  TabsIndicator,
  TabsList,
  TabsRoot,
  TabsTab,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, Bot, ClipboardCheck, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import CommandLine from '@/components/CommandLine';
import { CLI_INSTALL_COMMAND } from '@/features/Apps/const';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { acceptanceHomePath } from '../Viewer/routes';

const styles = stylex.create({
  description: {
    maxWidth: '520px',
    fontSize: '14px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  container: {
    overflow: 'auto',
    flex: '1',
    width: '100%',
    minHeight: '0',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  content: {
    width: '100%',
    maxWidth: '720px',
    marginInline: 'auto',
    paddingBlockStart: { 'default': 'clamp(32px, 8vh, 96px)', '@media (width <= 680px)': '8px' },
    paddingBlockEnd: { 'default': '48px', '@media (width <= 680px)': '16px' },
    paddingInline: { 'default': '24px', '@media (width <= 680px)': '16px' },
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  method: {
    minWidth: '0',
    padding: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  methodDescription: {
    fontSize: cssVar.fontSize,
    lineHeight: 1.55,
    color: cssVar.colorTextTertiary,
  },
  methodTitle: { fontSize: cssVar.fontSize, fontWeight: 600, color: cssVar.colorText },
  step: {
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr)',
    gap: '12px',
    minWidth: '0',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  stepIndex: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  steps: {
    display: 'grid',
    gridTemplateColumns: { 'default': 'minmax(0, 1fr)', '@media (width <= 680px)': '1fr' },
    gap: '12px',
  },
  tab: { flex: '1', justifyContent: 'center' },
  tabList: { width: '100%' },
  tabs: { width: '100%' },
  page: {
    flex: '1',
    width: '100%',
    minWidth: '0',
    height: '100%',
    minHeight: '0',
    padding: '8px',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  prompt: {
    flex: '1',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSize,
    lineHeight: 1.65,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
  promptBox: {
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  sectionTitle: { fontSize: '14px', fontWeight: 600, color: cssVar.colorText },
  title: {
    fontSize: cssVar.fontSizeHeading2,
    fontWeight: 600,
    lineHeight: 1.25,
    color: cssVar.colorText,
    textAlign: 'center',
    letterSpacing: '-0.02em',
  },
});

const AcceptanceOnboarding = () => {
  const { t } = useTranslation('verify');
  const navigate = useWorkspaceAwareNavigate();
  const [mode, setMode] = useState<'agent' | 'manual'>('agent');

  return (
    <Flexbox className={stylex.props(styles.page).className}>
      <Flexbox className={stylex.props(styles.container).className}>
        <Flexbox horizontal align={'center'} padding={16}>
          <Button icon={ArrowLeft} type={'text'} onClick={() => navigate(acceptanceHomePath())}>
            {t('back', { ns: 'common' })}
          </Button>
        </Flexbox>
        <Flexbox className={stylex.props(styles.content).className} gap={32}>
          <Flexbox align={'center'} gap={16}>
            <span {...stylex.props(styles.icon)}>
              <Icon icon={ClipboardCheck} size={28} />
            </span>
            <Flexbox align={'center'} gap={12}>
              <span {...stylex.props(styles.title)}>
                {t('acceptance.workspace.onboarding.title')}
              </span>
              <span {...stylex.props(styles.description)}>
                {t('acceptance.workspace.onboarding.description')}
              </span>
            </Flexbox>
          </Flexbox>

          <Flexbox gap={12}>
            <span {...stylex.props(styles.sectionTitle)}>
              {t('acceptance.workspace.onboarding.installSection')}
            </span>
            <TabsRoot
              className={stylex.props(styles.tabs).className}
              value={mode}
              onValueChange={(key) => setMode(key as 'agent' | 'manual')}
            >
              <TabsList className={stylex.props(styles.tabList).className}>
                <TabsIndicator />
                <TabsTab className={stylex.props(styles.tab).className} value={'agent'}>
                  <Icon icon={Bot} size={16} />
                  {t('acceptance.workspace.onboarding.agent.title')}
                </TabsTab>
                <TabsTab className={stylex.props(styles.tab).className} value={'manual'}>
                  <Icon icon={Terminal} size={16} />
                  {t('acceptance.workspace.onboarding.manual.title')}
                </TabsTab>
              </TabsList>
            </TabsRoot>

            {mode === 'agent' ? (
              <Flexbox className={stylex.props(styles.method).className} gap={12}>
                <span {...stylex.props(styles.methodDescription)}>
                  {t('acceptance.workspace.onboarding.agent.description')}
                </span>
                <Flexbox
                  horizontal
                  align={'flex-start'}
                  className={stylex.props(styles.promptBox).className}
                  gap={8}
                >
                  <span {...stylex.props(styles.prompt)}>
                    {t('acceptance.workspace.onboarding.agent.prompt')}
                  </span>
                  <CopyButton
                    content={t('acceptance.workspace.onboarding.agent.prompt')}
                    size={'small'}
                  />
                </Flexbox>
              </Flexbox>
            ) : (
              <div {...stylex.props(styles.steps)}>
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
                  <div {...stylex.props(styles.step)} key={step.title}>
                    <span {...stylex.props(styles.stepIndex)}>{index + 1}</span>
                    <Flexbox gap={8}>
                      <span {...stylex.props(styles.methodTitle)}>{step.title}</span>
                      <span {...stylex.props(styles.methodDescription)}>{step.description}</span>
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
};

export default AcceptanceOnboarding;
