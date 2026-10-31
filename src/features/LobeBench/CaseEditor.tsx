'use client';

import type { EvalCaseEnvironment } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Drawer,
  Flexbox,
  Input,
  Segmented,
  Select,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui';
import { X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getCaseRules, getCaseTitle } from '@/features/LobeBench/lobeBench';
import { type LobeBenchCase, ownEnvironmentOf } from '@/features/LobeBench/useLobeBench';
import { useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';

type Role = 'assistant' | 'user';
interface Turn {
  content: string;
  role: Role;
}

/** What a conversation draft (or a copy) pre-fills the editor with. */
export interface CaseDraft {
  category?: string;
  environment?: EvalCaseEnvironment;
  input?: string;
  messages?: Turn[];
  rules?: string[];
  sessionDate?: string;
  sourceTopicId?: string;
  title?: string;
}

interface CaseEditorProps {
  datasetId: string;
  /** Pre-fills a new case; ignored when `testCase` is set. */
  draft?: CaseDraft;
  onClose: () => void;
  onSaved: (testCase: { id: string }) => void;
  open: boolean;
  /** The case to edit; absent when creating one. */
  testCase?: LobeBenchCase;
}

const joinList = (list?: string[]) => (list ?? []).join(', ');
const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Creates or edits one case: the request, the earlier turns, the rules the
 * judge checks, the shared environment it runs in and the few fields this
 * case overrides on top of it.
 */
const CaseEditor = memo<CaseEditorProps>(
  ({ datasetId, draft, onClose, onSaved, open, testCase }) => {
    const { t } = useTranslation('eval');
    const { data: environments } = useClientDataSWR('lobe-bench/environments', () =>
      agentEvalService.listEnvironments(),
    );

    const [title, setTitle] = useState('');
    const [input, setInput] = useState('');
    const [turns, setTurns] = useState<Turn[]>([]);
    const [category, setCategory] = useState('');
    const [rules, setRules] = useState('');
    const [environmentId, setEnvironmentId] = useState('');
    const [sessionDate, setSessionDate] = useState('');
    const [timezone, setTimezone] = useState('');
    const [persona, setPersona] = useState('');
    const [plugins, setPlugins] = useState('');
    const [mockServices, setMockServices] = useState('');
    const [saving, setSaving] = useState(false);

    // Load the case (or the draft) every time the drawer opens.
    useEffect(() => {
      if (!open) return;
      const own = ((testCase ? ownEnvironmentOf(testCase) : draft?.environment) ??
        {}) as EvalCaseEnvironment;
      const turnsOf = (list?: Array<{ content: string; role: string }>) =>
        (list ?? [])
          .filter((m): m is Turn => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ content: m.content, role: m.role }));
      setTitle(
        testCase
          ? typeof testCase.metadata?.title === 'string'
            ? testCase.metadata.title
            : ''
          : (draft?.title ?? ''),
      );
      setInput(testCase ? (testCase.content?.input ?? '') : (draft?.input ?? ''));
      setTurns(turnsOf(testCase ? testCase.content?.messages : draft?.messages));
      setCategory(testCase ? (testCase.content?.category ?? '') : (draft?.category ?? ''));
      setRules(testCase ? getCaseRules(testCase).join('\n') : (draft?.rules ?? []).join('\n'));
      setEnvironmentId(testCase?.environmentId ?? testCase?.environment?.id ?? '');
      setSessionDate(own.sessionDate ?? draft?.sessionDate ?? '');
      setTimezone(own.timezone ?? '');
      setPersona(own.agent?.systemRole ?? '');
      setPlugins(joinList(own.agent?.plugins));
      setMockServices(joinList(own.mock?.services));
    }, [open, testCase, draft]);

    const save = async () => {
      if (!input.trim()) return;
      if (sessionDate.trim() && Number.isNaN(Date.parse(sessionDate.trim()))) {
        toast.error(t('lobeBench.case.editor.invalidDate'));
        return;
      }
      setSaving(true);
      try {
        const pluginList = splitList(plugins);
        const services = splitList(mockServices);
        const agent = {
          ...(persona.trim() && { systemRole: persona.trim() }),
          ...(plugins.trim() && { plugins: pluginList }),
        };
        const environment: EvalCaseEnvironment = {
          ...(Object.keys(agent).length > 0 && { agent }),
          ...(services.length > 0 && { mock: { services } }),
          ...(sessionDate.trim() && { sessionDate: sessionDate.trim() }),
          ...(timezone.trim() && { timezone: timezone.trim() }),
        };
        const ruleLines = rules
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const content = {
          ...(category.trim() && { category: category.trim() }),
          ...(Object.keys(environment).length > 0 && { environment }),
          ...(testCase?.content?.expected && { expected: testCase.content.expected }),
          input: input.trim(),
          ...(turns.length > 0 && {
            messages: turns.filter((turn) => turn.content.trim()),
          }),
        };
        const evalConfig = ruleLines.length > 0 ? { judgePrompt: ruleLines.join('\n') } : null;
        const evalMode = ruleLines.length > 0 ? ('rule-checklist' as const) : null;
        const metadata = {
          ...testCase?.metadata,
          ...(draft?.sourceTopicId && !testCase && { sourceTopicId: draft.sourceTopicId }),
          title: title.trim() || undefined,
        };
        if (testCase) {
          await agentEvalService.updateTestCase({
            content,
            environmentId: environmentId || null,
            evalConfig,
            evalMode,
            id: testCase.id,
            metadata,
          });
          onSaved({ id: testCase.id });
        } else {
          const created = (await agentEvalService.createTestCase({
            content,
            datasetId,
            environmentId: environmentId || null,
            ...(evalConfig && { evalConfig }),
            ...(evalMode && { evalMode }),
            metadata,
          })) as { id?: string; data?: { id?: string } };
          onSaved({ id: created?.id ?? created?.data?.id ?? '' });
        }
        toast.success(t('lobeBench.case.editor.saved'));
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    };

    const environmentOptions = [
      { label: t('lobeBench.case.editor.environment.none'), value: '' },
      ...(environments ?? []).map((environment) => ({
        label: `${environment.name} · ${t('lobeBench.case.editor.environment.usedBy', {
          count: environment.testCaseCount ?? 0,
        })}`,
        value: environment.id,
      })),
    ];

    return (
      <Drawer
        open={open}
        width={640}
        title={
          testCase
            ? `${t('lobeBench.case.editor.edit')} · ${getCaseTitle(testCase)}`
            : t('lobeBench.case.editor.new')
        }
        onClose={onClose}
      >
        <Flexbox gap={20}>
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.case.editor.title')}</Text>
            <Input value={title} variant={'filled'} onChange={(e) => setTitle(e.target.value)} />
          </Flexbox>
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.case.editor.input')}</Text>
            <TextArea
              autoSize={{ maxRows: 10, minRows: 3 }}
              placeholder={t('lobeBench.case.editor.input.placeholder')}
              value={input}
              variant={'filled'}
              onChange={(e) => setInput(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Flexbox gap={2}>
              <Text weight={500}>{t('lobeBench.case.editor.turns')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.case.editor.turns.hint')}
              </Text>
            </Flexbox>
            {turns.map((turn, index) => (
              <Flexbox gap={6} key={index}>
                <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                  <Segmented
                    size={'small'}
                    value={turn.role}
                    options={[
                      { label: 'user', value: 'user' },
                      { label: 'assistant', value: 'assistant' },
                    ]}
                    onChange={(value) =>
                      setTurns((list) =>
                        list.map((item, i) =>
                          i === index ? { ...item, role: value as Role } : item,
                        ),
                      )
                    }
                  />
                  <ActionIcon
                    icon={X}
                    size={'small'}
                    onClick={() => setTurns((list) => list.filter((_, i) => i !== index))}
                  />
                </Flexbox>
                <TextArea
                  autoSize={{ maxRows: 6, minRows: 2 }}
                  value={turn.content}
                  variant={'filled'}
                  onChange={(e) =>
                    setTurns((list) =>
                      list.map((item, i) =>
                        i === index ? { ...item, content: e.target.value } : item,
                      ),
                    )
                  }
                />
              </Flexbox>
            ))}
            <Flexbox horizontal>
              <Button
                size={'small'}
                onClick={() => setTurns((list) => [...list, { content: '', role: 'user' }])}
              >
                {t('lobeBench.case.editor.turns.add')}
              </Button>
            </Flexbox>
          </Flexbox>
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.case.editor.category')}</Text>
            <Input
              value={category}
              variant={'filled'}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Flexbox gap={2}>
              <Text weight={500}>{t('lobeBench.case.editor.rules')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.case.editor.rules.hint')}
              </Text>
            </Flexbox>
            <TextArea
              autoSize={{ maxRows: 12, minRows: 4 }}
              placeholder={'Must: …\nMust not: …'}
              value={rules}
              variant={'filled'}
              onChange={(e) => setRules(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.case.editor.environment')}</Text>
            <Select
              options={environmentOptions}
              value={environmentId}
              variant={'filled'}
              onChange={(value) => setEnvironmentId((value as string) ?? '')}
            />
          </Flexbox>
          <Flexbox gap={10}>
            <Flexbox gap={2}>
              <Text weight={500}>{t('lobeBench.case.editor.overrides')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.case.editor.overrides.hint')}
              </Text>
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13}>{t('lobeBench.case.editor.sessionDate')}</Text>
              <Input
                placeholder={'2026-07-20T09:00:00Z'}
                value={sessionDate}
                variant={'filled'}
                onChange={(e) => setSessionDate(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13}>{t('lobeBench.case.editor.timezone')}</Text>
              <Input
                placeholder={'America/New_York'}
                value={timezone}
                variant={'filled'}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13}>{t('lobeBench.case.editor.persona')}</Text>
              <TextArea
                autoSize={{ maxRows: 8, minRows: 2 }}
                value={persona}
                variant={'filled'}
                onChange={(e) => setPersona(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13}>{t('lobeBench.case.editor.plugins')}</Text>
              <Input
                placeholder={'lobe-web-browsing, gmail'}
                value={plugins}
                variant={'filled'}
                onChange={(e) => setPlugins(e.target.value)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13}>{t('lobeBench.case.editor.mock')}</Text>
              <Input
                placeholder={'gmail, linear'}
                value={mockServices}
                variant={'filled'}
                onChange={(e) => setMockServices(e.target.value)}
              />
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal gap={8} justify={'flex-end'}>
            <Button onClick={onClose}>{t('lobeBench.new.cancel')}</Button>
            <Button disabled={!input.trim()} loading={saving} type={'primary'} onClick={save}>
              {t('lobeBench.case.editor.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Drawer>
    );
  },
);

CaseEditor.displayName = 'LobeBenchCaseEditor';

export default CaseEditor;
