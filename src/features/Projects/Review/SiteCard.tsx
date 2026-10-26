import { isDesktop, OFFICIAL_URL } from '@lobechat/const';
import {
  ActionIcon,
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
import { ExternalLinkIcon, MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { projectReviewService, type ProjectSiteItem } from '@/services/projectReview';

import { openSiteModal } from './SiteFormModal';
import { reviewLink, siteSnippet } from './siteSnippet';

const styles = stylex.create({
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
  const link = reviewLink(site.origins);
  const snippet = siteSnippet(site.id, reviewServer());

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
          <Text weight={600}>{site.name}</Text>
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
