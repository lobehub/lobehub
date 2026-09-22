'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Input, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BracesIcon, CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /** Railway's variables list: a framed block with a rule between rows. */
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  row: css`
    padding-block: 8px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    word-break: break-all;
  `,
  /**
   * Dashed, the way Railway frames "no variables": the outline says a list
   * belongs here, and the dashes say it has not been filled in, without the
   * weight a solid box would give an absence.
   */
  empty: css`
    padding-block: 32px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  editor: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
  `,
}));

type Entry = [string, string];

/**
 * Parse `.env`-style text: one `KEY=value` per line, blank lines and `#`
 * comments skipped, an optional `export ` prefix and a matching pair of quotes
 * around the value dropped. Later lines win over earlier ones with the same
 * key, as they would when a shell sources the file.
 *
 * @returns the entries, or the 1-based number of the first line that is not a
 *   `KEY=value` pair
 */
export const parseDotenv = (text: string): { entries: Entry[] } | { line: number } => {
  const entries = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_]\w*)\s*=(.*)$/);
    if (!match) return { line: index + 1 };
    let value = match[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    entries.set(match[1], value);
  }
  return { entries: [...entries.entries()] };
};

/** The inverse, for the raw editor's starting text. */
export const formatDotenv = (entries: Entry[]) =>
  entries
    .map(([key, value]) => `${key}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`)
    .join('\n');

/**
 * One variable, either as a row or open for editing. Key and value edit
 * together: a variable is one thing, and confirming half of it is not a state
 * anyone wants stored.
 */
const EnvRow = memo<{
  entry: Entry;
  onRemove: () => Promise<void>;
  onSave: (entry: Entry) => Promise<void>;
}>(({ entry, onRemove, onSave }) => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const [draft, setDraft] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setDraft(null);
    } catch (error) {
      toast.error((error as { message?: string })?.message || String(error));
    } finally {
      setBusy(false);
    }
  };

  if (draft) {
    return (
      <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
        <Input
          autoFocus
          placeholder={'NODE_ENV'}
          style={{ flex: 1 }}
          value={draft[0]}
          onChange={(event) => setDraft([event.target.value, draft[1]])}
        />
        <Input
          placeholder={'production'}
          style={{ flex: 1 }}
          value={draft[1]}
          onChange={(event) => setDraft([draft[0], event.target.value])}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDraft(null);
            if (event.key === 'Enter' && draft[0].trim()) {
              void run(() => onSave([draft[0].trim(), draft[1]]));
            }
          }}
        />
        <ActionIcon
          disabled={!draft[0].trim()}
          icon={CheckIcon}
          loading={busy}
          size={'small'}
          title={tCommon('save')}
          onClick={() => run(() => onSave([draft[0].trim(), draft[1]]))}
        />
        <ActionIcon
          disabled={busy}
          icon={XIcon}
          size={'small'}
          title={tCommon('cancel')}
          onClick={() => setDraft(null)}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
      <span className={styles.mono} style={{ flex: 1 }}>
        {entry[0]}
      </span>
      {/* Shown, not starred out: the hint above says these are stored in the
          clear and copied into every instance, and a mask would promise a
          secrecy the storage does not keep. */}
      <span className={styles.mono} style={{ color: cssVar.colorTextSecondary, flex: 1 }}>
        {entry[1]}
      </span>
      <ActionIcon
        icon={PencilIcon}
        size={'small'}
        title={t('environments.form.editEnv')}
        onClick={() => setDraft([entry[0], entry[1]])}
      />
      <ActionIcon
        icon={Trash2Icon}
        loading={busy}
        size={'small'}
        title={t('environments.form.removeEnv')}
        onClick={() => run(onRemove)}
      />
    </Flexbox>
  );
});

EnvRow.displayName = 'EnvironmentVariableRow';

interface EnvironmentVariablesProps {
  entries: Entry[];
  /** Writes the whole set; every change here is one specification save. */
  onSave: (entries: Entry[]) => Promise<void>;
}

/**
 * An environment's variables, laid out the way Railway lays out a service's.
 *
 * A heading that counts them, with the two ways in on the right: a new row for
 * one variable, or the raw editor for a whole `.env` at once. New rows open at
 * the top of the list so the field is where the button was, not below a list
 * that may be long.
 */
const EnvironmentVariables = memo<EnvironmentVariablesProps>(({ entries, onSave }) => {
  const { t } = useTranslation('setting');
  const [adding, setAdding] = useState<Entry | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error((error as { message?: string })?.message || String(error));
    } finally {
      setBusy(false);
    }
  };

  const openRaw = () => {
    setAdding(null);
    setRaw(formatDotenv(entries));
  };

  const saveRaw = () => {
    if (raw === null) return;
    const parsed = parseDotenv(raw);
    if ('line' in parsed) {
      toast.error(t('environments.form.rawInvalid', { line: parsed.line }));
      return;
    }
    void run(async () => {
      await onSave(parsed.entries);
      setRaw(null);
    });
  };

  const addNew = () =>
    run(async () => {
      if (!adding) return;
      const key = adding[0].trim();
      await onSave([...entries.filter(([k]) => k !== key), [key, adding[1]]]);
      setAdding(null);
    });

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text weight={600}>
          {entries.length === 0
            ? t('environments.form.env')
            : t('environments.form.envCount', { count: entries.length })}
        </Text>
        <Flexbox horizontal align={'center'} gap={4}>
          {raw === null ? (
            <>
              <Button
                icon={<Icon icon={BracesIcon} />}
                size={'small'}
                type={'text'}
                onClick={openRaw}
              >
                {t('environments.form.rawEditor')}
              </Button>
              <Button
                disabled={adding !== null}
                icon={<Icon icon={PlusIcon} />}
                size={'small'}
                type={'primary'}
                onClick={() => setAdding(['', ''])}
              >
                {t('environments.form.addEnv')}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy} size={'small'} onClick={() => setRaw(null)}>
                {t('cancel', { ns: 'common' })}
              </Button>
              <Button loading={busy} size={'small'} type={'primary'} onClick={saveRaw}>
                {t('save', { ns: 'common' })}
              </Button>
            </>
          )}
        </Flexbox>
      </Flexbox>

      {raw !== null ? (
        <Flexbox gap={6}>
          <TextArea
            autoFocus
            className={styles.editor}
            placeholder={'NODE_ENV=production\nAPI_URL=https://example.com'}
            rows={Math.min(16, Math.max(6, raw.split('\n').length + 1))}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('environments.form.rawEditorHint')}
          </Text>
        </Flexbox>
      ) : entries.length === 0 && !adding ? (
        <Flexbox align={'center'} className={styles.empty} gap={4}>
          <Text weight={500}>{t('environments.form.envEmpty')}</Text>
          <Flexbox horizontal align={'center'} gap={4}>
            <Text fontSize={12} type={'secondary'}>
              {t('environments.form.envEmptyHint')}
            </Text>
            <Button size={'small'} type={'link'} onClick={openRaw}>
              {t('environments.form.rawEditor')}
            </Button>
          </Flexbox>
        </Flexbox>
      ) : (
        <div className={styles.list}>
          {adding && (
            <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
              <Input
                autoFocus
                placeholder={'NODE_ENV'}
                style={{ flex: 1 }}
                value={adding[0]}
                onChange={(event) => setAdding([event.target.value, adding[1]])}
              />
              <Input
                placeholder={'production'}
                style={{ flex: 1 }}
                value={adding[1]}
                onChange={(event) => setAdding([adding[0], event.target.value])}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setAdding(null);
                  if (event.key === 'Enter' && adding[0].trim()) void addNew();
                }}
              />
              <ActionIcon
                disabled={!adding[0].trim()}
                icon={CheckIcon}
                loading={busy}
                size={'small'}
                title={t('save', { ns: 'common' })}
                onClick={addNew}
              />
              <ActionIcon
                disabled={busy}
                icon={XIcon}
                size={'small'}
                title={t('cancel', { ns: 'common' })}
                onClick={() => setAdding(null)}
              />
            </Flexbox>
          )}
          {entries.map(([key, value]) => (
            <EnvRow
              entry={[key, value]}
              key={key}
              onRemove={() => onSave(entries.filter(([k]) => k !== key))}
              onSave={(entry) => onSave(entries.map(([k, v]) => (k === key ? entry : [k, v])))}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

EnvironmentVariables.displayName = 'EnvironmentVariables';

export default EnvironmentVariables;
