export interface CanvasRuntimeModule {
  code: string;
  id: string;
  imports: { end: number; start: number; target: string }[];
  meta?: { end: number; start: number }[];
  url: string;
}

export interface CanvasRuntimeManifest {
  base: string;
  entries: { highlight: string; mermaid: string; runtime: string };
  entryStyles?: Partial<Record<keyof CanvasRuntimeManifest['entries'], string[]>>;
  modules: Omit<CanvasRuntimeModule, 'code' | 'url'>[];
  styles: string[];
}

export interface CanvasRuntimeBundle {
  entries: CanvasRuntimeManifest['entries'];
  modules: CanvasRuntimeModule[];
  styles: string[];
}
