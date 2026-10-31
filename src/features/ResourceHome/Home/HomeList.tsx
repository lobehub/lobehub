'use client';

import { Avatar, Empty, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { FileTextIcon, FolderOpenIcon, GlobeIcon, HardDriveIcon, UsersIcon } from 'lucide-react';
import {
  Fragment,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactNode,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import FileIcon from '@/components/FileIcon';
import LibIcon from '@/components/LibIcon';
import SkeletonBar from '@/components/Skeleton/Bar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useHomeStore } from '@/store/home';
import type { DocsHomeRow, DocsHomeTab } from '@/store/home/slices/recent/projection';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { isArtifactPage } from '../Layout/Body/PageSection/group';
import { docsFilePath, docsPagePath, DRIVE_PATH, LIBRARY_INDEX_PATH } from '../paths';

/** Title, location, owner, created, updated — the time columns stay fixed-width. */
const COLUMNS = 'minmax(0, 3fr) minmax(0, 1.4fr) minmax(0, 1.1fr) 132px 132px';
/** A phone keeps title and updated; five columns would wrap the headers letter by letter. */
const PHONE = '@media (width <= 767px)';
const PHONE_COLUMNS = 'minmax(0, 1fr) 96px';

const styles = stylex.create({
  cell: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /**
   * The Location cell's items carry 6px of inline padding for the hover fill;
   * pulling the cell back by the same amount keeps their text on the column.
   */
  location: {
    marginInlineStart: '-6px',
  },
  locationItem: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',

    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '6px',

    whiteSpace: 'nowrap',
  },
  locationLink: {
    cursor: 'pointer',
    borderWidth: 0,
    font: 'inherit',
    color: { 'default': 'inherit', ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
  },
  header: {
    display: 'grid',
    gridTemplateColumns: { default: COLUMNS, [PHONE]: PHONE_COLUMNS },
    gap: '16px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  // `contents` keeps the wrapped cell a direct grid item on wider screens.
  desktopOnly: {
    display: { default: 'contents', [PHONE]: 'none' },
  },
  meta: {
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
  },
  name: {
    fontSize: '14px',
    color: cssVar.colorText,
  },
  row: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: { default: COLUMNS, [PHONE]: PHONE_COLUMNS },
    gap: '16px',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: 0,
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
  },
  tab: {
    cursor: 'pointer',
    paddingBlock: '6px',
    paddingInline: 0,
    borderWidth: 0,
    borderBlockEndWidth: '2px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'transparent',
    fontSize: '14px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
  },
  tabActive: {
    borderBlockEndColor: cssVar.colorPrimary,
    fontWeight: 500,
    color: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary },
  },
});

const formatTime = (value: Date | string) => {
  const date = dayjs(value);
  if (date.isSame(dayjs(), 'day')) return date.format('HH:mm');
  return date.isSame(dayjs(), 'year') ? date.format('MM-DD HH:mm') : date.format('YYYY-MM-DD');
};

interface LocationProps {
  libraryNames: Map<string, string>;
  myId?: string;
  onNavigate: (path: string) => void;
  row: DocsHomeRow;
}

interface LocationItemProps {
  icon?: ReactNode;
  label: string;
  onNavigate?: (path: string) => void;
  path?: string;
}

/**
 * One place a row lives. With a `path` it is a button that opens that section
 * (without also opening the row) and fills on hover; without one it is plain.
 */
const LocationItem = memo<LocationItemProps>(({ icon, label, onNavigate, path }) => {
  const content = (
    <>
      {icon}
      <span {...stylex.props(styles.cell)}>{label}</span>
    </>
  );

  if (!path || !onNavigate) return <span {...stylex.props(styles.locationItem)}>{content}</span>;

  return (
    <button
      type={'button'}
      {...stylex.props(styles.locationItem, styles.locationLink)}
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onNavigate(path);
      }}
    >
      {content}
    </button>
  );
});

LocationItem.displayName = 'DocsHomeLocationItem';

/**
 * Where the row lives: its knowledge bases, else the drive (files) or a page
 * section. Knowledge bases and the drive open on click; My docs and Shared
 * are sidebar sections with no page of their own, so they stay plain text.
 */
const Location = memo<LocationProps>(({ libraryNames, myId, onNavigate, row }) => {
  const { t } = useTranslation('file');
  const libraries = row.knowledgeBaseIds.flatMap((id) => {
    const name = libraryNames.get(id);
    return name ? [{ id, name }] : [];
  });

  let items: ReactNode;
  if (row.knowledgeBaseIds.length > 0) {
    items =
      libraries.length > 0 ? (
        libraries.map((library, index) => (
          <Fragment key={library.id}>
            {index > 0 && <span>,</span>}
            <LocationItem
              icon={index === 0 ? <LibIcon size={14} /> : undefined}
              label={library.name}
              path={`${LIBRARY_INDEX_PATH}/${library.id}`}
              onNavigate={onNavigate}
            />
          </Fragment>
        ))
      ) : (
        <LocationItem icon={<LibIcon size={14} />} label={t('docs.section.library')} />
      );
  } else if (row.kind === 'file') {
    items = (
      <LocationItem
        icon={<Icon icon={HardDriveIcon} size={14} />}
        label={t('docs.section.drive')}
        path={DRIVE_PATH}
        onNavigate={onNavigate}
      />
    );
  } else {
    const shared = row.userId && myId && row.userId !== myId;
    items = (
      <LocationItem
        icon={<Icon icon={shared ? UsersIcon : FolderOpenIcon} size={14} />}
        label={shared ? t('docs.shared.title') : t('docs.myDocs.title')}
      />
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      {...stylex.props(styles.cell, styles.meta, styles.location)}
    >
      {items}
    </Flexbox>
  );
});

Location.displayName = 'DocsHomeLocation';

const TABS: DocsHomeTab[] = ['recent', 'mine', 'shared'];

interface HomeListProps {
  onTabChange: (tab: DocsHomeTab) => void;
  tab: DocsHomeTab;
}

/**
 * The Docs home list: pages and files together, newest update first, with
 * where each one lives and who owns it. Pages and files both open inside Docs
 * (`/resource/page/:id`, `/resource/file/:id`).
 */
const HomeList = memo<HomeListProps>(({ onTabChange, tab }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId();
  const myId = useUserStore(userProfileSelectors.userId);

  const { error, revalidate } = useHomeStore((s) => s.useFetchDocsHome)(tab);
  const rows = useHomeStore(homeRecentSelectors.docsHome(tab));

  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  useFetchKnowledgeBaseList();
  const libraries = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseList());
  const libraryNames = useMemo(
    () => new Map((libraries ?? []).map((library) => [library.id, library.name])),
    [libraries],
  );

  // "Shared with me" only means something inside a workspace.
  const tabs = workspaceId ? TABS : TABS.filter((key) => key !== 'shared');

  const open = (row: DocsHomeRow) =>
    navigate(row.kind === 'page' ? docsPagePath(row.id) : docsFilePath(row.id));

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal gap={24} role={'tablist'}>
        {tabs.map((key) => (
          <button
            aria-selected={tab === key}
            key={key}
            role={'tab'}
            type={'button'}
            {...stylex.props(styles.tab, tab === key && styles.tabActive)}
            onClick={() => onTabChange(key)}
          >
            {t(`docs.home.tabs.${key}`)}
          </button>
        ))}
      </Flexbox>

      <div>
        <div {...stylex.props(styles.header)}>
          <span>{t('docs.home.columns.title')}</span>
          <span {...stylex.props(styles.desktopOnly)}>
            <span>{t('docs.home.columns.location')}</span>
            <span>{t('docs.home.columns.owner')}</span>
            <span>{t('docs.home.columns.createdAt')}</span>
          </span>
          <span>{t('docs.home.columns.updatedAt')}</span>
        </div>
        <AsyncBoundary
          data={rows}
          error={error}
          errorVariant={'inline'}
          isEmpty={rows?.length === 0}
          isLoading={rows === undefined && !error}
          empty={
            <Empty
              description={t(`docs.home.empty.${tab}`)}
              icon={FileTextIcon}
              style={{ paddingBlock: 48 }}
            />
          }
          loading={
            <Flexbox gap={8} paddingBlock={12}>
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonBar height={36} key={index} />
              ))}
            </Flexbox>
          }
          onRetry={() => revalidate()}
        >
          {rows?.map((row) => (
            // A div, not a button: the location cell holds its own buttons.
            <div
              key={row.id}
              role={'button'}
              tabIndex={0}
              {...stylex.props(styles.row)}
              onClick={() => open(row)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                open(row);
              }}
            >
              <Flexbox horizontal align={'center'} gap={10} {...stylex.props(styles.cell)}>
                {row.kind === 'page' ? (
                  row.emoji ? (
                    <Avatar avatar={row.emoji} size={20} />
                  ) : (
                    <Icon icon={isArtifactPage(row) ? GlobeIcon : FileTextIcon} size={18} />
                  )
                ) : (
                  <FileIcon fileName={row.name} fileType={row.fileType} size={20} />
                )}
                <span {...stylex.props(styles.cell, styles.name)}>
                  {row.name || t('pageList.untitled')}
                </span>
              </Flexbox>
              <span {...stylex.props(styles.desktopOnly)}>
                <Location libraryNames={libraryNames} myId={myId} row={row} onNavigate={navigate} />
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={6}
                  {...stylex.props(styles.cell, styles.meta)}
                >
                  {row.owner && (
                    <>
                      <Avatar avatar={row.owner.avatar || row.owner.name} size={18} />
                      <span {...stylex.props(styles.cell)}>{row.owner.name}</span>
                    </>
                  )}
                </Flexbox>
                <span {...stylex.props(styles.meta)}>{formatTime(row.createdAt)}</span>
              </span>
              <span {...stylex.props(styles.meta)}>{formatTime(row.updatedAt)}</span>
            </div>
          ))}
        </AsyncBoundary>
      </div>
    </Flexbox>
  );
});

HomeList.displayName = 'DocsHomeList';

export default HomeList;
