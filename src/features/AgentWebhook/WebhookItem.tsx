'use client';

import { agentDisplayName, type InboundWebhookItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Center,
  confirmModal,
  CopyButton,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Switch,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  KeyRoundIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  WebhookIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import {
  AutomationStatusReason,
  AutomationStatusTag,
} from '@/features/Automations/AutomationStatus';
import ChannelTarget from '@/features/Automations/ChannelTarget';
import { openRenameAutomationModal } from '@/features/Automations/RenameAutomationModal';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { inboundWebhookService } from '@/services/inboundWebhook';

import DeliveryLog from './DeliveryLog';
import { openWebhookKeyModal } from './KeyReveal';
import UsageGuide from './UsageGuide';
import { openWebhookFormModal } from './WebhookFormModal';

dayjs.extend(relativeTime);

const styles = stylex.create({
  endpoint: {
    overflow: 'hidden',
    flex: '1',
    minInlineSize: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  endpointRow: {
    paddingBlock: '6px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  iconTile: {
    flex: 'none',
    inlineSize: '32px',
    blockSize: '32px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  agentLink: {
    alignSelf: 'flex-start',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorLink },
  },
  meta: { fontSize: '12px', color: cssVar.colorTextSecondary },
  root: {
    paddingBlock: '16px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
});

type Section = 'deliveries' | 'usage';

interface WebhookItemProps {
  agentId: string;
  /** Open "How to call" from the start (a webhook just created). */
  defaultSection?: Section;
  item: InboundWebhookItem;
  onChange: (item: InboundWebhookItem) => void;
  onRemoved: (id: string) => void;
  /** Name the agent it wakes, on a list of every agent's webhooks. */
  showAgent?: boolean;
}

/**
 * One webhook: what it is and whether it runs, the URL to give callers, and on request how to
 * call it and what its recent calls did. Changing it takes the creator or a workspace admin;
 * everyone else sees it read-only, without the URL.
 */
const WebhookItem = memo<WebhookItemProps>(
  ({ agentId, defaultSection, item, onChange, onRemoved, showAgent }) => {
    const { t } = useTranslation('agent');
    const [section, setSection] = useState<Section | undefined>(defaultSection);
    const [pendingActive, setPendingActive] = useState<boolean>();
    const [testing, setTesting] = useState(false);
    // Bumped after a test so an open log reads the new delivery.
    const [logKey, setLogKey] = useState(0);
    const source = item.source.kind === 'generic' ? item.source : undefined;
    // One that posts to a Channel is configured from the CLI or by the Agent; here it is shown and
    // can be deleted, not changed.
    const readOnly = !!source?.delivery;
    const canConfigure = item.canConfigure && !readOnly;
    const active = pendingActive ?? item.status !== 'paused';
    const name = item.name?.trim() || t('webhook.defaultName');
    const toggle = (next: Section) =>
      setSection((current) => (current === next ? undefined : next));

    const setActive = async (next: boolean) => {
      setPendingActive(next);
      try {
        onChange(await inboundWebhookService.update(item.id, { paused: !next }));
        toast.success(t(next ? 'webhook.resumed' : 'webhook.paused'));
      } catch {
        toast.error(t('webhook.updateFailed'));
      } finally {
        setPendingActive(undefined);
      }
    };

    const sendTest = async () => {
      setTesting(true);
      try {
        const result = await inboundWebhookService.sendTest(item.id);
        if (result.accepted) {
          toast.success(t('webhook.test.sent'));
          setSection('deliveries');
          setLogKey((key) => key + 1);
        } else
          toast.error(t(result.status === 409 ? 'webhook.test.paused' : 'webhook.test.failed'));
      } catch {
        toast.error(t('webhook.test.failed'));
      } finally {
        setTesting(false);
      }
    };

    const rotate = () =>
      confirmModal({
        cancelText: t('webhook.cancel'),
        content: t('webhook.rotate.content'),
        okButtonProps: { danger: true },
        okText: t('webhook.rotate.ok'),
        onOk: async () => {
          try {
            const rotated = await inboundWebhookService.rotateToken(item.id);
            onChange(rotated.item);
            if (rotated.item.endpoint)
              openWebhookKeyModal({ endpoint: rotated.item.endpoint, secret: rotated.secret });
          } catch {
            toast.error(t('webhook.updateFailed'));
          }
        },
        title: t('webhook.rotate.title'),
      });

    const remove = () =>
      confirmModal({
        cancelText: t('webhook.cancel'),
        content: t('webhook.delete.content', { name }),
        okButtonProps: { danger: true },
        okText: t('webhook.delete.ok'),
        onOk: async () => {
          try {
            await inboundWebhookService.delete(item.id);
            onRemoved(item.id);
            toast.success(t('webhook.delete.done'));
          } catch {
            toast.error(t('webhook.delete.failed'));
          }
        },
        title: t('webhook.delete.title'),
      });

    // The name is for people: renaming leaves the identifier the Agent knows it by.
    const rename = () =>
      openRenameAutomationModal({
        currentName: item.name ?? '',
        fallback: t('webhook.defaultName'),
        onSubmit: async (next) => {
          try {
            onChange(await inboundWebhookService.update(item.id, { name: next }));
            toast.success(t('webhook.renamed'));
            return undefined;
          } catch {
            return t('webhook.updateFailed');
          }
        },
        title: t('webhook.actions.rename'),
      });

    // What the webhook runs is its creator's to change; others who manage it can stop or delete it.
    // One that posts to a Channel keeps what it runs as the CLI or chat set it; only its name
    // changes here.
    const menu: DropdownItem[] = [
      ...(item.canConfigure && readOnly
        ? ([
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'rename',
              label: t('webhook.actions.rename'),
              onClick: rename,
            },
            { type: 'divider' },
          ] satisfies DropdownItem[])
        : []),
      ...(canConfigure
        ? ([
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'edit',
              label: t('webhook.actions.edit'),
              onClick: () => openWebhookFormModal({ agentId, item, onSaved: onChange }),
            },
            {
              icon: <Icon icon={KeyRoundIcon} />,
              key: 'rotate',
              label: t('webhook.actions.rotate'),
              onClick: rotate,
            },
            { type: 'divider' },
          ] satisfies DropdownItem[])
        : []),
      {
        danger: true,
        icon: <Icon icon={Trash2Icon} />,
        key: 'delete',
        label: t('webhook.actions.delete'),
        onClick: remove,
      },
    ];

    const meta = [
      // What the Agent knows it by; fixed, unlike the name above.
      t('webhook.identifier', { identifier: item.identifier }),
      source?.topicMode === 'reuse' && source.topicId
        ? item.topic
          ? t('webhook.topic.continues', {
              title: item.topic.title?.trim() || t('webhook.topic.untitled'),
            })
          : // The picked Topic was deleted or moved; calls now go to the webhook's own.
            t('webhook.topic.pickedGone')
        : t(source?.topicMode === 'reuse' ? 'webhook.topicMode.reuse' : 'webhook.topicMode.new'),
      item.lastDeliveryAt
        ? t('webhook.lastCall', { time: dayjs(item.lastDeliveryAt).fromNow() })
        : t('webhook.noCalls'),
    ].join(' · ');

    return (
      <Flexbox gap={12} {...stylex.props(styles.root)}>
        <Flexbox horizontal align={'center'} gap={12}>
          <Center {...stylex.props(styles.iconTile)}>
            <Icon icon={WebhookIcon} size={18} />
          </Center>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <Text ellipsis weight={500}>
                {name}
              </Text>
              <AutomationStatusTag item={item} />
              {source?.autoApprove && <Tag color={'warning'}>{t('webhook.autoApproveTag')}</Tag>}
            </Flexbox>
            <span {...stylex.props(styles.meta)}>{meta}</span>
          </Flexbox>
          {item.canManage && readOnly && (
            <DropdownMenu items={menu} placement={'bottomRight'}>
              <ActionIcon icon={MoreHorizontalIcon} title={t('webhook.actions.more')} />
            </DropdownMenu>
          )}
          {item.canManage && !readOnly && (
            <>
              <Switch
                checked={active}
                loading={pendingActive !== undefined}
                title={t(active ? 'webhook.actions.pause' : 'webhook.actions.resume')}
                onChange={setActive}
              />
              <DropdownMenu items={menu} placement={'bottomRight'}>
                <ActionIcon icon={MoreHorizontalIcon} title={t('webhook.actions.more')} />
              </DropdownMenu>
            </>
          )}
        </Flexbox>

        {showAgent && item.agent && (
          <WorkspaceLink to={`/agent/${item.agent.id}/webhook`} {...stylex.props(styles.agentLink)}>
            <Flexbox horizontal align={'center'} gap={6}>
              <AgentAvatar
                agentId={item.agent.id}
                avatar={item.agent.avatar}
                background={item.agent.backgroundColor ?? undefined}
                name={agentDisplayName(item.agent, t('webhook.untitledAgent'))}
                size={18}
              />
              <span>
                {t('webhook.wakes', {
                  agent: agentDisplayName(item.agent, t('webhook.untitledAgent')),
                })}
              </span>
            </Flexbox>
          </WorkspaceLink>
        )}

        <AutomationStatusReason item={item} />

        {readOnly && (
          <Flexbox gap={2}>
            <ChannelTarget item={item} />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('webhook.channel.readOnly')}
            </Text>
          </Flexbox>
        )}

        {item.endpoint && (
          <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.endpointRow)}>
            <span title={item.endpoint} {...stylex.props(styles.endpoint)}>
              {item.endpoint}
            </span>
            <CopyButton content={item.endpoint} size={'small'} title={t('webhook.endpoint.copy')} />
          </Flexbox>
        )}

        {item.instructions && (
          <Text ellipsis={{ rows: 2 }} style={{ fontSize: 12 }} type={'secondary'}>
            {t('webhook.instructionsPreview', { instructions: item.instructions })}
          </Text>
        )}

        <Flexbox horizontal gap={8} wrap={'wrap'}>
          {item.canConfigure && (
            <Button
              disabled={item.status === 'paused'}
              icon={SendIcon}
              loading={testing}
              size={'small'}
              onClick={sendTest}
            >
              {t('webhook.actions.test')}
            </Button>
          )}
          {item.endpoint && (
            <Button
              aria-expanded={section === 'usage'}
              size={'small'}
              type={'text'}
              onClick={() => toggle('usage')}
            >
              {t('webhook.actions.usage')}
            </Button>
          )}
          {item.canManage && (
            <Button
              aria-expanded={section === 'deliveries'}
              size={'small'}
              type={'text'}
              onClick={() => toggle('deliveries')}
            >
              {t('webhook.actions.deliveries')}
            </Button>
          )}
        </Flexbox>

        {section === 'usage' && item.endpoint && <UsageGuide endpoint={item.endpoint} />}
        {section === 'deliveries' && (
          <DeliveryLog agentId={agentId} key={logKey} webhookId={item.id} />
        )}
      </Flexbox>
    );
  },
);

WebhookItem.displayName = 'AgentWebhookItem';

export default WebhookItem;
