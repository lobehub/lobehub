import { ActionIcon, Block, Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  FolderGit2Icon,
  GlobeIcon,
  LibraryIcon,
  type LucideIcon,
  TargetIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLinearIntegration } from '@/features/Integrations/useLinearIntegration';
import { useGlobalStore } from '@/store/global';
import type { ProjectDetail } from '@/store/project';
import { sx } from '@/styles/sx';

import ImportTrigger from '../LinearSync/ImportTrigger';
import type { ProjectComposerMode } from '../Workspace/useProjectComposer';
import BasicRow from './BasicRow';
import ConnectTile from './ConnectTile';
import { getOnboardingCardVisible, type OnboardingConnection } from './steps';
import { useOnboardingActions, useOnboardingCardAllowed } from './useOnboardingActions';
import { useOnboardingChecklist } from './useOnboardingChecklist';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  connect: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlockStart: 12,
  },
  fill: {
    backgroundColor: cssVar.colorPrimary,
    height: '100%',
    transitionDuration: '300ms',
    transitionProperty: 'width',
  },
  tiles: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  },
});

const CONNECT_ICONS: Record<OnboardingConnection['key'], LucideIcon> = {
  directory: FolderGit2Icon,
  goal: TargetIcon,
  knowledge: LibraryIcon,
  site: GlobeIcon,
};

interface ProjectOnboardingCardProps {
  detail: ProjectDetail;
  onComposerRequest: (mode: ProjectComposerMode) => void;
}

const OnboardingChecklistCard = ({ detail, onComposerRequest }: ProjectOnboardingCardProps) => {
  const { t } = useTranslation('project');
  const { project } = detail;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const linear = useLinearIntegration();
  const [waitingForScript, setWaitingForScript] = useState(false);
  const { checklist, refreshSites } = useOnboardingChecklist(detail, waitingForScript);
  const { inviteMembers, openConnection } = useOnboardingActions(detail, refreshSites);

  const siteWaiting = checklist.connect.some((item) => item.site === 'waiting');
  if (siteWaiting !== waitingForScript) setWaitingForScript(siteWaiting);

  if (!getOnboardingCardVisible(checklist, { canManage: true, dismissed: false })) return null;

  const canImportFromLinear = linear.enabled && linear.connections.length > 0;

  const basicActions = {
    firstChat: (
      <Button size="small" onClick={() => onComposerRequest('chat')}>
        {t('onboarding.basics.firstChat.action')}
      </Button>
    ),
    importTasks: (
      <>
        <Button size="small" onClick={() => onComposerRequest('task')}>
          {t('onboarding.basics.importTasks.create')}
        </Button>
        {canImportFromLinear ? (
          <ImportTrigger connections={linear.connections} projectId={project.id} variant="button" />
        ) : null}
      </>
    ),
    inviteMembers: (
      <Button size="small" onClick={inviteMembers}>
        {t('onboarding.basics.inviteMembers.action')}
      </Button>
    ),
  };

  const connectStatus = (item: OnboardingConnection) => {
    switch (item.key) {
      case 'site': {
        if (item.site === 'seen') return t('onboarding.connect.site.seen');
        if (item.site === 'waiting') return t('onboarding.connect.site.waiting');
        return t('onboarding.connect.site.description');
      }
      case 'directory': {
        return item.done
          ? t('onboarding.connect.directory.count', { count: item.count })
          : t('onboarding.connect.directory.description');
      }
      case 'knowledge': {
        return item.done
          ? t('onboarding.connect.knowledge.count', { count: item.count })
          : t('onboarding.connect.knowledge.description');
      }
      case 'goal': {
        return item.done
          ? t('onboarding.connect.goal.count', { count: item.count })
          : t('onboarding.connect.goal.description');
      }
    }
  };

  return (
    <Block gap={12} padding={16} style={{ borderRadius: 12 }} variant="outlined">
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox horizontal align="baseline" gap={8}>
          <Text weight={600}>{t('onboarding.title')}</Text>
          <Text fontSize={12} type="secondary">
            {t('onboarding.progress', { completed: checklist.completed, total: checklist.total })}
          </Text>
        </Flexbox>
        <ActionIcon
          icon={XIcon}
          size="small"
          title={t('onboarding.dismiss')}
          onClick={() => updateSystemStatus({ dismissedProjectOnboarding: { [project.id]: true } })}
        />
      </Flexbox>
      <div {...stylex.props(styles.bar)}>
        <div
          {...sx(styles.fill, undefined, {
            width: `${(checklist.completed / checklist.total) * 100}%`,
          })}
        />
      </div>
      <Flexbox>
        {checklist.basics.map((step) => (
          <BasicRow
            actions={basicActions[step.key]}
            done={step.done}
            key={step.key}
            title={t(`onboarding.basics.${step.key}.title`)}
          />
        ))}
      </Flexbox>
      <Flexbox gap={10} {...stylex.props(styles.connect)}>
        <Flexbox horizontal align="baseline" gap={8}>
          <Text fontSize={12} weight={600}>
            {t('onboarding.connect.title')}
          </Text>
          <Text fontSize={12} type="secondary">
            {t('onboarding.connect.hint')}
          </Text>
        </Flexbox>
        <div {...stylex.props(styles.tiles)}>
          {checklist.connect.map((item) => (
            <ConnectTile
              done={item.done}
              icon={CONNECT_ICONS[item.key]}
              key={item.key}
              status={connectStatus(item)}
              title={t(`onboarding.connect.${item.key}.title`)}
              waiting={item.site === 'waiting'}
              onClick={() => openConnection(item)}
            />
          ))}
        </div>
      </Flexbox>
    </Block>
  );
};

const ProjectOnboardingCard = (props: ProjectOnboardingCardProps) => {
  const allowed = useOnboardingCardAllowed(props.detail.project.id);
  if (!allowed) return null;

  return <OnboardingChecklistCard {...props} />;
};

export default ProjectOnboardingCard;
