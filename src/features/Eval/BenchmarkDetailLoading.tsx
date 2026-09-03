import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { Card } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    min-height: 66px;
  `,
  hero: css`
    min-height: 106px;
    padding: 20px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  runsSection: css`
    border-style: dashed;
    background: ${cssVar.colorFillQuaternary};
  `,
  section: css`
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    height: 287px;
    padding-block: 64px;
    padding-inline: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: center;
  `,
  sectionTitle: css`
    flex-shrink: 0;
    align-items: center;
    min-height: 25px;
  `,
  statCard: css`
    min-height: 146px;
  `,
}));

const BenchmarkDetailLoading = () => (
  <>
    <Flexbox className={styles.header} gap={16}>
      <Flexbox horizontal align="start" justify={'space-between'}>
        <Flexbox horizontal align="start" gap={12}>
          <Skeleton.Avatar
            shape="square"
            size={40}
            style={{ borderRadius: cssVar.borderRadiusLG }}
          />
          <Flexbox flex={1} gap={8}>
            <Skeleton height={24} width={200} />
            <Skeleton height={14} width={320} />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Skeleton height={28} width={72} />
          <Skeleton height={28} width={28} />
        </Flexbox>
      </Flexbox>
    </Flexbox>

    <Flexbox horizontal align={'center'} className={styles.hero} justify={'space-between'}>
      <Flexbox gap={8}>
        <Skeleton height={32} width={64} />
        <Skeleton height={14} width={144} />
      </Flexbox>
    </Flexbox>

    <Flexbox horizontal gap={12}>
      {[1, 2, 3, 4].map((i) => (
        <Card
          className={styles.statCard}
          key={i}
          styles={{ body: { padding: 16 } }}
          style={{
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: cssVar.borderRadius,
            flex: 1,
            minWidth: 0,
          }}
        >
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" gap={8}>
              <Skeleton.Avatar
                shape="square"
                size={36}
                style={{ borderRadius: cssVar.borderRadius }}
              />
              <Skeleton height={14} width={80} />
            </Flexbox>
            <Flexbox gap={4}>
              <Skeleton height={24} width={60} />
              <Skeleton height={12} width={100} />
            </Flexbox>
          </Flexbox>
        </Card>
      ))}
    </Flexbox>

    <Flexbox className={styles.sectionTitle}>
      <Skeleton height={18} width={80} />
    </Flexbox>
    <Flexbox className={styles.section} gap={16}>
      <Skeleton.Avatar shape={'square'} size={56} style={{ borderRadius: cssVar.borderRadiusLG }} />
      <Flexbox align={'center'} gap={6}>
        <Skeleton height={16} width={112} />
        <Skeleton height={12} width={216} />
      </Flexbox>
      <Skeleton height={28} width={112} />
    </Flexbox>
    <Flexbox className={styles.sectionTitle}>
      <Skeleton height={18} width={56} />
    </Flexbox>
    <Flexbox className={`${styles.section} ${styles.runsSection}`} gap={16}>
      <Skeleton.Avatar shape={'square'} size={56} style={{ borderRadius: cssVar.borderRadiusLG }} />
      <Flexbox align={'center'} gap={6}>
        <Skeleton height={16} width={96} />
        <Skeleton height={12} width={240} />
      </Flexbox>
      <Skeleton height={28} width={104} />
    </Flexbox>
  </>
);

export default BenchmarkDetailLoading;
