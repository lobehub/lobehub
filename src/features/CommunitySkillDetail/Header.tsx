'use client';

import {
  Avatar,
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
  useResponsive,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2, CheckIcon, ChevronDown, Trash2 } from 'lucide-react';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import Rate from '@/components/RatingOverview/Rate';
import { usePermission } from '@/hooks/usePermission';
import { useSkillCategoryItem } from '@/hooks/useSkillCategory';
import { agentSkillService } from '@/services/skill';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { formatShortenNumber } from '@/utils/format';

import { FIRST_COMMENTS_PAGE_QUERY } from './const';
import { useDetailContext } from './DetailProvider';

const styles = stylex.create({
  author: { fontWeight: 500, color: cssVar.colorInfo },
  metaDivider: {
    flex: 'none',
    width: '1px',
    height: '12px',
    marginInline: '3px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  ratingValue: {
    fontSize: '26px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    color: cssVar.colorText,
  },
  statBlock: {
    transition: 'background 0.2s ease',
    backgroundColor: {
      'default': null,
      ':hover': `color-mix(in srgb, ${cssVar.colorFillQuaternary} 74%, transparent)`,
    },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  statCaption: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '14px',
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1.1,
    color: cssVar.colorTextDescription,
  },
  statLabel: { fontSize: '11px', fontWeight: 600, color: cssVar.colorTextDescription },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    color: cssVar.colorText,
  },
  statsBar: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${cssVar.colorBorderSecondary} 88%, transparent)`,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      [media.sm]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  time: { fontSize: '12px', color: cssVar.colorTextDescription },
});

const MetaDivider = () => <span aria-hidden {...stylex.props(styles.metaDivider)} />;

const StatBlock = memo<{
  bordered?: boolean;
  caption?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}>(({ value, label, caption, bordered }) => {
  return (
    <Flexbox
      align={'center'}
      className={stylex.props(styles.statBlock).className}
      flex={1}
      gap={5}
      justify={'center'}
      style={{
        borderInlineStart: bordered ? `1px solid ${cssVar.colorBorderSecondary}` : undefined,
        minHeight: 78,
        paddingBlock: 10,
        textAlign: 'center',
      }}
    >
      <div {...stylex.props(styles.statLabel)}>{label}</div>
      <div {...stylex.props(styles.statValue)}>{value}</div>
      <div aria-hidden={!caption} {...stylex.props(styles.statCaption)}>
        {caption}
      </div>
    </Flexbox>
  );
});

const InstallButton = memo<{ identifier?: string; name?: string }>(({ identifier, name }) => {
  const { t } = useTranslation('plugin');
  const { t: tc } = useTranslation('common');
  const { t: td } = useTranslation('discover');
  const [installing, setInstalling] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  // Ensure agent skills are fetched so the install state is real on a direct
  // visit — otherwise installed skills render as installable
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  const installed = useToolStore(agentSkillsSelectors.isAgentSkill(identifier || ''));
  const installedSkill = useToolStore(
    agentSkillsSelectors.getAgentSkillByIdentifier(identifier || ''),
  );
  const [refreshAgentSkills, deleteAgentSkill] = useToolStore((s) => [
    s.refreshAgentSkills,
    s.deleteAgentSkill,
  ]);

  const handleInstall = useCallback(async () => {
    if (!identifier || !canCreate || installing || installed) return;
    setInstalling(true);
    try {
      await agentSkillService.importFromMarket(identifier);
      await refreshAgentSkills();
    } catch {
      // The button falls back to Install (clicking again retries) — say why
      toast.error(t('error.installError', { name: name || identifier }));
    } finally {
      setInstalling(false);
    }
  }, [canCreate, identifier, installing, installed, name, refreshAgentSkills, t]);

  const handleUninstall = useCallback(() => {
    if (!canEdit || !installedSkill) return;
    confirmModal({
      cancelText: tc('cancel'),
      content: t('store.actions.confirmUninstall'),
      okButtonProps: { danger: true },
      okText: t('store.actions.uninstall'),
      onOk: async () => {
        await deleteAgentSkill(installedSkill.id);
      },
      title: t('store.actions.uninstall'),
    });
  }, [canEdit, installedSkill, deleteAgentSkill, t, tc]);

  if (installed)
    return (
      <DropdownMenu
        nativeButton={false}
        placement="bottomRight"
        items={[
          {
            danger: true,
            disabled: !canEdit,
            icon: <Icon icon={Trash2} />,
            key: 'uninstall',
            label: t('store.actions.uninstall'),
            onClick: handleUninstall,
          },
        ]}
      >
        <Button icon={CheckIcon} size={'middle'} style={{ borderRadius: 999 }}>
          {td('skills.details.header.installed')}
          <Icon icon={ChevronDown} size={14} />
        </Button>
      </DropdownMenu>
    );

  return (
    <Button
      disabled={!canCreate}
      loading={installing}
      size={'middle'}
      style={{ borderRadius: 999, fontWeight: 600, paddingInline: 18 }}
      type={'primary'}
      onClick={handleInstall}
    >
      {t('store.actions.install')}
    </Button>
  );
});

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const {
    name,
    author,
    identifier,
    updatedAt,
    createdAt,
    ratingAverage,
    ratingCount,
    category,
    installCount,
    github,
    icon,
    isValidated,
  } = useDetailContext();
  const { t } = useTranslation('discover');
  const { mobile = isMobile } = useResponsive();
  const categoryItem = useSkillCategoryItem(category);

  // Same query as the Reviews tab — SWR dedupes them into one request, so the
  // stat costs nothing extra and warms the tab
  const useFetchSkillComments = useDiscoverStore((s) => s.useFetchSkillComments);
  const { queryKey: commentsKey } = useFetchSkillComments({
    identifier,
    ...FIRST_COMMENTS_PAGE_QUERY,
  });
  const comments = useDiscoverStore(skillSelectors.skillComments(commentsKey));

  const displayRatingAverage =
    typeof ratingAverage === 'number' ? Number(ratingAverage.toFixed(1)) : undefined;

  const stats = [
    displayRatingAverage
      ? {
          caption: <Rate gap={2} size={11} value={displayRatingAverage} />,
          label: ratingCount
            ? t('skills.details.header.stats.ratingCount', {
                count: formatShortenNumber(ratingCount),
              })
            : t('skills.details.header.stats.rating'),
          statKey: 'rating',
          value: <div {...stylex.props(styles.ratingValue)}>{displayRatingAverage.toFixed(1)}</div>,
        }
      : undefined,
    github?.stars
      ? {
          caption: t('skills.details.header.stats.starsCaption'),
          label: t('skills.details.header.stats.github'),
          statKey: 'stars',
          value: formatShortenNumber(github.stars),
        }
      : undefined,
    installCount
      ? {
          caption: '',
          label: t('skills.details.header.stats.installs'),
          statKey: 'installs',
          value: formatShortenNumber(installCount),
        }
      : undefined,
    comments?.totalCount
      ? {
          caption: '',
          label: t('skills.details.header.stats.reviews'),
          statKey: 'reviews',
          value: formatShortenNumber(comments.totalCount),
        }
      : undefined,
  ].filter(Boolean) as {
    caption?: ReactNode;
    label: ReactNode;
    statKey: string;
    value: ReactNode;
  }[];

  return (
    <Flexbox align={'stretch'} gap={20} width={'100%'}>
      <Flexbox align={'center'} gap={20} horizontal={!mobile} width={'100%'}>
        <Avatar
          avatar={icon || name}
          size={mobile ? 72 : 88}
          style={{
            background: cssVar.colorBgContainer,
            border: `1px solid color-mix(in srgb, ${cssVar.colorBorderSecondary} 86%, transparent)`,
            borderRadius: mobile ? 18 : 22,
            flex: 'none',
          }}
        />
        <Flexbox
          align={mobile ? 'center' : 'flex-start'}
          flex={1}
          gap={6}
          style={{ minWidth: 0, overflow: 'hidden', textAlign: mobile ? 'center' : undefined }}
        >
          <Text
            ellipsis
            as={'h1'}
            title={identifier}
            style={{
              fontSize: mobile ? 22 : 28,
              fontWeight: 650,
              lineHeight: 1.12,
              margin: 0,
            }}
          >
            {name}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            justify={mobile ? 'center' : undefined}
            wrap={'wrap'}
          >
            {author?.url ? (
              <a
                {...stylex.props(styles.author)}
                href={author.url}
                rel={'noopener noreferrer'}
                target={'_blank'}
              >
                {author.name}
              </a>
            ) : (
              <span {...stylex.props(styles.author)}>{author?.name}</span>
            )}
            {isValidated && (
              <Icon
                color={cssVar.colorInfo}
                fill={cssVar.colorInfo}
                icon={CheckCircle2}
                size={14}
              />
            )}
            {categoryItem && (
              <>
                <MetaDivider />
                <Text style={{ color: cssVar.colorTextSecondary, fontSize: 13 }}>
                  {categoryItem.label}
                </Text>
              </>
            )}
            {(updatedAt || createdAt) && (
              <>
                <MetaDivider />
                <PublishedTime
                  className={stylex.props(styles.time).className}
                  date={(updatedAt || createdAt) as string}
                  template={'MMM DD, YYYY'}
                />
              </>
            )}
          </Flexbox>
        </Flexbox>
        <InstallButton identifier={identifier} name={name} />
      </Flexbox>
      {stats.length > 0 && (
        <div className={stylex.props(styles.statsBar).className} style={{ width: '100%' }}>
          <div
            className={stylex.props(styles.statsGrid).className}
            style={{
              gridTemplateColumns: mobile ? undefined : `repeat(${stats.length}, minmax(0, 1fr))`,
            }}
          >
            {stats.map((stat, index) => (
              <StatBlock bordered={!mobile && index > 0} key={stat.statKey} {...stat} />
            ))}
          </div>
        </div>
      )}
    </Flexbox>
  );
});

export default Header;
