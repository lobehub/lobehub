import type { HeteroSessionDirGroup, HeteroSessionDirPref } from '@lobechat/types';
import { ClaudeCode, Codex } from '@lobehub/icons';
import {
  ActionIcon,
  DraggablePanel,
  Flexbox,
  Icon,
  ScrollShadow,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight, Eye, EyeOff, Folder, FolderGit2, Timer, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { baseName, dirKeyOf } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  child: css`
    cursor: pointer;

    height: 32px;
    padding-block: 0;
    padding-inline: 28px 8px;
    border-radius: ${cssVar.borderRadius};

    .tree-actions {
      display: none;
      flex: none;
      gap: 2px;
      align-items: center;
    }

    &:hover {
      background: ${cssVar.colorFillTertiary};

      .tree-actions {
        display: flex;
      }

      .tree-count {
        display: none;
      }
    }
  `,
  childActive: css`
    background: ${cssVar.colorFillSecondary} !important;
  `,
  parent: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  sidebar: css`
    width: 100%;
    height: 100%;
    padding-block: 12px;
    padding-inline: 8px;
  `,
}));

const BRAND = { 'claude-code': ClaudeCode, 'codex': Codex } as const;
const AGENT_LABEL = { 'claude-code': 'Claude Code', 'codex': 'Codex' } as const;
const SOURCES = ['claude-code', 'codex'] as const;

export type TreeScope = string; // 'all' | source | `${source}::${dir}`

interface SidebarTreeProps {
  groups: HeteroSessionDirGroup[];
  onScopeChange: (scope: TreeScope) => void;
  onSetPref: (key: string, pref: HeteroSessionDirPref | null) => void;
  scope: TreeScope;
}

const SidebarTree = memo<SidebarTreeProps>(({ groups, scope, onScopeChange, onSetPref }) => {
  const { t } = useTranslation('topic');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showIgnored, setShowIgnored] = useState(false);

  const watched = groups.filter((g) => g.dirPref === 'watched');
  const ignored = groups.filter((g) => g.dirPref === 'ignored');
  const totalCount = groups
    .filter((g) => g.dirPref !== 'ignored')
    .reduce((sum, g) => sum + g.sessionCount, 0);

  const renderDirRow = (group: HeteroSessionDirGroup, leading: React.ReactNode) => {
    const key = dirKeyOf(group.source, group.workingDirectory);
    const isWatched = group.dirPref === 'watched';
    return (
      <Tooltip key={key} placement="right" title={group.workingDirectory}>
        <Flexbox
          horizontal
          align="center"
          className={cx(styles.child, scope === key && styles.childActive)}
          gap={8}
          justify="space-between"
          onClick={() => onScopeChange(key)}
        >
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
            {leading}
            <Text ellipsis fontSize={13}>
              {baseName(group.workingDirectory)}
            </Text>
          </Flexbox>
          <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
            {isWatched ? (
              <Tooltip title={t('heteroImport.action.unwatch')}>
                <ActionIcon icon={X} size="small" onClick={() => onSetPref(key, null)} />
              </Tooltip>
            ) : (
              <>
                <Tooltip title={t('heteroImport.action.watch')}>
                  <ActionIcon icon={Timer} size="small" onClick={() => onSetPref(key, 'watched')} />
                </Tooltip>
                <Tooltip title={t('heteroImport.action.ignore')}>
                  <ActionIcon
                    icon={EyeOff}
                    size="small"
                    onClick={() => {
                      onSetPref(key, 'ignored');
                      if (scope === key) onScopeChange(group.source);
                    }}
                  />
                </Tooltip>
              </>
            )}
          </span>
          <Text className="tree-count" fontSize={12} type="secondary">
            {group.sessionCount}
          </Text>
        </Flexbox>
      </Tooltip>
    );
  };

  return (
    <DraggablePanel
      defaultSize={{ width: 232 }}
      expandable={false}
      maxWidth={420}
      minWidth={180}
      placement="left"
    >
      <ScrollShadow className={styles.sidebar}>
        <Flexbox
          horizontal
          align="center"
          className={cx(styles.parent, scope === 'all' && styles.childActive)}
          justify="space-between"
          onClick={() => onScopeChange('all')}
        >
          <Text fontSize={13} weight={scope === 'all' ? 600 : 400}>
            {t('heteroImport.allSessions')}
          </Text>
          <Text fontSize={12} type="secondary">
            {totalCount.toLocaleString()}
          </Text>
        </Flexbox>

        {watched.length > 0 && (
          <Flexbox style={{ marginBottom: 4 }}>
            <Flexbox
              horizontal
              align="center"
              className={styles.parent}
              gap={4}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has('watched')) next.delete('watched');
                  else next.add('watched');
                  return next;
                })
              }
            >
              <Icon
                icon={ChevronRight}
                size={13}
                style={{
                  transform: collapsed.has('watched') ? 'none' : 'rotate(90deg)',
                  transition: 'transform .15s',
                }}
              />
              <Icon icon={Timer} size={13} style={{ opacity: 0.55 }} />
              <Text fontSize={13} style={{ flex: 1 }} weight={500}>
                {t('heteroImport.watchedGroup')}
              </Text>
              <Text fontSize={12} type="secondary">
                {watched.length}
              </Text>
            </Flexbox>
            {!collapsed.has('watched') &&
              watched.map((group) => {
                const Brand = BRAND[group.source];
                return renderDirRow(group, <Brand size={12} style={{ flex: 'none' }} />);
              })}
          </Flexbox>
        )}

        {SOURCES.map((source) => {
          const dirs = groups.filter((g) => g.source === source && !g.dirPref);
          if (dirs.length === 0) return null;
          const open = !collapsed.has(source);
          const count = dirs.reduce((sum, g) => sum + g.sessionCount, 0);
          const Brand = BRAND[source];
          return (
            <Flexbox key={source}>
              <Flexbox
                horizontal
                align="center"
                className={cx(styles.parent, scope === source && styles.childActive)}
                gap={4}
                onClick={() => onScopeChange(source)}
              >
                <Icon
                  icon={ChevronRight}
                  size={13}
                  style={{
                    transform: open ? 'rotate(90deg)' : 'none',
                    transition: 'transform .15s',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(source)) next.delete(source);
                      else next.add(source);
                      return next;
                    });
                  }}
                />
                <Brand size={15} />
                <Text fontSize={13} style={{ flex: 1 }} weight={scope === source ? 600 : 500}>
                  {AGENT_LABEL[source]}
                </Text>
                <Text fontSize={12} type="secondary">
                  {count}
                </Text>
              </Flexbox>
              {open &&
                dirs.map((group) =>
                  renderDirRow(
                    group,
                    <Icon
                      icon={group.isGit ? FolderGit2 : Folder}
                      size={13}
                      style={{ flex: 'none', opacity: 0.55 }}
                    />,
                  ),
                )}
            </Flexbox>
          );
        })}

        {ignored.length > 0 && (
          <Flexbox style={{ marginTop: 8 }}>
            <Flexbox
              horizontal
              align="center"
              className={styles.parent}
              gap={4}
              onClick={() => setShowIgnored((v) => !v)}
            >
              <Icon
                icon={ChevronRight}
                size={13}
                style={{
                  transform: showIgnored ? 'rotate(90deg)' : 'none',
                  transition: 'transform .15s',
                }}
              />
              <Text fontSize={12} type="secondary">
                {t('heteroImport.ignoredGroup', { count: ignored.length })}
              </Text>
            </Flexbox>
            {showIgnored &&
              ignored.map((group) => {
                const key = dirKeyOf(group.source, group.workingDirectory);
                const Brand = BRAND[group.source];
                return (
                  <Tooltip key={key} placement="right" title={group.workingDirectory}>
                    <Flexbox
                      horizontal
                      align="center"
                      className={styles.child}
                      gap={8}
                      justify="space-between"
                      style={{ opacity: 0.55 }}
                    >
                      <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                        <Brand size={12} style={{ flex: 'none' }} />
                        <Text ellipsis fontSize={13}>
                          {baseName(group.workingDirectory)}
                        </Text>
                      </Flexbox>
                      <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title={t('heteroImport.action.restore')}>
                          <ActionIcon
                            icon={Eye}
                            size="small"
                            onClick={() => onSetPref(key, null)}
                          />
                        </Tooltip>
                      </span>
                    </Flexbox>
                  </Tooltip>
                );
              })}
          </Flexbox>
        )}
      </ScrollShadow>
    </DraggablePanel>
  );
});

export default SidebarTree;
