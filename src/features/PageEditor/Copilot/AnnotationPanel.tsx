'use client';

import {
  type AnnotationRecord,
  type AnnotationService,
  findNearestScrollContainer,
  getEditorDocumentY,
  getEditorViewportY,
  IAnnotationService,
  measureAnnotationAnchor,
} from '@lobehub/editor';
import { Empty, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { ChevronDownIcon, MessageSquareTextIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AnnotationComposer from '../AnnotationComposer';
import { usePageAnnotationComposer } from '../annotationComposerContext';
import { usePageAnnotationNavigation } from '../annotationNavigationContext';
import { usePageEditorStore } from '../store';
import { styles } from './annotationPanel.styles';
import {
  type AnnotationRailGroup,
  type AnnotationRailLayoutItem,
  type AnnotationRailMeasurement,
  type AnnotationScrollSource,
  beginAnnotationScrollSync,
  collectAnchoredAnnotationMeasurements,
  consumeAnnotationRailNavigation,
  DEFAULT_ANNOTATION_CARD_HEIGHT,
  DEFAULT_ANNOTATION_GAP,
  DEFAULT_ANNOTATION_GROUP_EPSILON,
  DEFAULT_COMPOSER_HEIGHT,
  findAnnotationGroupItem,
  finishAnnotationScrollSync,
  getAnnotationRailScrollTarget,
  groupAnnotationMeasurements,
  initialAnnotationRailNavigationState,
  initialAnnotationScrollGuardState,
  layoutAnnotationRailItems,
  prepareAnnotationRailNavigation,
  resolveAnnotationGroupExpansion,
  resolveComposerAnchorY,
  shouldAutoExpandGroup,
  shouldIgnoreAnnotationScroll,
} from './annotationRail';
import { usePageAnnotationStorageContext } from './annotationStorage';
import { focusAnnotation } from './focusAnnotation';

const COMPOSER_ID = '__annotation-composer__';

const getCommentText = (record: AnnotationRecord, fallback: string) => {
  const payload = record.payload as { text?: string } | string | null;
  if (typeof payload === 'string') return payload;
  return typeof payload?.text === 'string' ? payload.text : fallback;
};

interface RailSnapshot {
  height: number;
  items: AnnotationRailLayoutItem[];
}

const emptySnapshot: RailSnapshot = { height: 0, items: [] };

const AnnotationPanel = memo(() => {
  const { t } = useTranslation('editor');
  const editor = usePageEditorStore((s) => s.editor);
  const { composer } = usePageAnnotationComposer();
  const {
    request: annotationNavigationRequest,
    selectAnnotationIds,
    selectedAnnotationIds,
  } = usePageAnnotationNavigation();
  const annotationStorage = usePageAnnotationStorageContext();
  const [records, setRecords] = useState<AnnotationRecord[]>([]);
  const [manualGroupExpansion, setManualGroupExpansion] = useState<Record<string, boolean>>({});
  const [groupHeights, setGroupHeights] = useState<Record<string, number>>({});
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_HEIGHT);
  const [measureVersion, setMeasureVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<RailSnapshot>(emptySnapshot);

  const railRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Map<string, HTMLElement>>(null);
  if (!groupRefs.current) groupRefs.current = new Map();
  const composerRef = useRef<HTMLElement | null>(null);
  const scrollGuardRef = useRef(initialAnnotationScrollGuardState);
  const scrollGuardFrameRef = useRef<number | undefined>(undefined);
  const measureFrameRef = useRef<number | undefined>(undefined);
  const annotationNavigationStateRef = useRef(initialAnnotationRailNavigationState);

  const queueMeasure = useCallback(() => {
    if (typeof window === 'undefined') {
      setMeasureVersion((version) => version + 1);
      return;
    }

    if (measureFrameRef.current) window.cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = undefined;
      setMeasureVersion((version) => version + 1);
    });
  }, []);

  useEffect(() => {
    if (!editor) return;

    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const subscribe = () => {
      if (disposed) return;
      const service = editor.requireService(IAnnotationService) as AnnotationService | null;
      if (!service) {
        retryTimer = setTimeout(subscribe, 100);
        return;
      }
      unsubscribe = service.subscribe((nextRecords) => {
        setRecords(nextRecords.filter((record) => record.kind === 'comment'));
        queueMeasure();
      });
    };

    subscribe();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [editor, queueMeasure]);

  useEffect(() => {
    const root = editor?.getRootElement();
    const lexicalEditor = editor?.getLexicalEditor();
    if (!root) return;

    const onEditorUpdate = () => queueMeasure();
    const unregisterLexical = lexicalEditor?.registerUpdateListener(onEditorUpdate);
    editor?.on('documentChange', onEditorUpdate);
    window.addEventListener('resize', onEditorUpdate);

    return () => {
      unregisterLexical?.();
      editor?.off('documentChange', onEditorUpdate);
      window.removeEventListener('resize', onEditorUpdate);
    };
  }, [editor, queueMeasure]);

  useEffect(() => {
    const root = editor?.getRootElement();
    const rail = railRef.current;
    if (!root || !rail || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => queueMeasure());
    observer.observe(root);
    observer.observe(rail);
    const scrollContainer = findNearestScrollContainer(root);
    if (scrollContainer) observer.observe(scrollContainer);

    return () => observer.disconnect();
  }, [editor, queueMeasure]);

  useEffect(() => {
    const root = editor?.getRootElement();
    const mainScroll = root && findNearestScrollContainer(root);
    const rail = railRef.current;
    if (!mainScroll || !rail) return;

    const clearGuard = (token: number) => {
      if (typeof window === 'undefined') return;
      if (scrollGuardFrameRef.current) window.cancelAnimationFrame(scrollGuardFrameRef.current);
      scrollGuardFrameRef.current = window.requestAnimationFrame(() => {
        scrollGuardFrameRef.current = undefined;
        scrollGuardRef.current = finishAnnotationScrollSync(scrollGuardRef.current, token);
      });
    };

    const sync = (source: AnnotationScrollSource, target: HTMLElement, scrollTop: number) => {
      const targetSource: AnnotationScrollSource = source === 'editor' ? 'rail' : 'editor';
      scrollGuardRef.current = beginAnnotationScrollSync(scrollGuardRef.current, targetSource);
      const token = scrollGuardRef.current.token;
      target.scrollTop = Math.max(0, Math.min(scrollTop, getMaxScrollTop(target)));
      clearGuard(token);
    };

    const onMainScroll = () => {
      if (shouldIgnoreAnnotationScroll(scrollGuardRef.current, 'editor')) return;
      sync('editor', rail, mainScroll.scrollTop);
      queueMeasure();
    };
    const onRailScroll = () => {
      if (shouldIgnoreAnnotationScroll(scrollGuardRef.current, 'rail')) return;
      sync('rail', mainScroll, rail.scrollTop);
    };

    mainScroll.addEventListener('scroll', onMainScroll, { passive: true });
    rail.addEventListener('scroll', onRailScroll, { passive: true });
    sync('editor', rail, mainScroll.scrollTop);

    return () => {
      mainScroll.removeEventListener('scroll', onMainScroll);
      rail.removeEventListener('scroll', onRailScroll);
      if (scrollGuardFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(scrollGuardFrameRef.current);
        scrollGuardFrameRef.current = undefined;
      }
    };
  }, [editor, queueMeasure]);

  useLayoutEffect(() => {
    const root = editor?.getRootElement();
    const rail = railRef.current;
    if (!root || !rail) return;

    const mainScroll = findNearestScrollContainer(root);
    const lexicalEditor = editor?.getLexicalEditor();
    const rootRect = root.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const mainRect = mainScroll?.getBoundingClientRect();
    const rootOffset = mainRect ? rootRect.top - mainRect.top + (mainScroll?.scrollTop || 0) : 0;
    const canvasOrigin = rootOffset + (mainRect ? mainRect.top - railRect.top : 0);
    const rootHeight = Math.max(root.scrollHeight, root.offsetHeight, rootRect.height);
    const mainHeight = mainScroll
      ? Math.max(mainScroll.scrollHeight, mainScroll.offsetHeight, mainRect?.height || 0)
      : 0;
    const mainClientHeight = mainScroll?.clientHeight || mainRect?.height || 0;
    const mainMaxScrollTop = Math.max(mainHeight - mainClientHeight, 0);
    const documentHeight = Math.max(
      rail.clientHeight,
      rootHeight + canvasOrigin,
      mainHeight + (mainRect ? mainRect.top - railRect.top : 0),
      rail.clientHeight + mainMaxScrollTop,
    );
    const viewportY = getEditorViewportY(root, mainScroll);

    const measurements: AnnotationRailMeasurement[] = collectAnchoredAnnotationMeasurements(
      records,
      (record) => measureAnnotationAnchor(root, { id: record.id }, lexicalEditor),
      { anchorOffset: canvasOrigin, height: DEFAULT_ANNOTATION_CARD_HEIGHT },
    );

    const groups = groupAnnotationMeasurements(measurements, DEFAULT_ANNOTATION_GROUP_EPSILON);
    // Keep the auto decision on a stable estimate. Measured card heights are
    // fed into the final placement, but must not make ResizeObserver flip an
    // automatically expanded group back and forth.
    const getExpandedHeight = (group: AnnotationRailGroup) =>
      group.items.length > 1
        ? DEFAULT_ANNOTATION_CARD_HEIGHT + Math.min(group.items.length, 3) * 38
        : DEFAULT_ANNOTATION_CARD_HEIGHT;
    const collapsedItems: Array<Omit<AnnotationRailLayoutItem, 'y'> & { desiredY?: number }> =
      groups.map((group) => ({
        anchorY: group.anchorY,
        createdAt: group.createdAt,
        desiredY: group.anchorY,
        expanded: false,
        group,
        height: groupHeights[group.id] ?? DEFAULT_ANNOTATION_CARD_HEIGHT,
        id: group.id,
        kind: 'annotation',
      }));

    if (composer) {
      const composerMeasurement = measureAnnotationAnchor(
        root,
        { id: '', nodeKeys: composer.anchorNodeKeys ?? composer.nodeKeys },
        lexicalEditor,
      );
      const composerAnchor =
        canvasOrigin +
        resolveComposerAnchorY({
          nativeRectY: composer.rect ? getEditorDocumentY(root, composer.rect) : null,
          nodeAnchorY: composerMeasurement?.anchorY,
          viewportY,
        });
      collapsedItems.push({
        anchorY: composerAnchor,
        createdAt: '',
        desiredY: composerAnchor,
        height: composerHeight,
        id: COMPOSER_ID,
        kind: 'composer',
      });
    }

    const collapsedLayout = layoutAnnotationRailItems(collapsedItems, {
      documentHeight,
      gap: DEFAULT_ANNOTATION_GAP,
    });
    const autoExpandedGroupIds = new Set(
      groups.flatMap((group) => {
        const layoutIndex = collapsedLayout.items.findIndex((item) => item.id === group.id);
        if (layoutIndex < 0) return [];
        const item = collapsedLayout.items[layoutIndex];
        const nextItem = collapsedLayout.items[layoutIndex + 1];
        return shouldAutoExpandGroup({
          documentHeight: collapsedLayout.height,
          expandedHeight: getExpandedHeight(group),
          gap: DEFAULT_ANNOTATION_GAP,
          groupY: item.y,
          nextY: nextItem?.y,
        })
          ? [group.id]
          : [];
      }),
    );
    const desiredItems = collapsedItems.map((item) => {
      if (item.kind !== 'annotation' || !item.group) return item;
      const expanded = resolveAnnotationGroupExpansion(
        autoExpandedGroupIds.has(item.group.id),
        manualGroupExpansion[item.group.id],
      );
      return {
        ...item,
        expanded,
        height: expanded
          ? Math.max(getExpandedHeight(item.group), groupHeights[item.group.id] ?? 0)
          : (groupHeights[item.group.id] ?? DEFAULT_ANNOTATION_CARD_HEIGHT),
      };
    });
    const layout = layoutAnnotationRailItems(desiredItems, {
      documentHeight,
      gap: DEFAULT_ANNOTATION_GAP,
    });
    setSnapshot({ height: layout.height, items: layout.items });
  }, [
    composer,
    composerHeight,
    editor,
    groupHeights,
    manualGroupExpansion,
    measureVersion,
    records,
  ]);

  useLayoutEffect(() => {
    const request = annotationNavigationRequest;
    if (!request) return;

    const target = findAnnotationGroupItem(snapshot.items, request.annotationId);
    const preparation = prepareAnnotationRailNavigation(
      annotationNavigationStateRef.current,
      request,
      target,
    );
    annotationNavigationStateRef.current = preparation.state;
    if (preparation.selectedGroupId && target?.group) {
      selectAnnotationIds(getGroupAnnotationIds(target.group));
    }
    if (preparation.expandGroupId) {
      setManualGroupExpansion((current) =>
        current[preparation.expandGroupId!] === true
          ? current
          : { ...current, [preparation.expandGroupId!]: true },
      );
    }

    const pending = annotationNavigationStateRef.current.pending;
    const rail = railRef.current;
    if (
      !pending ||
      pending.groupId === null ||
      pending.token !== request.token ||
      !target ||
      !rail
    ) {
      return;
    }

    const element = groupRefs.current?.get(pending.groupId);
    const consumption = consumeAnnotationRailNavigation(
      annotationNavigationStateRef.current,
      request,
      target,
      Boolean(element),
    );
    if (!consumption.shouldScroll || !element) return;

    const targetScrollTop = getAnnotationRailScrollTarget({
      groupHeight: element?.getBoundingClientRect().height ?? target.height,
      groupY: target.y,
      maxScrollTop: getMaxScrollTop(rail),
      viewportHeight: rail.clientHeight,
    });
    annotationNavigationStateRef.current = consumption.state;
    if (Math.abs(rail.scrollTop - targetScrollTop) > 1) rail.scrollTop = targetScrollTop;
  }, [annotationNavigationRequest, selectAnnotationIds, snapshot.items]);

  useEffect(() => {
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            let changed = false;
            const nextHeights = { ...groupHeights };
            for (const entry of entries) {
              const key = entry.target.getAttribute('data-annotation-group-id');
              if (key) {
                const height = Math.ceil(entry.contentRect.height);
                if (Math.abs((nextHeights[key] ?? 0) - height) > 1) {
                  nextHeights[key] = height;
                  changed = true;
                }
              }
              if (entry.target.hasAttribute('data-annotation-composer-card')) {
                const height = Math.ceil(entry.contentRect.height);
                if (Math.abs(composerHeight - height) > 1) setComposerHeight(height);
              }
            }
            if (changed) setGroupHeights(nextHeights);
          });

    if (!observer) return;
    for (const element of groupRefs.current?.values() || []) observer.observe(element);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [composerHeight, groupHeights, snapshot.items]);

  useEffect(
    () => () => {
      if (measureFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(measureFrameRef.current);
      }
      if (scrollGuardFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(scrollGuardFrameRef.current);
      }
    },
    [],
  );

  const setGroupRef = useCallback(
    (id: string, element: HTMLElement | null) => {
      if (element) {
        groupRefs.current?.set(id, element);
        if (annotationNavigationStateRef.current.pending?.groupId === id) queueMeasure();
      } else groupRefs.current?.delete(id);
    },
    [queueMeasure],
  );

  const getGroup = (item: AnnotationRailLayoutItem): AnnotationRailGroup | null =>
    item.kind === 'annotation' ? item.group || null : null;
  const selectGroup = useCallback(
    (group: AnnotationRailGroup, focusId?: string) => {
      const ids = getGroupAnnotationIds(group);
      if (ids.length === 0) return;

      selectAnnotationIds(ids);
      const targetId = focusId ?? ids[0];
      if (editor && targetId) focusAnnotation(editor, targetId);
    },
    [editor, selectAnnotationIds],
  );

  return (
    <div data-annotation-rail-root className={styles.root}>
      {annotationStorage.error && (
        <div data-annotation-storage-error className={styles.error} role="alert">
          <Text className={styles.errorMessage} type="secondary">
            {t('annotation.storageError', { defaultValue: 'Comments could not be loaded.' })}
          </Text>
          <Button
            className={styles.errorRetry}
            size="small"
            type="text"
            onClick={() => void annotationStorage.retry()}
          >
            {t('annotation.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      )}
      <div
        data-annotation-rail
        aria-busy={annotationStorage.isLoading || undefined}
        className={styles.rail}
        ref={railRef}
      >
        <div
          data-annotation-rail-canvas
          className={styles.canvas}
          style={{ height: Math.max(snapshot.height, 1) }}
        >
          {annotationStorage.isLoading && records.length === 0 && !composer && (
            <div
              data-annotation-storage-loading
              aria-live="polite"
              className={cx(styles.absoluteCard, styles.loadingCard)}
              role="status"
              style={{ top: 16 }}
            >
              <div className={styles.loadingContent}>
                <Icon icon={MessageSquareTextIcon} size={15} />
                <Text type="secondary">
                  {t('annotation.loading', { defaultValue: 'Loading comments…' })}
                </Text>
              </div>
            </div>
          )}
          {snapshot.items.map((item) => {
            const group = getGroup(item);
            if (item.kind === 'composer') {
              return composer ? (
                <div
                  data-annotation-composer-card
                  className={cx(styles.absoluteCard, styles.composerCard)}
                  key={item.id}
                  style={{ top: item.y }}
                  ref={(element) => {
                    composerRef.current = element;
                  }}
                >
                  <AnnotationComposer {...composer} />
                </div>
              ) : null;
            }
            if (!group) return null;
            const expanded = item.expanded ?? false;
            const first = group.items[0]?.record;
            const isGroupSelected = group.items.some((measurement) =>
              selectedAnnotationIds.includes(measurement.id),
            );
            return (
              <div
                className={cx(styles.absoluteCard, styles.card)}
                data-annotation-group-id={group.id}
                data-annotation-selected={isGroupSelected ? 'true' : undefined}
                key={item.id}
                ref={(element) => setGroupRef(group.id, element)}
                style={{ top: item.y }}
              >
                <button
                  aria-expanded={expanded}
                  className={styles.cardHeader}
                  type="button"
                  onClick={() => {
                    selectGroup(group);
                    setManualGroupExpansion((current) => ({
                      ...current,
                      [group.id]: !expanded,
                    }));
                  }}
                >
                  <span className={styles.cardHeaderMain}>
                    <MessageSquareTextIcon
                      aria-hidden="true"
                      className={styles.cardIcon}
                      size={15}
                    />
                    <span className={styles.cardLabel}>{t('annotation.title')}</span>
                    <span className={styles.cardCount}>{group.items.length}</span>
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cx(styles.cardChevron, expanded && styles.cardChevronExpanded)}
                    size={15}
                  />
                </button>
                {!expanded && first && (
                  <CommentPreview
                    fallback={t('annotation.invalidPayload')}
                    noQuote={t('annotation.noQuote')}
                    record={first}
                    onClick={() => selectGroup(group, first.id)}
                  />
                )}
                {expanded &&
                  group.items.map((measurement) =>
                    measurement.record ? (
                      <CommentPreview
                        fallback={t('annotation.invalidPayload')}
                        key={measurement.id}
                        noQuote={t('annotation.noQuote')}
                        record={measurement.record}
                        onClick={() => selectGroup(group, measurement.id)}
                      />
                    ) : null,
                  )}
              </div>
            );
          })}
          {!annotationStorage.isLoading &&
            !snapshot.items.some((item) => item.kind === 'annotation') &&
            !composer && (
              <div
                data-annotation-empty
                className={cx(styles.absoluteCard, styles.emptyCard)}
                style={{ top: 16 }}
              >
                <Empty description={t('annotation.empty')} icon={MessageSquareTextIcon} />
              </div>
            )}
        </div>
      </div>
    </div>
  );
});

AnnotationPanel.displayName = 'AnnotationPanel';

const CommentPreview = ({
  fallback,
  noQuote,
  onClick,
  record,
}: {
  fallback: string;
  noQuote: string;
  onClick: () => void;
  record: AnnotationRecord;
}) => (
  <button
    aria-label={getCommentText(record, fallback) || fallback}
    className={styles.commentButton}
    type="button"
    onClick={onClick}
  >
    <Text
      strong
      as="span"
      className={styles.commentText}
      ellipsis={{ tooltip: getCommentText(record, fallback) || fallback }}
    >
      {getCommentText(record, fallback) || fallback}
    </Text>
    <Text
      as="span"
      className={styles.commentQuote}
      ellipsis={{ rows: 2, tooltip: record.quotedText || noQuote }}
      type="secondary"
    >
      {record.quotedText || noQuote}
    </Text>
  </button>
);

export default AnnotationPanel;

const getGroupAnnotationIds = (group: AnnotationRailGroup): string[] => [
  ...new Set(group.items.map((measurement) => measurement.id).filter(Boolean)),
];

function getMaxScrollTop(element: HTMLElement): number {
  return Math.max(element.scrollHeight - element.clientHeight, 0);
}
