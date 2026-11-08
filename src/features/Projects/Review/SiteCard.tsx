import { ACCEPTANCE_REVIEW_ACTIVATION_PARAM, isDesktop, OFFICIAL_URL } from '@lobechat/const';
import {
  ActionIcon,
  Alert,
  Block,
  Button,
  confirmModal,
  CopyButton,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ExternalLinkIcon, MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { projectReviewService, type ProjectSiteItem } from '@/services/projectReview';

import { getSiteDetection } from './siteDetection';
import { openSiteModal } from './SiteFormModal';
import { reviewLink, siteSnippet } from './siteSnippet';

const styles = stylex.create({
  dot: {
    borderRadius: '50%',
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  dotSeen: {
    backgroundColor: cssVar.colorSuccess,
  },
  dotWaiting: {
    backgroundColor: cssVar.colorWarning,
  },
  origin: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
  snippet: {
    color: cssVar.colorTextSecondary,
    flex: '1',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    lineHeight: 1.7,
    minWidth: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
});

const reviewServer = () => (isDesktop ? OFFICIAL_URL : window.location.origin);

export function SiteCard({ onChanged, site }: { onChanged: () => void; site: ProjectSiteItem }) {
  const { t } = useTranslation('project');
  const [deleting, setDeleting] = useState(false);
  const link = reviewLink(site.origins, site.acceptanceId);
  const snippet = siteSnippet(site.id, reviewServer());
  const detection = getSiteDetection(site.lastSeenAt);

  const remove = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('review.sites.deleteDescription', { name: site.name }),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        setDeleting(true);
        try {
          await projectReviewService.deleteSite(site.id);
          onChanged();
        } catch (error) {
          console.error('Failed to delete site', error);
          toast.error(t('review.sites.deleteError'));
          throw error;
        } finally {
          setDeleting(false);
        }
      },
      title: t('review.sites.deleteTitle', { name: site.name }),
    });

  const menuItems: DropdownItem[] = [
    {
      icon: PencilIcon,
      key: 'edit',
      label: t('review.sites.edit'),
      onClick: () => openSiteModal({ onSaved: onChanged, projectId: site.projectId, site }),
    },
    {
      danger: true,
      icon: TrashIcon,
      key: 'delete',
      label: t('review.sites.delete'),
      onClick: remove,
    },
  ];

  return (
    <Block gap={12} padding={16} variant="outlined">
      <Flexbox horizontal align="flex-start" gap={12} justify="space-between" wrap="wrap">
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <Text weight={600}>{site.name}</Text>
            <Tag>
              <Flexbox horizontal align="center" gap={6}>
                <span
                  {...stylex.props(
                    styles.dot,
                    detection.state === 'seen' ? styles.dotSeen : styles.dotWaiting,
                  )}
                />
                {detection.state === 'seen'
                  ? t('review.sites.detectSeen', { time: dayjs(detection.at).fromNow() })
                  : t('review.sites.detectWaiting')}
              </Flexbox>
            </Tag>
          </Flexbox>
          <Flexbox horizontal gap={6} wrap="wrap">
            {site.origins.map((origin) => (
              <Tag {...stylex.props(styles.origin)} key={origin}>
                {origin}
              </Tag>
            ))}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          <Tooltip title={link ? undefined : t('review.sites.openUnavailable')}>
            <Button
              disabled={!link}
              href={link ?? undefined}
              icon={ExternalLinkIcon}
              rel="noreferrer"
              target="_blank"
              type="primary"
            >
              {t('review.sites.open')}
            </Button>
          </Tooltip>
          <DropdownMenu items={menuItems} placement="bottomRight">
            <ActionIcon
              icon={MoreHorizontalIcon}
              loading={deleting}
              title={t('review.sites.moreActions', { name: site.name })}
            />
          </DropdownMenu>
        </Flexbox>
      </Flexbox>
      <Block horizontal align="flex-start" gap={10} padding={12} variant="filled">
        <code {...stylex.props(styles.snippet)}>{snippet}</code>
        <CopyButton content={snippet} size="small" title={t('review.sites.copySnippet')} />
      </Block>
      {detection.state === 'waiting' ? (
        <Alert
          showIcon
          description={t('review.sites.detectWaitingDescription')}
          title={t('review.sites.detectWaitingTitle')}
          type="warning"
        />
      ) : null}
      {link ? (
        <Flexbox gap={6}>
          <Text fontSize={12} weight={500}>
            {t('review.sites.activation')}
          </Text>
          <Text fontSize={12} type="secondary">
            {t('review.sites.activationHint', { param: ACCEPTANCE_REVIEW_ACTIVATION_PARAM })}
          </Text>
          <Block horizontal align="flex-start" gap={10} padding={12} variant="filled">
            <code {...stylex.props(styles.snippet)}>{link}</code>
            <CopyButton content={link} size="small" title={t('review.sites.copyActivation')} />
          </Block>
        </Flexbox>
      ) : null}
      {site.acceptanceId ? (
        <Flexbox horizontal justify="flex-end">
          <WorkspaceLink to={`/acceptance/${site.acceptanceId}`}>
            <Text fontSize={12} type="secondary">
              {t('review.sites.viewReview')}
            </Text>
          </WorkspaceLink>
        </Flexbox>
      ) : null}
    </Block>
  );
}
