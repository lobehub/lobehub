'use client';

import { ActionIcon, Button, createStaticStyles, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ArrowLeft, ChevronLeft } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, builtinToolSelectors } from '@/store/tool/selectors';
import { isMobileSurface } from '@/utils/mobileSurface';

import LeftPanel from './features/LeftPanel';
import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import { type SkillViewMode } from './features/SkillList';
import {
  encodeMobileSelection,
  isStackedLayout,
  MOBILE_SELECTION_PARAM,
  parseMobileSelection,
} from './mobileSelection';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const styles = createStaticStyles(({ css }) => ({
  detail: css`
    overflow-y: auto;
    flex: 1;
  `,
  page: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    justify-content: center;

    height: 100%;
  `,
  pageBody: css`
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 960px;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    height: 100%;
  `,
}));

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
  const stacked = isStackedLayout(mobile, viewMode);
  const [searchParams, setSearchParams] = useSearchParams();
  const querySkillIdentifier = searchParams.get('skill');
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const stackedSelected = stacked
    ? parseMobileSelection(searchParams.get(MOBILE_SELECTION_PARAM))
    : undefined;

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

  const builtinTools = useToolStore((s) => s.builtinTools, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const installedBuiltinIds = useToolStore(
    (s) => builtinToolSelectors.installedAllMetaList(s).map((tool) => tool.identifier),
    isEqual,
  );

  useEffect(() => {
    // A stacked page shows one pane at a time and opens on the list, so nothing
    // is pre-selected there.
    if (stacked) return;
    if (selected) return;
    if (viewMode === 'skill' && querySkillIdentifier) return;
    if (viewMode === 'connector') {
      const firstTool = builtinTools.find(
        (tool) => !tool.hidden && installedBuiltinIds.includes(tool.identifier),
      );
      if (firstTool) {
        setSelected({ identifier: firstTool.identifier, type: 'builtin' });
      }
    } else {
      const firstSkill = builtinSkills[0];
      if (firstSkill) {
        setSelected({ identifier: firstSkill.identifier, type: 'builtin-skill' });
      }
    }
  }, [
    builtinTools,
    builtinSkills,
    installedBuiltinIds,
    querySkillIdentifier,
    selected,
    stacked,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== 'skill' || !querySkillIdentifier) return;

    const skill = [...marketAgentSkills, ...userAgentSkills].find(
      (item) => item.identifier === querySkillIdentifier,
    );
    if (!skill) return;
    // Mobile turns the deep link into the detail entry once (dropping `skill`),
    // so a later store refresh cannot reopen a detail the user closed.
    if (stacked) openStackedDetail({ identifier: skill.id, type: 'agent-skill' }, true);
    else setSelected({ identifier: skill.id, type: 'agent-skill' });
  }, [
    marketAgentSkills,
    openStackedDetail,
    querySkillIdentifier,
    stacked,
    userAgentSkills,
    viewMode,
  ]);

  const handleSelect = (identifier: string, type: ToolDetailType) => {
    if (stacked) openStackedDetail({ identifier, type });
    else setSelected({ identifier, type });
  };

  // Mobile: the settings layout owns the header; list and detail take turns
  // full-width instead of a 300px list squeezing the detail.
  if (mobile)
    return stackedSelected ? (
      <Flexbox className={styles.detail}>
        <Flexbox horizontal align={'center'} paddingBlock={4} paddingInline={8}>
          <ActionIcon icon={ChevronLeft} title={t('back')} onClick={closeStackedDetail} />
        </Flexbox>
        <SkillDetail
          identifier={stackedSelected.identifier}
          type={stackedSelected.type}
          onDelete={closeStackedDetail}
        />
      </Flexbox>
    ) : (
      <div className={styles.root}>
        <LeftPanel
          fullWidth
          viewMode={viewMode}
          onDeleteSelected={closeStackedDetail}
          onSelect={handleSelect}
        />
      </div>
    );

  // Desktop connectors: a full-width list; a row opens its detail as a second
  // level page whose back link names the list it returns to.
  if (stacked)
    return (
      <>
        <NavHeader />
        <div className={styles.page}>
          <div className={styles.pageBody}>
            {stackedSelected ? (
              <>
                <Flexbox horizontal align={'center'} paddingBlock={12} paddingInline={4}>
                  <Button icon={ArrowLeft} type={'text'} onClick={closeStackedDetail}>
                    {t('skillView.connectors', { ns: 'setting' })}
                  </Button>
                </Flexbox>
                <SkillDetail
                  identifier={stackedSelected.identifier}
                  type={stackedSelected.type}
                  onDelete={closeStackedDetail}
                />
              </>
            ) : (
              <LeftPanel
                fullWidth
                page
                viewMode={viewMode}
                onDeleteSelected={closeStackedDetail}
                onSelect={handleSelect}
              />
            )}
          </div>
        </div>
      </>
    );

  return (
    <>
      <NavHeader />
      <div className={styles.root}>
        <LeftPanel
          selectedIdentifier={selected?.identifier}
          viewMode={viewMode}
          onDeleteSelected={() => setSelected(null)}
          onSelect={handleSelect}
        />

        {selected && (
          <div className={styles.detail}>
            <SkillDetail
              identifier={selected.identifier}
              type={selected.type}
              onDelete={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </>
  );
});

ToolSettings.displayName = 'ToolSettings';

const Page = () => <ToolSettings viewMode="skill" />;

export default Page;
