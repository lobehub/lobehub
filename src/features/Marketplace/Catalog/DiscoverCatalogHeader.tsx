'use client';

import { Button, Flexbox, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useDebounceFn } from 'ahooks';
import { ChevronLeft, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router';

import { CustomConnectorModal } from '@/features/Connectors';
import { openSkillImportModal } from '@/features/SkillStore/SkillImportModal';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { usePermission } from '@/hooks/usePermission';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { isMobileSurface } from '@/utils/mobileSurface';

import type { CatalogKind } from '../CatalogViewTabs';
import { catalogSearchParams } from './sections';

const styles = stylex.create({
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    display: 'inline-flex',
    gap: 4,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    paddingBlockStart: 24,
  },
  headerMobile: { paddingBlockStart: 4 },
  search: { flexGrow: '1', flexShrink: '1', flexBasis: '160px', minWidth: 0 },
  title: {
    color: cssVar.colorText,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    lineHeight: 1.3,
    marginBlock: 0,
  },
});

const ConnectorAddAction = () => {
  const { t } = useTranslation('setting');
  const { t: td } = useTranslation('discover');
  const [open, setOpen] = useState(false);
  const { canManage, isPending } = useConnectorManageable();

  return (
    <>
      <Tooltip
        title={!canManage && !isPending ? t('tools.connectorFeedback.manageOnly') : undefined}
      >
        <Button
          disabled={!canManage || isPending}
          icon={Plus}
          type={'primary'}
          onClick={() => setOpen(true)}
        >
          {td('apps.addMcp')}
        </Button>
      </Tooltip>
      {open && <CustomConnectorModal open onClose={() => setOpen(false)} />}
    </>
  );
};

const SkillImportAction = () => {
  const { t } = useTranslation('setting');
  const { allowed: canCreate } = usePermission('create_content');

  return (
    <Button disabled={!canCreate} icon={Plus} type={'primary'} onClick={openSkillImportModal}>
      {t('agentSkillModal.title')}
    </Button>
  );
};

interface DiscoverCatalogHeaderProps {
  group?: { backTo: string; title: string };
  kind: Exclude<CatalogKind, 'connector'> | 'agent' | 'app';
  sortControl?: ReactNode;
  titleExtra?: ReactNode;
}

const DiscoverCatalogHeader = ({
  group,
  kind,
  sortControl,
  titleExtra,
}: DiscoverCatalogHeaderProps) => {
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const location = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const groupTitle = group?.title;
  const view = useRef(groupTitle);
  useEffect(() => {
    if (view.current === groupTitle) return;
    view.current = groupTitle;
    document.getElementById(SCROLL_PARENT_ID)?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [groupTitle]);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [draft, setDraft] = useState({ locationKey: location.key, value: query });
  if (draft.locationKey !== location.key) {
    setDraft({
      locationKey: location.key,
      value: draft.value.trim() === query ? draft.value : query,
    });
  }
  const isMcp = kind === 'mcp';
  const isApp = kind === 'app';
  const isAgent = kind === 'agent';

  const search = (keyword: string) => {
    if (keyword.trim() === query) return;
    setParams(catalogSearchParams(params, keyword), { replace: true });
  };
  const { cancel, run } = useDebounceFn(search, { wait: 250 });

  useEffect(() => cancel, [cancel, location.key]);

  const title = isAgent
    ? t('tab.assistant')
    : isApp
      ? t('tab.apps')
      : isMcp
        ? t('tab.mcp')
        : ts('skillView.skills');
  const description = isAgent
    ? t('catalog.agentDescription')
    : isApp
      ? t('apps.description')
      : isMcp
        ? t('apps.mcpDescription')
        : ts('skillView.skillsDesc');
  const searchLabel = group
    ? t('catalog.searchIn', { name: group.title })
    : isAgent
      ? t('catalog.searchAgents')
      : isApp || isMcp
        ? t('catalog.searchIn', { name: title })
        : ts('skillView.search.placeholder');

  return (
    <header {...stylex.props(styles.header, isMobileSurface() && styles.headerMobile)}>
      <Flexbox gap={4}>
        {group && (
          <WorkspaceLink replace to={group.backTo} {...stylex.props(styles.back)}>
            <ChevronLeft aria-hidden size={16} />
            {title}
          </WorkspaceLink>
        )}
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
          <h1 ref={headingRef} tabIndex={-1} {...stylex.props(styles.title)}>
            {groupTitle ?? title}
          </h1>
          {titleExtra}
        </Flexbox>
        {!group && <Text type={'secondary'}>{description}</Text>}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8} style={{ flexWrap: 'wrap' }}>
        <SearchBar
          allowClear
          aria-label={searchLabel}
          className={stylex.props(styles.search).className}
          data-testid={'search-bar'}
          placeholder={searchLabel}
          value={draft.value}
          variant={'filled'}
          onInputChange={(value) => {
            setDraft({ locationKey: location.key, value });
            if (value.trim()) run(value);
            else {
              cancel();
              search('');
            }
          }}
          onSearch={(value) => {
            cancel();
            search(value);
          }}
        />
        {group || isAgent || isApp ? (
          sortControl
        ) : isMcp ? (
          <ConnectorAddAction />
        ) : (
          <SkillImportAction />
        )}
      </Flexbox>
    </header>
  );
};

export default DiscoverCatalogHeader;
