import type {
  OverlayCaptureUploadStatus,
  ScreenCaptureAgentOption,
  ScreenCaptureModelOption,
  ScreenCaptureOverlayTheme,
} from '@lobechat/electron-client-ipc';
import { ModelIcon } from '@lobehub/icons';
import { AlertCircleIcon, ChevronDownIcon, Loader2Icon, XIcon } from 'lucide-react';
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import OverlayAvatar from './Avatar';
import * as styles from './chatPanel.css.ts';
import { cn } from './cn';
import { OVERLAY_COPY, OVERLAY_LAYOUT, OVERLAY_SHORTCUTS } from './constants';
import {
  createDockedPanelPlacement,
  createInitialPanelPlacement,
  type PanelPlacement,
  resolvePanelPlacement,
} from './panelPlacement';
import { computeDockPosition, connectorPoint, type DockResult, type Rect } from './useDockPosition';

export interface ChatPanelSelection {
  captureId: string;
  dataUrl: string;
  label: string;
  rect: Rect;
  uploadStatus: OverlayCaptureUploadStatus;
}

export interface ChatPanelSubmitPayload {
  agentId?: string;
  captureIds: string[];
  modelId?: string;
  prompt: string;
  provider?: string;
}

export interface ChatPanelProps {
  agentId?: string;
  agents?: ScreenCaptureAgentOption[];
  hidden?: boolean;
  modelId?: string;
  models?: ScreenCaptureModelOption[];
  onRemoveSelection: (selectionId: string) => void;
  onSubmit: (payload: ChatPanelSubmitPayload) => void;
  placementResetKey?: number;
  selections: ChatPanelSelection[];
  theme?: ScreenCaptureOverlayTheme;
  viewportHeight: number;
  viewportWidth: number;
}

const formatBytes = (rect: Rect): string =>
  `${Math.round(rect.width)} × ${Math.round(rect.height)} · ${OVERLAY_COPY.selectionFormatLabel}`;

const SendIcon = () => (
  <svg
    aria-hidden="true"
    fill="currentColor"
    fillRule="evenodd"
    focusable="false"
    height={14}
    style={{ flex: 'none', lineHeight: 1 }}
    viewBox="0 0 14 14"
    width={14}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M.743 3.773c-.818-.555-.422-1.834.567-1.828l11.496.074a1 1 0 01.837 1.538l-6.189 9.689c-.532.833-1.822.47-1.842-.518L5.525 8.51a1 1 0 01.522-.9l1.263-.686a.808.808 0 00-.772-1.42l-1.263.686a1 1 0 01-1.039-.051L.743 3.773z" />
  </svg>
);

const UploadStatusIndicator = ({
  iconSize = 16,
  status,
}: {
  iconSize?: number;
  status: OverlayCaptureUploadStatus;
}) => {
  if (status === 'uploading') {
    return (
      <div
        aria-label={OVERLAY_COPY.uploadingLabel}
        className={cn(styles.uploadOverlay, styles.uploadOverlayUploading)}
      >
        <Loader2Icon className={styles.uploadSpinnerIcon} size={iconSize} strokeWidth={2.2} />
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div
        aria-label={OVERLAY_COPY.uploadFailedLabel}
        className={cn(styles.uploadOverlay, styles.uploadOverlayFailed)}
      >
        <AlertCircleIcon size={iconSize} strokeWidth={2.2} />
      </div>
    );
  }
  return null;
};

const ChatPanel = memo<ChatPanelProps>(
  ({
    agentId: initialAgentId,
    agents,
    hidden = false,
    modelId: initialModelId,
    models,
    onRemoveSelection,
    onSubmit,
    placementResetKey = 0,
    selections,
    theme,
    viewportHeight,
    viewportWidth,
  }) => {
    const [prompt, setPrompt] = useState('');
    const [agentId, setAgentId] = useState<string | undefined>(initialAgentId);
    const [modelId, setModelId] = useState<string | undefined>(initialModelId);
    const lastSelectionPlacementRef = useRef<PanelPlacement | null>(null);
    const lastPlacementResetKeyRef = useRef(placementResetKey);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const selectionCount = selections.length;
    const activeSelection = selectionCount > 0 ? selections[selectionCount - 1]! : null;
    const selected = selectionCount > 0;

    const currentAgent = useMemo(
      () => agents?.find((item) => item.id === agentId),
      [agents, agentId],
    );
    const currentModel = useMemo(
      () => models?.find((item) => item.id === modelId),
      [models, modelId],
    );

    useEffect(() => {
      if (!initialAgentId) return;
      setAgentId(initialAgentId);
    }, [initialAgentId]);

    useEffect(() => {
      if (!initialModelId) return;
      setModelId(initialModelId);
    }, [initialModelId]);

    useEffect(() => {
      if (!agents?.length) return;
      if (agentId && agents.some((item) => item.id === agentId)) return;

      const nextAgentId =
        (initialAgentId && agents.some((item) => item.id === initialAgentId)
          ? initialAgentId
          : undefined) ?? agents[0]?.id;

      if (nextAgentId !== agentId) {
        setAgentId(nextAgentId);
      }
    }, [agents, agentId, initialAgentId]);

    useEffect(() => {
      if (!models?.length) return;
      if (modelId && models.some((item) => item.id === modelId)) return;

      const nextModelId =
        (initialModelId && models.some((item) => item.id === initialModelId)
          ? initialModelId
          : undefined) ?? models[0]?.id;

      if (nextModelId !== modelId) {
        setModelId(nextModelId);
      }
    }, [initialModelId, modelId, models]);

    const initialPlacement = useMemo(
      () => createInitialPanelPlacement(viewportWidth, viewportHeight),
      [viewportWidth, viewportHeight],
    );
    const dockPanelHeight =
      selectionCount > 1
        ? OVERLAY_LAYOUT.panelHeightEstimateExpanded
        : OVERLAY_LAYOUT.panelHeightEstimate;

    const dock: DockResult | null = useMemo(() => {
      if (!activeSelection) return null;
      return computeDockPosition({
        gap: OVERLAY_LAYOUT.dockGap,
        panelHeight: dockPanelHeight,
        panelWidth: OVERLAY_LAYOUT.panelWidthDocked,
        rect: activeSelection.rect,
        viewportHeight,
        viewportWidth,
      });
    }, [activeSelection, dockPanelHeight, viewportWidth, viewportHeight]);

    const dockedPlacement: PanelPlacement | null = dock ? createDockedPanelPlacement(dock) : null;

    useEffect(() => {
      if (dockedPlacement) {
        lastSelectionPlacementRef.current = dockedPlacement;
      }
    }, [dockedPlacement]);

    if (lastPlacementResetKeyRef.current !== placementResetKey) {
      lastSelectionPlacementRef.current = null;
      lastPlacementResetKeyRef.current = placementResetKey;
    }

    const placement = resolvePanelPlacement({
      dockedPlacement,
      initialPlacement,
      lastSelectionPlacement: lastSelectionPlacementRef.current,
    });

    const connector = useMemo(() => {
      if (!activeSelection || !dock || dock.side === 'edge') return null;
      const pt = connectorPoint(activeSelection.rect, dock.side);
      return {
        left: pt.x - OVERLAY_LAYOUT.connectorSize / 2,
        top: pt.y - OVERLAY_LAYOUT.connectorSize / 2,
      };
    }, [activeSelection, dock]);

    const themeStyle = useMemo<CSSProperties | undefined>(() => {
      if (!theme) return undefined;

      return {
        '--lobe-overlay-bg-elevated': theme.colorBgElevated,
        '--lobe-overlay-border-secondary': theme.colorBorderSecondary,
        '--lobe-overlay-fill': theme.colorFill,
        '--lobe-overlay-fill-quaternary': theme.colorFillQuaternary,
        '--lobe-overlay-fill-secondary': theme.colorFillSecondary,
        '--lobe-overlay-fill-tertiary': theme.colorFillTertiary,
        '--lobe-overlay-panel-border': theme.panelBorder,
        '--lobe-overlay-primary': theme.colorPrimary,
        '--lobe-overlay-primary-active': theme.colorPrimaryActive,
        '--lobe-overlay-primary-hover': theme.colorPrimaryHover,
        '--lobe-overlay-shadow': theme.panelShadow,
        '--lobe-overlay-text': theme.colorText,
        '--lobe-overlay-text-light-solid': theme.colorTextLightSolid,
        '--lobe-overlay-text-quaternary': theme.colorTextQuaternary,
        '--lobe-overlay-text-secondary': theme.colorTextSecondary,
        '--lobe-overlay-text-tertiary': theme.colorTextTertiary,
      } as CSSProperties;
    }, [theme]);

    useLayoutEffect(() => {
      if (selected && !hidden && textareaRef.current) {
        textareaRef.current.focus();
      }
    }, [hidden, selected]);

    useEffect(() => {
      if (!selected) setPrompt('');
    }, [selected]);

    const allUploadsReady = useMemo(
      () => selections.every((item) => item.uploadStatus === 'ready'),
      [selections],
    );
    const hasUploading = useMemo(
      () => selections.some((item) => item.uploadStatus === 'uploading'),
      [selections],
    );
    const hasFailed = useMemo(
      () => selections.some((item) => item.uploadStatus === 'failed'),
      [selections],
    );

    const submit = useCallback(() => {
      if (selections.length === 0 || !prompt.trim() || !allUploadsReady) return;
      onSubmit({
        agentId,
        captureIds: selections.map((item) => item.captureId),
        modelId,
        prompt: prompt.trim(),
        provider: currentModel?.provider,
      });
    }, [selections, prompt, agentId, modelId, currentModel, onSubmit, allUploadsReady]);

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      },
      [submit],
    );

    const canSend = selected && prompt.trim().length > 0 && allUploadsReady;

    const handleAgentChange = useCallback((e: ReactChangeEvent<HTMLSelectElement>) => {
      setAgentId(e.target.value || undefined);
    }, []);

    const handleModelChange = useCallback((e: ReactChangeEvent<HTMLSelectElement>) => {
      setModelId(e.target.value || undefined);
    }, []);

    const hasAgents = !!agents && agents.length > 0;
    const hasModels = !!models && models.length > 0;

    return (
      <>
        {connector && (
          <div
            style={{ ...themeStyle, left: connector.left, top: connector.top }}
            className={cn(
              styles.connector,
              selected && styles.connectorVisible,
              hidden && styles.connectorHidden,
            )}
          />
        )}
        <div
          aria-hidden={hidden}
          className={cn(
            styles.panel,
            !selected && styles.initialEnter,
            hidden && styles.panelHidden,
          )}
          style={{
            ...themeStyle,
            cursor: 'default',
            left: placement.left,
            top: placement.top,
            width: placement.width,
          }}
          onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}
          onMouseMove={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}
          onMouseUp={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}
        >
          {selectionCount === 1 && activeSelection && (
            <div className={styles.selectionSummary}>
              <div
                aria-label="screenshot thumbnail"
                className={styles.thumb}
                style={{ backgroundImage: `url(${activeSelection.dataUrl})` }}
              >
                <UploadStatusIndicator iconSize={16} status={activeSelection.uploadStatus} />
              </div>
              <div className={styles.summaryText}>
                <div className={styles.summaryTitle}>
                  {OVERLAY_COPY.screenshotLabel} · {activeSelection.label}
                </div>
                <div className={styles.summaryMeta}>{formatBytes(activeSelection.rect)}</div>
              </div>
              <button
                aria-label={OVERLAY_COPY.removeSelectionLabel}
                className={styles.iconBtn}
                type="button"
                onClick={() => onRemoveSelection(activeSelection.captureId)}
              >
                <XIcon size={14} strokeWidth={2} />
              </button>
            </div>
          )}

          {selectionCount > 1 && activeSelection && (
            <div className={styles.multiSelectionSummary}>
              <div className={styles.multiSelectionHeader}>
                <div className={styles.multiSelectionTitle}>
                  {selectionCount} {OVERLAY_COPY.screenshotsLabel}
                </div>
                <div className={styles.multiSelectionMeta}>
                  {OVERLAY_COPY.latestSelectionLabel} · {activeSelection.label}
                </div>
              </div>

              <div className={styles.multiSelectionRail}>
                {selections.map((item) => {
                  const isActive = item.captureId === activeSelection.captureId;

                  return (
                    <div
                      key={item.captureId}
                      className={cn(
                        styles.multiSelectionItem,
                        isActive && styles.multiSelectionItemActive,
                      )}
                    >
                      <div className={styles.multiSelectionThumbFrame}>
                        <div
                          aria-label="screenshot thumbnail"
                          className={styles.multiSelectionThumb}
                          style={{ backgroundImage: `url(${item.dataUrl})` }}
                        />
                        <UploadStatusIndicator iconSize={18} status={item.uploadStatus} />
                        <button
                          aria-label={OVERLAY_COPY.removeSelectionLabel}
                          className={styles.multiSelectionRemoveBtn}
                          type="button"
                          onClick={() => onRemoveSelection(item.captureId)}
                        >
                          <XIcon size={12} strokeWidth={2} />
                        </button>
                      </div>
                      <div className={styles.multiSelectionItemLabel}>{item.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.inputRow}>
            <textarea
              className={styles.textarea}
              ref={textareaRef}
              rows={2}
              spellCheck={false}
              value={prompt}
              placeholder={
                selected
                  ? selectionCount > 1
                    ? OVERLAY_COPY.multipleSelectedPlaceholder
                    : OVERLAY_COPY.selectedPlaceholder
                  : OVERLAY_COPY.idlePlaceholder
              }
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className={styles.actionBar}>
            <div className={styles.actionBarLeft}>
              <label
                aria-label={OVERLAY_COPY.agentSelectLabel}
                className={cn(styles.selectChip, !hasAgents && styles.selectChipDisabled)}
              >
                <OverlayAvatar
                  avatar={currentAgent?.avatar}
                  background={currentAgent?.backgroundColor}
                  size={18}
                  title={currentAgent?.title}
                />
                <span className={styles.chipLabel}>
                  {currentAgent?.title ?? OVERLAY_COPY.agentSelectPlaceholder}
                </span>
                <ChevronDownIcon className={styles.chevron} size={12} strokeWidth={2} />
                <select
                  aria-label={OVERLAY_COPY.agentSelectLabel}
                  className={styles.nativeSelect}
                  disabled={!hasAgents}
                  value={agentId ?? ''}
                  onChange={handleAgentChange}
                >
                  {!hasAgents && <option value="">{OVERLAY_COPY.agentSelectPlaceholder}</option>}
                  {agents?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.avatar && typeof item.avatar === 'string' && item.avatar.length <= 4
                        ? `${item.avatar} ${item.title}`
                        : item.title}
                    </option>
                  ))}
                </select>
              </label>

              <label
                aria-label={OVERLAY_COPY.modelSelectLabel}
                className={cn(styles.selectChip, !hasModels && styles.selectChipDisabled)}
              >
                {currentModel ? (
                  <span className={styles.modelIconBox}>
                    <ModelIcon model={currentModel.id} size={16} />
                  </span>
                ) : (
                  <span className={styles.modelIconBoxFallback} />
                )}
                <span className={styles.chipLabel}>
                  {currentModel?.displayName ??
                    currentModel?.id ??
                    OVERLAY_COPY.modelSelectPlaceholder}
                </span>
                <ChevronDownIcon className={styles.chevron} size={12} strokeWidth={2} />
                <select
                  aria-label={OVERLAY_COPY.modelSelectLabel}
                  className={styles.nativeSelect}
                  disabled={!hasModels}
                  value={modelId ?? ''}
                  onChange={handleModelChange}
                >
                  {!hasModels && <option value="">{OVERLAY_COPY.modelSelectPlaceholder}</option>}
                  {models?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName ?? item.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.actionBarRight}>
              <button
                aria-label={OVERLAY_COPY.sendAriaLabel}
                className={styles.sendBtn}
                disabled={!canSend}
                type="button"
                title={
                  hasUploading
                    ? OVERLAY_COPY.uploadingLabel
                    : hasFailed
                      ? OVERLAY_COPY.uploadFailedLabel
                      : `${OVERLAY_COPY.sendAriaLabel} · ${OVERLAY_SHORTCUTS.send}\n${OVERLAY_COPY.newlineHint} · ${OVERLAY_SHORTCUTS.newline}\n${OVERLAY_COPY.closeLabel} · ${OVERLAY_SHORTCUTS.close}`
                }
                onClick={submit}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </>
    );
  },
);

ChatPanel.displayName = 'ChatPanel';

export default ChatPanel;
