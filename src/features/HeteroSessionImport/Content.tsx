'use client';

import type {
  HeteroSessionDigest,
  HeteroSessionDirGroup,
  HeteroSessionDirPref,
  HeteroSessionImportStatus,
} from '@lobechat/types';
import { Flexbox, Icon, NeuralNetworkLoading, ScrollShadow, SearchBar, Text } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { Checkbox, Progress } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Check, FolderSearch, TriangleAlert, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronHeteroSessionService } from '@/services/electron/heteroSession';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';

import { SessionRow } from './SessionList';
import SidebarTree, { type TreeScope } from './SidebarTree';
import { deriveSessionStatus, dirKeyOf, fmtTokens, type ImportRowState, selectable } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const CONTENT_HEIGHT = 'min(680px, calc(100vh - 240px))';

type Phase = 'done' | 'empty' | 'error' | 'importing' | 'scanning' | 'select';

interface ContentProps {
  agentId: string;
}

const Content = memo<ContentProps>(({ agentId }) => {
  const { t } = useTranslation(['topic', 'common']);
  const { close } = useModalContext();
  const refreshTopic = useChatStore((s) => s.refreshTopic);

  const [phase, setPhase] = useState<Phase>('scanning');
  const [groups, setGroups] = useState<HeteroSessionDirGroup[]>([]);
  const [status, setStatus] = useState<HeteroSessionImportStatus>();
  const [scope, setScope] = useState<TreeScope>('all');
  const [keyword, setKeyword] = useState('');
  const [hideImported, setHideImported] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<Record<string, ImportRowState>>({});
  const abortedRef = useRef(false);

  const scan = useCallback(async () => {
    setPhase('scanning');
    setSelected(new Set());
    setProgress({});
    try {
      const result = await electronHeteroSessionService.listLocalSessions();
      if (result.groups.length === 0) {
        setGroups([]);
        setPhase('empty');
        return;
      }
      const importStatus = await topicService.getHeteroSessionImportStatus();
      setGroups(result.groups);
      setStatus(importStatus);
      setPhase('select');
    } catch (e) {
      // a failed scan is NOT an empty machine — say so, or the user reads a
      // broken request as "you have no sessions". The raw reason is a
      // developer string (parse errors, stack noise), so keep it in the console
      // and show the actionable copy instead.
      console.error('[HeteroSessionImport] scan failed', e);
      setGroups([]);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    scan();
    return () => {
      abortedRef.current = true;
    };
  }, [scan]);

  const setPref = useCallback(async (key: string, pref: HeteroSessionDirPref | null) => {
    setGroups((prev) =>
      prev.map((g) =>
        dirKeyOf(g.source, g.workingDirectory) === key ? { ...g, dirPref: pref ?? undefined } : g,
      ),
    );
    await electronHeteroSessionService.setDirPref({ key, pref });
  }, []);

  // ---------- derived list ----------

  const allSessions = useMemo(() => {
    const items: { digest: HeteroSessionDigest; group: HeteroSessionDirGroup }[] = [];
    for (const group of groups) for (const digest of group.sessions) items.push({ digest, group });
    return items;
  }, [groups]);

  const statusOf = useCallback(
    (digest: HeteroSessionDigest) => deriveSessionStatus(digest, status),
    [status],
  );

  const kw = keyword.trim().toLowerCase();
  const visible = allSessions.filter(({ digest, group }) => {
    if (group.dirPref === 'ignored') return false;
    if (scope !== 'all') {
      if (scope.includes('::')) {
        if (dirKeyOf(group.source, group.workingDirectory) !== scope) return false;
      } else if (group.source !== scope) return false;
    }
    const sessionStatus = statusOf(digest);
    if (hideImported && !selectable(sessionStatus)) return false;
    if (kw && !(digest.title ?? digest.firstPrompt ?? '').toLowerCase().includes(kw)) return false;
    return true;
  });

  const importing = phase === 'importing' || phase === 'done';
  const rows = importing
    ? allSessions.filter(({ digest }) => selected.has(digest.sessionId))
    : visible;

  const selectedItems = allSessions.filter(({ digest }) => selected.has(digest.sessionId));
  const estMessages = selectedItems.reduce((sum, { digest }) => sum + digest.messageCount, 0);
  const estTokens = selectedItems.reduce((sum, { digest }) => sum + (digest.tokens ?? 0), 0);

  const visibleSelectable = visible.filter(({ digest }) => selectable(statusOf(digest)));
  const allChecked =
    visibleSelectable.length > 0 &&
    visibleSelectable.every(({ digest }) => selected.has(digest.sessionId));
  const someChecked = visibleSelectable.some(({ digest }) => selected.has(digest.sessionId));

  const toggle = useCallback((sessionId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const { digest } of visibleSelectable) {
        if (checked) next.add(digest.sessionId);
        else next.delete(digest.sessionId);
      }
      return next;
    });
  };

  // ---------- import flow ----------

  const importOne = useCallback(
    async (digest: HeteroSessionDigest): Promise<ImportRowState> => {
      const payload = await electronHeteroSessionService.readLocalSession({
        filePath: digest.filePath,
        source: digest.source,
      });
      if (!payload) return { ok: false };
      const [result] = await topicService.importHeteroSessions({
        agentId,
        sessions: [payload],
      });
      return { inserted: result?.insertedMessages ?? 0, ok: true };
    },
    [agentId],
  );

  const runImport = useCallback(async () => {
    setPhase('importing');
    const items = allSessions.filter(({ digest }) => selected.has(digest.sessionId));
    setProgress(Object.fromEntries(items.map(({ digest }) => [digest.sessionId, 'pending'])));

    for (const { digest } of items) {
      if (abortedRef.current) return;
      setProgress((prev) => ({ ...prev, [digest.sessionId]: 'running' }));
      let state: ImportRowState;
      try {
        state = await importOne(digest);
      } catch {
        state = { ok: false };
      }
      setProgress((prev) => ({ ...prev, [digest.sessionId]: state }));
    }
    setPhase('done');
    refreshTopic();
  }, [allSessions, importOne, refreshTopic, selected]);

  const retry = useCallback(
    async (sessionId: string) => {
      const item = allSessions.find(({ digest }) => digest.sessionId === sessionId);
      if (!item) return;
      setProgress((prev) => ({ ...prev, [sessionId]: 'running' }));
      let state: ImportRowState;
      try {
        state = await importOne(item.digest);
      } catch {
        state = { ok: false };
      }
      setProgress((prev) => ({ ...prev, [sessionId]: state }));
      // mirror runImport: a successful retry also created a topic, so refresh
      // the sidebar/topic cache or it stays hidden until an unrelated reload
      if (typeof state === 'object' && state.ok) refreshTopic();
    },
    [allSessions, importOne, refreshTopic],
  );

  // the currently importing row scrolls into view
  useEffect(() => {
    if (phase !== 'importing') return;
    const runningId = Object.entries(progress).find(([, v]) => v === 'running')?.[0];
    if (!runningId) return;
    document
      .querySelector(`[data-session-row="${CSS.escape(runningId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [progress, phase]);

  // ---------- stats ----------

  const doneStates = Object.values(progress).filter((v) => typeof v === 'object');
  const doneStats = {
    failed: doneStates.filter((v) => !v.ok).length,
    inserted: doneStates.reduce((sum, v) => sum + (v.ok ? v.inserted : 0), 0),
    ok: doneStates.filter((v) => v.ok).length,
  };
  const pct = selectedItems.length
    ? Math.round((doneStates.length / selectedItems.length) * 100)
    : 0;

  // ---------- render ----------

  if (phase === 'scanning')
    return (
      <Flexbox align="center" gap={16} justify="center" style={{ height: CONTENT_HEIGHT }}>
        <NeuralNetworkLoading size={48} />
        <Text type="secondary">{t('heteroImport.scanning')}</Text>
      </Flexbox>
    );

  if (phase === 'empty')
    return (
      <Flexbox align="center" gap={12} justify="center" style={{ height: CONTENT_HEIGHT }}>
        <Icon icon={FolderSearch} size={40} style={{ opacity: 0.4 }} />
        <Text weight={500}>{t('heteroImport.empty.title')}</Text>
        <Text fontSize={13} style={{ maxWidth: 380, textAlign: 'center' }} type="secondary">
          {t('heteroImport.empty.desc')}
        </Text>
        <Button size="small" onClick={scan}>
          {t('heteroImport.footer.rescan')}
        </Button>
      </Flexbox>
    );

  if (phase === 'error')
    return (
      <Flexbox align="center" gap={12} justify="center" style={{ height: CONTENT_HEIGHT }}>
        <Icon icon={TriangleAlert} size={40} style={{ opacity: 0.5 }} />
        <Text weight={500}>{t('heteroImport.error.title')}</Text>
        <Text fontSize={13} style={{ maxWidth: 380, textAlign: 'center' }} type="secondary">
          {t('heteroImport.error.desc')}
        </Text>
        <Button size="small" onClick={scan}>
          {t('heteroImport.footer.rescan')}
        </Button>
      </Flexbox>
    );

  return (
    <Flexbox>
      <Flexbox horizontal style={{ height: CONTENT_HEIGHT }}>
        {!importing && (
          <SidebarTree groups={groups} scope={scope} onScopeChange={setScope} onSetPref={setPref} />
        )}
        <Flexbox style={{ flex: 1, minWidth: 0 }}>
          {!importing && (
            <Flexbox gap={8} style={{ padding: '0 16px 10px' }}>
              <SearchBar
                placeholder={t('heteroImport.searchPlaceholder')}
                value={keyword}
                variant="filled"
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Flexbox horizontal align="center" justify="space-between">
                <Checkbox
                  checked={allChecked}
                  indeterminate={!allChecked && someChecked}
                  onChange={(e) => toggleAll(e.target.checked)}
                >
                  <Text fontSize={13} type="secondary">
                    {t('heteroImport.selectAll')}
                  </Text>
                </Checkbox>
                <Checkbox
                  checked={hideImported}
                  onChange={(e) => setHideImported(e.target.checked)}
                >
                  <Text fontSize={13} type="secondary">
                    {t('heteroImport.hideImported')}
                  </Text>
                </Checkbox>
              </Flexbox>
            </Flexbox>
          )}
          <ScrollShadow style={{ flex: 1, padding: '0 8px 8px' }}>
            {rows.map(({ digest }) => (
              <SessionRow
                checked={selected.has(digest.sessionId)}
                importState={progress[digest.sessionId]}
                importing={importing}
                item={{ digest, status: statusOf(digest) }}
                key={`${digest.source}-${digest.sessionId}`}
                showDir={!scope.includes('::')}
                showRetry={phase === 'done'}
                onRetry={retry}
                onToggle={toggle}
              />
            ))}
            {rows.length === 0 && (
              <Flexbox align="center" paddingBlock={48}>
                <Text type="secondary">{t('heteroImport.searchEmpty')}</Text>
              </Flexbox>
            )}
          </ScrollShadow>
        </Flexbox>
      </Flexbox>

      {phase === 'select' && (
        <Flexbox horizontal align="center" className={styles.footer} justify="space-between">
          <Text fontSize={13} type="secondary">
            {selected.size > 0
              ? t('heteroImport.footer.selected', {
                  messages: estMessages.toLocaleString(),
                  sessions: selected.size,
                  tokens: fmtTokens(estTokens),
                })
              : t('heteroImport.footer.hint')}
          </Text>
          <Flexbox horizontal gap={8}>
            <Button onClick={scan}>{t('heteroImport.footer.rescan')}</Button>
            <Button disabled={selected.size === 0} type="primary" onClick={runImport}>
              {selected.size > 0
                ? t('heteroImport.footer.import', { count: selected.size })
                : t('heteroImport.footer.importEmpty')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      {phase === 'importing' && (
        <Flexbox className={styles.footer} gap={4} style={{ width: '100%' }}>
          <Flexbox horizontal align="center" justify="space-between">
            <Text fontSize={13} type="secondary">
              {t('heteroImport.progress', { done: doneStates.length, total: selectedItems.length })}
            </Text>
            <Text fontSize={13} type="secondary">
              {pct}%
            </Text>
          </Flexbox>
          <Progress percent={pct} showInfo={false} size="small" status="active" />
        </Flexbox>
      )}

      {phase === 'done' && (
        <Flexbox horizontal align="center" className={styles.footer} justify="space-between">
          <Flexbox horizontal align="center" gap={8}>
            <Icon
              icon={doneStats.failed ? X : Check}
              size={16}
              style={{
                color: doneStats.failed
                  ? 'var(--lobe-color-warning, #faad14)'
                  : 'var(--lobe-color-success, #52c41a)',
              }}
            />
            <Text fontSize={13}>
              {t('heteroImport.done.summary', {
                messages: doneStats.inserted.toLocaleString(),
                sessions: doneStats.ok,
              })}
              {doneStats.failed > 0 && t('heteroImport.done.failed', { count: doneStats.failed })}
            </Text>
          </Flexbox>
          <Button type="primary" onClick={close}>
            {t('heteroImport.done.cta')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Content;
