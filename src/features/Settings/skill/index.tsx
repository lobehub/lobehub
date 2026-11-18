'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronLeft } from 'lucide-react';
import { Activity, memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { isMobileSurface } from '@/utils/mobileSurface';

import DetailBreadcrumb from './features/DetailBreadcrumb';
import LeftPanel from './features/LeftPanel';
import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import { type SkillViewMode } from './features/SkillList';
import {
  encodeMobileSelection,
  MOBILE_SELECTION_PARAM,
  parseMobileSelection,
} from './mobileSelection';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const styles = stylex.create({
  detail: { overflowY: 'auto', flex: '1' },
  page: {
    overflowY: 'auto',
    display: 'flex',
    flex: '1',
    alignItems: 'flex-start',
    justifyContent: 'center',
    height: '100%',
    paddingInline: '12px',
  },
  /**
   * The connector list insets its rows and intro 12px, so the body is 12px wider
   * than the shared 1024px settings column on each side: text then lines up with
   * every other settings tab, and the bottom space matches their 128px. The body
   * grows with its content (the page aligns it to the top instead of stretching it
   * to the scroll box), otherwise the list overflows it and the bottom padding is lost.
   */
  pageBody: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: '1048px',
    minHeight: '100%',
    paddingBlockEnd: '104px',
  },
  resourceDetailPage: { height: '100%', minHeight: 0, paddingBlockEnd: '24px' },
});

interface ToolSettingsProps {
  /**
   * Which surface to manage. Fixed per-route now that skills and connectors
   * each own a dedicated settings page (`/settings/skill` and
   * `/settings/connector`) instead of sharing one tab-switched page.
   */
  viewMode: SkillViewMode;
}

const PUSHED_DETAIL_STATE = 'skillDetailPushed';

export const ToolSettings = memo<ToolSettingsProps>(({ viewMode }) => {
  const { t } = useTranslation(['common', 'setting']);
  const mobile = isMobileSurface();
  const [searchParams, setSearchParams] = useSearchParams();
  const querySkillIdentifier = searchParams.get('skill');
  const stackedSelected = parseMobileSelection(searchParams.get(MOBILE_SELECTION_PARAM));

  // Stacked: opening a detail is a history entry, so back returns to the list.
  const openStackedDetail = useCallback(
    (next: SelectedTool, replace = false) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set(MOBILE_SELECTION_PARAM, encodeMobileSelection(next));
          params.delete('skill');
          return params;
        },
        // A pushed detail remembers it, so closing it can step back to the list.
        { replace, state: replace ? undefined : { [PUSHED_DETAIL_STATE]: true } },
      ),
    [setSearchParams],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const closeStackedDetail = () => {
    // Pop the entry this page pushed, so history keeps one list entry; a
    // deep-linked detail has none to pop and is replaced by the list instead.
    if ((location.state as Record<string, unknown> | null)?.[PUSHED_DETAIL_STATE]) {
      navigate(-1);
      return;
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete(MOBILE_SELECTION_PARAM);
        return params;
      },
      { replace: true },
    );
  };

  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  useEffect(() => {
    if (viewMode !== 'skill' || !querySkillIdentifier) return;

    const skill = [...marketAgentSkills, ...userAgentSkills].find(
      (item) => item.identifier === querySkillIdentifier,
    );
    if (!skill) return;
    // Turn the deep link into the detail entry once (dropping `skill`),
    // so a later store refresh cannot reopen a detail the user closed.
    openStackedDetail({ identifier: skill.id, type: 'agent-skill' }, true);
  }, [marketAgentSkills, openStackedDetail, querySkillIdentifier, userAgentSkills, viewMode]);

  const handleSelect = (identifier: string, type: ToolDetailType) => {
    openStackedDetail({ identifier, type });
  };

  // Keep the list mounted across detail navigation, preserving search and expanded groups.
  const list = (
    <Activity mode={stackedSelected ? 'hidden' : 'visible'}>
      <LeftPanel
        fullWidth
        page={!mobile || viewMode === 'skill'}
        viewMode={viewMode}
        onDeleteSelected={closeStackedDetail}
        onSelect={handleSelect}
      />
    </Activity>
  );

  // Mobile: the settings layout owns the header; list and detail take turns
  // full-width instead of a 300px list squeezing the detail.
  if (mobile)
    return (
      <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
        {list}
        {stackedSelected && (
          <Flexbox className={stylex.props(styles.detail).className}>
            <Flexbox horizontal align={'center'} paddingBlock={4} paddingInline={8}>
              <ActionIcon icon={ChevronLeft} title={t('back')} onClick={closeStackedDetail} />
            </Flexbox>
            <SkillDetail
              identifier={stackedSelected.identifier}
              type={stackedSelected.type}
              onDelete={closeStackedDetail}
            />
          </Flexbox>
        )}
      </Flexbox>
    );

  // A full-width list; a row opens its detail as a second
  // level page whose back link names the list it returns to.
  return (
    <>
      {/* The page itself carries the title (list) or the breadcrumb (detail). */}
      <NavHeader />
      <div {...stylex.props(styles.page)}>
        <div
          {...stylex.props(
            styles.pageBody,
            stackedSelected?.type === 'agent-skill' && styles.resourceDetailPage,
          )}
        >
          {list}
          {stackedSelected && (
            <>
              <DetailBreadcrumb
                identifier={stackedSelected.identifier}
                type={stackedSelected.type}
                listLabel={t(viewMode === 'skill' ? 'skillView.skills' : 'skillView.connectors', {
                  ns: 'setting',
                })}
                onBack={closeStackedDetail}
              />
              <Flexbox flex={1} style={{ minHeight: 0 }}>
                <SkillDetail
                  identifier={stackedSelected.identifier}
                  type={stackedSelected.type}
                  onDelete={closeStackedDetail}
                />
              </Flexbox>
            </>
          )}
        </div>
      </div>
    </>
  );
});

ToolSettings.displayName = 'ToolSettings';

const Page = () => <ToolSettings viewMode="skill" />;

export default Page;
