export const menuKey = (provider: string, model: string) => `${provider}-${model}`;

export const ModelRowRender = ({ model }: { model: { displayName?: string; id: string } }) => (
  <span>{model.displayName ?? model.id}</span>
);

export const ProviderItemRender = ({ name }: { name: string }) => <span>{name}</span>;

export default function ModelDetailPanelStub() {
  return <div data-model-detail-stub style={{ height: 40 }} />;
}
