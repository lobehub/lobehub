'use client';

import { Empty, Flexbox, Icon, Image } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import { FileText, Film, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import { useAcceptanceScope } from './AcceptanceScope';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const styles = createStaticStyles(({ css }) => ({
  /**
   * Masonry by explicit column assignment, not CSS `column-count`.
   *
   * The native version balances columns ONCE, during layout — and evidence
   * images arrive after it, so every tile had already piled into the first
   * column and stayed there. Reserving each tile's aspect ratio did not help:
   * the balancing pass happens before the ratios matter. Dealing the tiles out
   * ourselves is deterministic and independent of when the bytes land.
   */
  column: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;

    min-inline-size: 0;
  `,
  grid: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;
  `,
  item: css`
    cursor: pointer;

    overflow: hidden;

    inline-size: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  meta: css`
    padding-block: 8px;
    padding-inline: 10px;
  `,
  nonVisual: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 18px;
    padding-inline: 12px;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

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
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  if (!data) return null;

  const seen = new Set<string>();
  const items = data.checks
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
    <div className={styles.grid}>
      {columns.map((column, columnIndex) => (
        <div className={styles.column} key={columnIndex}>
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
                className={styles.item}
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
                  <div className={styles.nonVisual}>
                    <Icon
                      icon={evidence.type === 'video' ? Film : FileText}
                      size={16}
                      style={{ color: cssVar.colorTextTertiary }}
                    />
                    <Text ellipsis fontSize={13}>
                      {name}
                    </Text>
                  </div>
                )}
                <Flexbox className={styles.meta} gap={2}>
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
