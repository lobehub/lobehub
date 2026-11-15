'use client';

import { Empty, Flexbox, Icon, Image, Text, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { FileText, Film, Paperclip, SquareTerminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import { useAcceptanceScope } from '../AcceptanceScope';
import { checksForTurn } from '../turnChecks';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';

const styles = stylex.create({
  column: { display: 'flex', flex: '1', flexDirection: 'column', gap: '12px', minInlineSize: '0' },
  grid: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  item: {
    cursor: 'pointer',
    overflow: 'hidden',
    inlineSize: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  meta: { paddingBlock: '8px', paddingInline: '10px' },
  nonVisual: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '18px',
    paddingInline: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

const isVisual = (type: string) => type === 'screenshot' || type === 'gif';

/**
 * Everything this acceptance produced, in one place.
 *
 * The artefacts exist already — every round attaches them to the check whose
 * verdict they back — but reaching one meant knowing which check owned it and
 * expanding that row. The same artefact is also what you want when you are NOT
 * auditing a verdict ("where is that screenshot"), so it earns an inventory of
 * its own. Deduped by file: a carried-forward check re-attaches the same
 * artefact to every round it survives.
 */
const AcceptanceResources = () => {
  const { t } = useTranslation('verify');
  const { lg = true, md = true } = useResponsive();
  const hydrated = useIsHydrated();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { turn } = useAcceptanceTurn(embedded);
  const { data } = useAcceptanceBundle(acceptanceId);
  if (!data) return null;

  const seen = new Set<string>();
  const items = checksForTurn(data, turn)
    .flatMap((check) =>
      (check.evidence ?? []).map((evidence) => ({ check: check.title, evidence })),
    )
    .filter(({ evidence }) => {
      const key = evidence.fileId ?? evidence.documentId ?? evidence.id;
      if (!key || seen.has(key)) return false;
      // Text captured inline is the check's own body, not a file someone can
      // open — listing it here would pad the inventory with dead tiles.
      if (!evidence.fileUrl && !evidence.documentId) return false;
      seen.add(key);
      return true;
    });

  if (items.length === 0)
    return (
      <Flexbox paddingBlock={32}>
        <Empty description={t('acceptance.resources.empty')} icon={Paperclip} />
      </Flexbox>
    );

  const columnCount = lg ? 3 : md ? 2 : 1;
  const columns: (typeof items)[] = Array.from({ length: columnCount }, () => []);
  items.forEach((entry, index) => columns[index % columnCount]!.push(entry));

  return (
    <div {...stylex.props(styles.grid)}>
      {columns.map((column, columnIndex) => (
        <div {...stylex.props(styles.column)} key={columnIndex}>
          {column.map(({ check, evidence }) => {
            const href = evidence.fileUrl ?? undefined;
            const name = evidence.fileName ?? evidence.description ?? check;
            const captured =
              hydrated && evidence.capturedAt
                ? dayjs(evidence.capturedAt).format('MM-DD HH:mm')
                : undefined;
            const visual = isVisual(evidence.type) && Boolean(evidence.fileUrl);

            return (
              <div
                {...stylex.props(styles.item)}
                key={evidence.id}
                onClick={href ? () => window.open(href, '_blank', 'noreferrer') : undefined}
              >
                {visual ? (
                  /* The ratio is reserved from the stored dimensions, not left to
                 the image's own load: CSS columns balance once, at layout, and
                 an image that arrives afterwards has already lost its place —
                 every tile piles into the first column. */
                  <div
                    style={{
                      aspectRatio:
                        evidence.fileWidth && evidence.fileHeight
                          ? `${evidence.fileWidth} / ${evidence.fileHeight}`
                          : '16 / 10',
                      background: cssVar.colorFillQuaternary,
                      width: '100%',
                    }}
                  >
                    <Image
                      alt={name}
                      preview={false}
                      src={evidence.fileUrl!}
                      style={{ height: '100%', objectFit: 'cover', width: '100%' }}
                    />
                  </div>
                ) : (
                  <div {...stylex.props(styles.nonVisual)}>
                    <Icon
                      size={16}
                      style={{ color: cssVar.colorTextTertiary }}
                      icon={
                        evidence.type === 'video'
                          ? Film
                          : evidence.type === 'terminal'
                            ? SquareTerminal
                            : FileText
                      }
                    />
                    <Text ellipsis fontSize={13}>
                      {name}
                    </Text>
                  </div>
                )}
                <Flexbox className={stylex.props(styles.meta).className} gap={2}>
                  <Text ellipsis fontSize={12}>
                    {name}
                  </Text>
                  <Text ellipsis fontSize={11} type={'secondary'}>
                    {[check, captured].filter(Boolean).join(' · ')}
                  </Text>
                </Flexbox>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default AcceptanceResources;
