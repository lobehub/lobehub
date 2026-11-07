import { Alert, Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ReviewView } from '../api';
import { CATEGORY_LABELS } from '../labels';
import { hrefOf } from '../route';
import { CATEGORY_TONES, Chip } from './Chip';
import { ReviewEvidence } from './ReviewEvidence';

const styles = stylex.create({
  title: {
    fontSize: cssVar.fontSizeHeading4,
    fontWeight: 600,
    lineHeight: cssVar.lineHeightHeading4,
    marginBlock: 0,
    overflowWrap: 'anywhere',
  },
});

export const ItemHeader = ({
  action,
  extra,
  item,
}: {
  action?: ReactNode;
  extra?: ReactNode;
  item: ReviewView;
}) => (
  <Flexbox gap={8}>
    <Flexbox horizontal align="center" gap={8} wrap="wrap">
      <h1 {...stylex.props(styles.title)}>{item.title}</h1>
      <Chip tone={CATEGORY_TONES[item.category] ?? 'plain'}>
        {CATEGORY_LABELS[item.category] ?? item.category}
      </Chip>
      {item.component && <Chip tone="info">{item.component}</Chip>}
      {extra}
      <Flexbox flex={1} />
      {action}
    </Flexbox>
    <Text code fontSize={12} type="secondary">
      {item.file}
    </Text>
  </Flexbox>
);

export const ReworkNote = ({ note }: { note: string }) => (
  <Alert description={note} title="你上次打回的原因" type="warning" variant="soft" />
);

export const ReviewItemView = ({
  conditions,
  item,
}: {
  conditions: string[];
  item: ReviewView;
}) => (
  <Flexbox gap={24}>
    <Flexbox gap={12}>
      <ItemHeader
        item={item}
        action={
          <Button
            href={hrefOf({ key: item.key, kind: 'case' })}
            icon={ExternalLink}
            size="small"
            type="text"
          >
            用例详情
          </Button>
        }
      />
      <Text fontSize={14}>{item.ask}</Text>
      {item.rework && <ReworkNote note={item.rework.note} />}
    </Flexbox>
    <ReviewEvidence conditions={conditions} item={item} />
  </Flexbox>
);
