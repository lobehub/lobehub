import { Component, memo, type ReactNode, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

export type HostView = () => ReactNode;

interface Entry {
  key: string;
  revision: number;
  view: HostView;
}

interface BoundaryProps {
  children: ReactNode;
  host: HTMLElement;
  onError: (error: unknown, host: HTMLElement) => void;
  revision: number;
}

interface BoundaryState {
  failedAt: number | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failedAt: null };

  static getDerivedStateFromError() {
    return { failedAt: -1 };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    if (state.failedAt === -1) return { failedAt: props.revision };
    if (state.failedAt !== null && state.failedAt !== props.revision) return { failedAt: null };
    return null;
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error, this.props.host);
  }

  render() {
    return this.state.failedAt === null ? this.props.children : null;
  }
}

const View = memo(function View({ view }: { revision: number; view: HostView }) {
  return view();
});

export interface CanvasHostRoot {
  destroy: () => void;
  register: (host: HTMLElement, view: HostView) => void;
  unregister: (host: HTMLElement) => void;
  update: (host: HTMLElement) => void;
}

export const createHostRoot = (options: {
  onError: (error: unknown, host: HTMLElement) => void;
  wrap: (children: ReactNode) => ReactNode;
}): CanvasHostRoot => {
  const entries = new Map<HTMLElement, Entry>();
  const listeners = new Set<() => void>();
  let snapshot: [HTMLElement, Entry][] = [];
  let nextKey = 0;
  let destroyed = false;

  const publish = () => {
    snapshot = [...entries];
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => snapshot;

  const Hosts = () => {
    const hosts = useSyncExternalStore(subscribe, getSnapshot);
    return options.wrap(
      hosts.map(([host, entry]) =>
        createPortal(
          <Boundary host={host} revision={entry.revision} onError={options.onError}>
            <View revision={entry.revision} view={entry.view} />
          </Boundary>,
          host,
          entry.key,
        ),
      ),
    );
  };

  const container = document.createElement('div');
  container.dataset.lobeCanvasRoot = '';
  (document.body ?? document.documentElement).append(container);
  const root = createRoot(container);
  root.render(<Hosts />);

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      entries.clear();
      listeners.clear();
      snapshot = [];
      root.unmount();
      container.remove();
    },
    register: (host, view) => {
      if (destroyed) return;
      entries.set(host, { key: `h${nextKey++}`, revision: 0, view });
      publish();
    },
    unregister: (host) => {
      if (destroyed) return;
      if (entries.delete(host)) publish();
    },
    update: (host) => {
      if (destroyed) return;
      const entry = entries.get(host);
      if (!entry) return;
      entries.set(host, { ...entry, revision: entry.revision + 1 });
      publish();
    },
  };
};
