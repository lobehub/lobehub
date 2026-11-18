import { Flexbox, SearchBar, Text } from '@lobehub/ui';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';

const CatalogSearch = ({ label }: { label: string }) => {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState({ q, word: q });
  if (draft.q !== q) setDraft({ q, word: q });

  const search = (word: string) => {
    const value = word.trim();
    if (value === q) return;

    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next);
  };

  return (
    <SearchBar
      aria-label={label}
      data-testid="search-bar"
      placeholder={label}
      style={{ flex: '1 1 200px', maxWidth: 300, minWidth: 0 }}
      value={draft.word}
      onSearch={search}
      onInputChange={(word) => {
        setDraft({ q, word });
        if (!word) search('');
      }}
    />
  );
};

interface CatalogHeaderProps {
  action: ReactNode;
  description: string;
  searchLabel: string;
  title: string;
}

export const CatalogHeader = ({ action, description, searchLabel, title }: CatalogHeaderProps) => (
  <Flexbox horizontal align="center" gap={16} justify="space-between" style={{ flexWrap: 'wrap' }}>
    <Flexbox gap={4}>
      <Text as="h1" fontSize={28} weight={600}>
        {title}
      </Text>
      <Text type="secondary">{description}</Text>
    </Flexbox>
    <Flexbox horizontal align="center" gap={8} justify="flex-end" style={{ flex: '0 1 400px' }}>
      <CatalogSearch label={searchLabel} />
      {action}
    </Flexbox>
  </Flexbox>
);
