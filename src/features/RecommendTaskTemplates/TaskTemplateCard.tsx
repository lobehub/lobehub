import type { TaskTemplate, TaskTemplateSkillRequirement } from '@lobechat/const';
import { formatScheduleTime, parseCronPattern, WEEKDAY_I18N_KEYS } from '@lobechat/utils/cron';
import { ActionIcon, Block, Button, Center, Flexbox, Icon, Image, Tag, Text } from '@lobehub/ui';
import { App, Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { Clock, type LucideIcon, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { taskTemplateService } from '@/services/taskTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';

import {
  getMainIconProvider,
  resolveTemplateIcon,
  type TemplateIconSpec,
} from './resolveTemplateIcon';
import { SkillAuthRow } from './SkillAuthRow';
import { styles } from './style';
import {
  SkillConnectionPopupBlockedError,
  useIsSkillConnected,
  useSkillConnection,
} from './useSkillConnection';

const INTEREST_ICON_MAP = new Map<string, LucideIcon>(INTEREST_AREAS.map((a) => [a.key, a.icon]));

const ICON_TILE_SIZE = 28;
const ICON_GLYPH_SIZE = ICON_TILE_SIZE * 0.6;

interface TemplateBriefIconProps {
  spec: TemplateIconSpec;
}

/** Same 28×28 tile treatment as {@link BriefIcon} (insight palette). */
const TemplateBriefIcon = memo<TemplateBriefIconProps>(({ spec }) => (
  <Block
    align={'center'}
    height={ICON_TILE_SIZE}
    justify={'center'}
    style={{ background: cssVar.colorFillSecondary, flexShrink: 0 }}
    width={ICON_TILE_SIZE}
  >
    {spec.kind === 'url' ? (
      <Image
        alt={''}
        height={ICON_GLYPH_SIZE}
        src={spec.src}
        style={{ flex: 'none' }}
        width={ICON_GLYPH_SIZE}
      />
    ) : (
      <Icon
        color={cssVar.colorTextSecondary}
        fill={cssVar.colorTextSecondary}
        icon={spec.Comp}
        size={ICON_GLYPH_SIZE}
      />
    )}
  </Block>
));

TemplateBriefIcon.displayName = 'TemplateBriefIcon';

interface TaskTemplateCardProps {
  onCreated: (templateId: string) => void;
  onDismiss: (templateId: string) => void;
  template: TaskTemplate;
}

export const TaskTemplateCard = memo<TaskTemplateCardProps>(
  ({ template, onCreated, onDismiss }) => {
    const { t } = useTranslation('taskTemplate');
    const { t: tSetting } = useTranslation('setting');
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [created, setCreated] = useState(false);
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const createTask = useTaskStore((s) => s.createTask);
    const navigate = useNavigate();

    const requiredConnection = useSkillConnection(template.requiresSkills);
    const isSkillConnected = useIsSkillConnected();

    const iconSpec = useMemo(() => resolveTemplateIcon(template, INTEREST_ICON_MAP), [template]);
    const mainIconProvider = useMemo(() => getMainIconProvider(template), [template]);

    // Hide already-connected providers and the one the main card icon already
    // represents — we never want the same logo twice on a single card.
    const visibleAuthSpecs = useMemo<TaskTemplateSkillRequirement[]>(() => {
      const all = [...(template.requiresSkills ?? []), ...(template.optionalSkills ?? [])];
      return all.filter((spec) => {
        if (isSkillConnected(spec)) return false;
        if (
          mainIconProvider &&
          mainIconProvider.provider === spec.provider &&
          mainIconProvider.source === spec.source
        ) {
          return false;
        }
        return true;
      });
    }, [template.requiresSkills, template.optionalSkills, isSkillConnected, mainIconProvider]);
    const title = t(`${template.id}.title`, { defaultValue: '' });
    const description = t(`${template.id}.description`, { defaultValue: '' });

    const scheduleText = useMemo(() => {
      const parsed = parseCronPattern(template.cronPattern);
      const time = formatScheduleTime(parsed.triggerHour, parsed.triggerMinute);
      if (parsed.scheduleType === 'weekly' && parsed.weekdays?.length === 1) {
        const weekday = tSetting(`agentCronJobs.weekday.${WEEKDAY_I18N_KEYS[parsed.weekdays[0]]}`);
        return t('schedule.weekly', { time, weekday });
      }
      return t('schedule.daily', { time });
    }, [t, tSetting, template.cronPattern]);

    const handleCreate = useCallback(async () => {
      if (!inboxAgentId) return;
      setLoading(true);
      try {
        const prompt = t(`${template.id}.prompt`, { defaultValue: '' });
        const createdTask = await createTask({
          assigneeAgentId: inboxAgentId,
          automationMode: 'schedule',
          instruction: prompt,
          name: title,
          schedulePattern: template.cronPattern,
          scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        await taskTemplateService.recordCreated(template.id).catch((recordError) => {
          console.error('[taskTemplate:recordCreated]', recordError);
        });
        setCreated(true);
        onCreated(template.id);
        if (createdTask?.identifier) {
          navigate(`/task/${createdTask.identifier}`);
        }
      } catch (error) {
        console.error('[taskTemplate:create]', error);
        message.error(t('action.create.error'));
      } finally {
        setLoading(false);
      }
    }, [
      createTask,
      inboxAgentId,
      message,
      navigate,
      onCreated,
      t,
      template.cronPattern,
      template.id,
      title,
    ]);

    const handleDismiss = useCallback(() => {
      if (loading || created) return;
      onDismiss(template.id);
    }, [created, loading, onDismiss, template.id]);

    const handleConnectError = useCallback(
      (error: unknown) => {
        message.error(
          error instanceof SkillConnectionPopupBlockedError
            ? t('action.connect.popupBlocked')
            : t('action.connect.error'),
        );
      },
      [message, t],
    );

    // Drive the "click Add task -> chain OAuth popups -> create task" flow via a
    // pending flag instead of awaiting connect(): useSkillConnection returns as
    // soon as the popup opens, with real status arriving through store polling.
    const [pendingCreate, setPendingCreate] = useState(false);
    const requiredConnectionRef = useRef(requiredConnection);
    requiredConnectionRef.current = requiredConnection;
    const handleCreateRef = useRef(handleCreate);
    handleCreateRef.current = handleCreate;
    const handleConnectErrorRef = useRef(handleConnectError);
    handleConnectErrorRef.current = handleConnectError;

    useEffect(() => {
      if (!pendingCreate) return;
      if (requiredConnection.isConnecting) return;
      if (requiredConnection.needsConnect) {
        requiredConnectionRef.current.connect().catch((error) => {
          setPendingCreate(false);
          handleConnectErrorRef.current(error);
        });
        return;
      }
      setPendingCreate(false);
      void handleCreateRef.current();
    }, [pendingCreate, requiredConnection.isConnecting, requiredConnection.needsConnect]);

    const handleAddTask = useCallback(() => {
      if (created || !inboxAgentId) return;
      if (requiredConnection.needsConnect) {
        setPendingCreate(true);
        return;
      }
      void handleCreate();
    }, [created, inboxAgentId, requiredConnection.needsConnect, handleCreate]);

    const primaryButtonLabel = loading
      ? t('action.creating')
      : pendingCreate
        ? t('action.connecting')
        : t('action.createButton');

    const primaryButton = (
      <Button
        shadow
        className={briefStyles.actionBtnPrimary}
        disabled={created || !inboxAgentId}
        loading={loading || pendingCreate}
        shape={'round'}
        onClick={handleAddTask}
      >
        {primaryButtonLabel}
      </Button>
    );

    return (
      <Block
        className={cx(briefStyles.card, styles.card)}
        gap={12}
        padding={12}
        style={{ borderRadius: cssVar.borderRadiusLG }}
        variant={'outlined'}
      >
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            <TemplateBriefIcon spec={iconSpec} />
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={6}
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              <Text ellipsis fontSize={16} weight={500}>
                {title}
              </Text>
              <ActionIcon
                icon={Clock}
                size={12}
                title={
                  <Center>
                    <span>{scheduleText}</span>
                    {t('schedule.editableAfterCreateTooltip')}
                  </Center>
                }
              />
            </Flexbox>
          </Flexbox>

          <Flexbox horizontal align={'center'} gap={8}>
            <ActionIcon
              className={`${styles.dismissBtn} task-template-dismiss`}
              icon={X}
              size={'small'}
              title={t('action.dismiss.tooltip')}
              onClick={handleDismiss}
            />
          </Flexbox>
        </Flexbox>
        <Divider dashed style={{ marginBlock: 0 }} />
        {description.trim().length > 0 ? <BriefCardSummary summary={description} /> : null}
        {visibleAuthSpecs.length > 0 && (
          <Flexbox gap={6}>
            {visibleAuthSpecs.map((spec) => (
              <SkillAuthRow
                key={`${spec.source}:${spec.provider}`}
                spec={spec}
                onError={handleConnectError}
              />
            ))}
          </Flexbox>
        )}
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Tag size={'small'} variant={'outlined'}>
              {t('card.templateTag')}
            </Tag>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            {primaryButton}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

TaskTemplateCard.displayName = 'TaskTemplateCard';
