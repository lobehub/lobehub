import { ActionIcon, Button, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import type { ComponentProps, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { AcceptancePlanReview } from '../Plan/AcceptancePlanReview';
import type { walkNeighbors } from './flowStoryboard';

interface FlowToolbarProps {
  activeKey: string | undefined;
  crumbs: { id: string; title: string }[];
  fullscreen: boolean;
  fullscreenButtonRef: Ref<HTMLButtonElement>;
  keys: string[];
  onDisplayChange: (display: 'graph' | 'outline') => void;
  onFocus: (id: string | undefined) => void;
  onRoundChange: (key: string) => void;
  onSelect: (id: string) => void;
  onToggleFullscreen: () => void;
  runId: ComponentProps<typeof AcceptancePlanReview>['runId'];
  showOutline: boolean;
  stepCount: number;
  walk: ReturnType<typeof walkNeighbors>;
}

export const FlowToolbar = ({
  activeKey,
  crumbs,
  fullscreen,
  fullscreenButtonRef,
  keys,
  onDisplayChange,
  onFocus,
  onRoundChange,
  onSelect,
  onToggleFullscreen,
  runId,
  showOutline,
  stepCount,
  walk,
}: FlowToolbarProps) => {
  const { t } = useTranslation('verify');

  return (
    <>
      <Flexbox horizontal align="center" gap={4}>
        <Button size="small" type="text" onClick={() => onFocus(undefined)}>
          {t('flow.allGroups')}
        </Button>
        {crumbs.map((crumb) => (
          <Flexbox horizontal align="center" gap={4} key={crumb.id}>
            <Text type="secondary">/</Text>
            <Button size="small" type="text" onClick={() => onFocus(crumb.id)}>
              {crumb.title}
            </Button>
          </Flexbox>
        ))}
      </Flexbox>
      <Flexbox horizontal align="center" gap={8} wrap="wrap">
        <AcceptancePlanReview runId={runId} />
        {!showOutline && stepCount > 1 && (
          <>
            {walk.previous && (
              <Button
                aria-label={t('flow.walk.previous', { title: walk.previous.title })}
                icon={<Icon icon={ChevronLeft} />}
                size="small"
                style={{ maxWidth: 200 }}
                onClick={() => onSelect(walk.previous!.id)}
              >
                {walk.previous.title}
              </Button>
            )}
            {walk.next && (
              <Button
                size="small"
                style={{ maxWidth: 240 }}
                onClick={() => onSelect(walk.next!.id)}
              >
                {t(walk.position ? 'flow.walk.next' : 'flow.walk.start', {
                  title: walk.next.title,
                })}
                <Icon icon={ChevronRight} />
              </Button>
            )}
          </>
        )}
        <Flexbox horizontal gap={2} role="group">
          <Button
            aria-pressed={showOutline}
            size="small"
            type={showOutline ? 'fill' : 'text'}
            onClick={() => onDisplayChange('outline')}
          >
            {t('flow.outlineView')}
          </Button>
          <Button
            aria-pressed={!showOutline}
            size="small"
            type={showOutline ? 'text' : 'fill'}
            onClick={() => onDisplayChange('graph')}
          >
            {t('flow.graphView')}
          </Button>
        </Flexbox>
        <Select
          size="small"
          style={{ width: 120, flexShrink: 0 }}
          value={activeKey}
          options={keys.map((key) => ({
            value: key,
            label:
              key === 'pending'
                ? t('flow.pendingPlan')
                : t('acceptance.round', { round: Number(key) }),
          }))}
          onChange={onRoundChange}
        />
        <ActionIcon
          aria-label={t(fullscreen ? 'flow.exitFullscreen' : 'flow.fullscreen')}
          icon={fullscreen ? Minimize2 : Maximize2}
          ref={fullscreenButtonRef}
          title={t(fullscreen ? 'flow.exitFullscreen' : 'flow.fullscreen')}
          onClick={onToggleFullscreen}
        />
      </Flexbox>
    </>
  );
};
