'use client';

import { nanoid } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Alert,
  Button,
  Input,
  InputNumber,
  ModalFooter,
  Select,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { PlusIcon, TrashIcon, UploadIcon } from 'lucide-react';
import type { AiProviderModelListItem } from 'model-bank/aiModel';
import type { ComfyUIWorkflow, ComfyUIWorkflowParameter } from 'model-bank/comfyuiWorkflow';
import {
  ComfyUIWorkflowGraphSchema,
  ComfyUIWorkflowSchema,
  getComfyUIWorkflowParameters,
} from 'model-bank/comfyuiWorkflow';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { comfyuiService } from '@/services/comfyui';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const PARAMETERS: ComfyUIWorkflowParameter[] = [
  'prompt',
  'negativePrompt',
  'seed',
  'width',
  'height',
  'steps',
  'cfg',
  'samplerName',
  'scheduler',
  'strength',
  'imageUrls',
];

interface BindingRow {
  id: string;
  imageIndex: number | null;
  input: string;
  nodeId: string;
  parameter: ComfyUIWorkflowParameter;
}

interface WorkflowDraft {
  bindings: BindingRow[];
  graphText: string;
  imageIndex: number | null;
  name: string;
  outputNodeId: string;
}

interface ContentProps {
  model?: AiProviderModelListItem;
}

interface EditorProps extends ContentProps {
  draftKey: string;
}

const createDraft = (model?: AiProviderModelListItem): WorkflowDraft => {
  const workflow = model?.config?.comfyuiWorkflow;
  return {
    bindings: workflow
      ? PARAMETERS.flatMap((parameter) =>
          (workflow.bindings[parameter] || []).map((binding) => ({
            ...binding,
            id: nanoid(),
            imageIndex: binding.imageIndex ?? 0,
            parameter,
          })),
        )
      : [],
    graphText: workflow ? JSON.stringify(workflow.graph, null, 2) : '',
    imageIndex: workflow?.output.imageIndex ?? 0,
    name: model?.displayName || '',
    outputNodeId: workflow?.output.nodeId || '',
  };
};

const WorkflowEditor = ({ model, draftKey }: EditorProps) => {
  const { t } = useTranslation(['modelProvider', 'common']);
  const { close } = useModalContext();
  const [initialDraft] = useState(() => createDraft(model));
  const [draft, setDraft] = useLocalStorageState<WorkflowDraft>(draftKey, initialDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [validation, setValidation] = useState<{ errors: string[]; valid: boolean }>();
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const createNewAiModel = useAiInfraStore((s) => s.createNewAiModel);
  const updateAiModelsConfig = useAiInfraStore((s) => s.updateAiModelsConfig);
  const busy = validating || saving || readingFile;

  // Parsing the graph is expensive for large workflows; name and binding edits reuse it.
  const graphResult = useMemo(() => {
    if (!draft.graphText.trim()) return undefined;
    try {
      const result = ComfyUIWorkflowGraphSchema.safeParse(JSON.parse(draft.graphText));
      return result.success
        ? { graph: result.data }
        : {
            errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
          };
    } catch (error) {
      return {
        errors: [error instanceof Error ? error.message : t('comfyui.workflow.error.json')],
      };
    }
  }, [draft.graphText, t]);

  const graph = graphResult?.graph;
  const nodeOptions = Object.entries(graph || {}).map(([nodeId, node]) => ({
    label: `${nodeId} · ${node._meta?.title || node.class_type}`,
    value: nodeId,
  }));
  const targetOptions = Object.entries(graph || {}).flatMap(([nodeId, node]) =>
    Object.keys(node.inputs).map((input) => ({
      input,
      inputType: typeof node.inputs[input],
      label: `${nodeId} · ${input} · ${node._meta?.title || node.class_type}`,
      nodeId,
      value: JSON.stringify([nodeId, input]),
    })),
  );
  const parameterOptions = PARAMETERS.map((parameter) => ({
    label: t(`comfyui.workflow.parameter.${parameter}`),
    value: parameter,
  }));

  const updateDraft = (change: Partial<WorkflowDraft>) => {
    setDraft((previous) => ({ ...previous, ...change }));
    setErrors([]);
    setValidation(undefined);
  };

  const updateBinding = (id: string, change: Partial<BindingRow>) => {
    updateDraft({
      bindings: draft.bindings.map((binding) =>
        binding.id === id ? { ...binding, ...change } : binding,
      ),
    });
  };

  const buildWorkflow = (): ComfyUIWorkflow | undefined => {
    if (!graph) {
      setErrors(graphResult?.errors || [t('comfyui.workflow.error.graphRequired')]);
      return;
    }
    const bindings: Record<string, unknown[]> = {};
    for (const row of draft.bindings) {
      (bindings[row.parameter] ||= []).push({
        input: row.input,
        nodeId: row.nodeId,
        ...(row.parameter === 'imageUrls' ? { imageIndex: row.imageIndex } : {}),
      });
    }
    const result = ComfyUIWorkflowSchema.safeParse({
      bindings,
      graph,
      output: { imageIndex: draft.imageIndex, nodeId: draft.outputNodeId },
      version: 1,
    });
    if (!result.success) {
      setErrors(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
      return;
    }
    setErrors([]);
    return result.data;
  };

  const handleValidate = async () => {
    const workflow = buildWorkflow();
    if (!workflow) return;
    setValidating(true);
    setValidation(undefined);
    try {
      setValidation(await comfyuiService.validateWorkflow(workflow));
    } catch (error) {
      console.error(error);
      setValidation({
        errors: [error instanceof Error ? error.message : t('comfyui.workflow.error.validate')],
        valid: false,
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      setErrors([t('comfyui.workflow.error.nameRequired')]);
      return;
    }
    const workflow = buildWorkflow();
    if (!workflow) return;
    setSaving(true);
    try {
      const data = {
        config: { ...model?.config, comfyuiWorkflow: workflow },
        displayName: draft.name.trim(),
        parameters: getComfyUIWorkflowParameters(workflow),
      };
      if (model) {
        await updateAiModelsConfig(model.id, 'comfyui', data);
      } else {
        await createNewAiModel({
          ...data,
          id: `comfyui/workflow-${nanoid()}`,
          providerId: 'comfyui',
          type: 'image',
        });
      }
      setDraft(model ? { ...draft, name: data.displayName } : createDraft());
      toast.success(t('comfyui.workflow.saved'));
      close();
    } catch (error) {
      console.error(error);
      setErrors([error instanceof Error ? error.message : t('comfyui.workflow.error.save')]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox style={{ maxHeight: '80vh' }}>
      <Flexbox gap={20} padding={24} style={{ overflow: 'auto' }}>
        <Text>{t('comfyui.workflow.description')}</Text>
        <Text type="secondary">{t('comfyui.workflow.draftHint')}</Text>
        <Flexbox gap={8}>
          <label htmlFor="comfyui-workflow-name">{t('comfyui.workflow.name')}</label>
          <Input
            disabled={busy}
            id="comfyui-workflow-name"
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
          />
        </Flexbox>
        <Flexbox gap={8}>
          <Flexbox horizontal align="center" justify="space-between">
            <label htmlFor="comfyui-workflow-graph">{t('comfyui.workflow.graph')}</label>
            <Button
              disabled={busy}
              icon={UploadIcon}
              loading={readingFile}
              onClick={() => fileInput.current?.click()}
            >
              {t('comfyui.workflow.file')}
            </Button>
          </Flexbox>
          <input
            accept="application/json,.json"
            ref={fileInput}
            style={{ display: 'none' }}
            type="file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setReadingFile(true);
              try {
                updateDraft({ graphText: await file.text() });
              } catch (error) {
                console.error(error);
                setErrors([t('comfyui.workflow.error.file')]);
              } finally {
                setReadingFile(false);
              }
            }}
          />
          <TextArea
            disabled={busy}
            id="comfyui-workflow-graph"
            rows={9}
            style={{ fontFamily: 'monospace' }}
            value={draft.graphText}
            onChange={(event) => updateDraft({ graphText: event.target.value })}
          />
          <Text type="secondary">{t('comfyui.workflow.graphHint')}</Text>
          {graphResult?.errors && (
            <Alert
              title={t('comfyui.workflow.error.json')}
              type="error"
              description={
                <ul>
                  {graphResult.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              }
            />
          )}
        </Flexbox>
        <Flexbox gap={12}>
          <Text strong>{t('comfyui.workflow.bindings')}</Text>
          <Text type="secondary">{t('comfyui.workflow.bindingsHint')}</Text>
          {draft.bindings.map((binding) => (
            <Flexbox gap={8} key={binding.id}>
              <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
                <Select
                  allowClear={false}
                  disabled={busy}
                  options={parameterOptions}
                  style={{ flexShrink: 0, width: 160 }}
                  value={binding.parameter}
                  onChange={(value) => {
                    if (typeof value === 'string')
                      updateBinding(binding.id, { parameter: value as ComfyUIWorkflowParameter });
                  }}
                />
                <Select
                  showSearch
                  disabled={busy || !graph}
                  placeholder={t('comfyui.workflow.target')}
                  style={{ flex: 1, minWidth: 200 }}
                  options={targetOptions.filter(
                    (option) =>
                      option.inputType ===
                      ([
                        'prompt',
                        'negativePrompt',
                        'samplerName',
                        'scheduler',
                        'imageUrls',
                      ].includes(binding.parameter)
                        ? 'string'
                        : 'number'),
                  )}
                  value={
                    binding.nodeId && binding.input
                      ? JSON.stringify([binding.nodeId, binding.input])
                      : null
                  }
                  onChange={(value) => {
                    const target = targetOptions.find((option) => option.value === value);
                    updateBinding(binding.id, {
                      input: target?.input || '',
                      nodeId: target?.nodeId || '',
                    });
                  }}
                />
                <ActionIcon
                  disabled={busy}
                  icon={TrashIcon}
                  title={t('comfyui.workflow.removeBinding')}
                  onClick={() =>
                    updateDraft({ bindings: draft.bindings.filter((row) => row.id !== binding.id) })
                  }
                />
              </Flexbox>
              {binding.parameter === 'imageUrls' && (
                <Flexbox horizontal align="center" gap={8}>
                  <label htmlFor={`comfyui-reference-${binding.id}`}>
                    {t('comfyui.workflow.referenceIndex')}
                  </label>
                  <InputNumber
                    disabled={busy}
                    id={`comfyui-reference-${binding.id}`}
                    min={0}
                    precision={0}
                    value={binding.imageIndex}
                    onChange={(imageIndex) => updateBinding(binding.id, { imageIndex })}
                  />
                </Flexbox>
              )}
            </Flexbox>
          ))}
          <Button
            disabled={busy || !graph}
            icon={PlusIcon}
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              updateDraft({
                bindings: [
                  ...draft.bindings,
                  { id: nanoid(), imageIndex: 0, input: '', nodeId: '', parameter: 'prompt' },
                ],
              })
            }
          >
            {t('comfyui.workflow.addBinding')}
          </Button>
          <Text type="secondary">{t('comfyui.workflow.referenceHint')}</Text>
        </Flexbox>
        <Flexbox gap={8}>
          <Text strong>{t('comfyui.workflow.output')}</Text>
          <Text type="secondary">{t('comfyui.workflow.outputHint')}</Text>
          <Select
            showSearch
            disabled={busy || !graph}
            options={nodeOptions}
            placeholder={t('comfyui.workflow.outputNode')}
            value={draft.outputNodeId || null}
            onChange={(value) =>
              updateDraft({ outputNodeId: typeof value === 'string' ? value : '' })
            }
          />
          <Flexbox horizontal align="center" gap={8}>
            <label htmlFor="comfyui-output-index">{t('comfyui.workflow.outputIndex')}</label>
            <InputNumber
              disabled={busy}
              id="comfyui-output-index"
              min={0}
              precision={0}
              value={draft.imageIndex}
              onChange={(imageIndex) => updateDraft({ imageIndex })}
            />
          </Flexbox>
        </Flexbox>
        <Flexbox gap={8}>
          <Button disabled={busy || !graph} loading={validating} onClick={handleValidate}>
            {t(
              validating
                ? 'comfyui.workflow.validating'
                : validation && !validation.valid
                  ? 'comfyui.workflow.retry'
                  : 'comfyui.workflow.validate',
            )}
          </Button>
          {validation ? (
            <Alert
              title={t(validation.valid ? 'comfyui.workflow.valid' : 'comfyui.workflow.invalid')}
              type={validation.valid ? 'success' : 'error'}
              description={
                !validation.valid && (
                  <ul>
                    {validation.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                )
              }
            />
          ) : (
            <Text type="secondary">{t('comfyui.workflow.unverified')}</Text>
          )}
        </Flexbox>
        {errors.length > 0 && (
          <Alert
            title={t('comfyui.workflow.error.title')}
            type="error"
            description={
              <ul>
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            }
          />
        )}
      </Flexbox>
      <ModalFooter>
        <Button disabled={busy} onClick={close}>
          {t('common:cancel')}
        </Button>
        <Button disabled={busy || !graph} loading={saving} type="primary" onClick={handleSave}>
          {t(validation?.valid ? 'comfyui.workflow.save' : 'comfyui.workflow.saveUnverified')}
        </Button>
      </ModalFooter>
    </Flexbox>
  );
};

export const ComfyUIWorkflowContent = ({ model }: ContentProps) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const draftKey = `comfyui-workflow-draft:${userId}:${workspaceId || 'personal'}:${model?.id || 'new'}`;
  return <WorkflowEditor draftKey={draftKey} key={draftKey} model={model} />;
};
