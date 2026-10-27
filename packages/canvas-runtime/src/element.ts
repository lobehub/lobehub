import type { CanvasComponentSpec } from '@lobechat/canvas';
import type { ReactNode } from 'react';

import type { CanvasHostRoot } from './host';
import {
  type CanvasChildItem,
  jsonSourceAttributes,
  readChildItems,
  readJsonChildren,
  readProps,
} from './props';

export interface CanvasViewContext {
  change: (value: unknown) => void;
  checked: boolean;
  items: CanvasChildItem[];
  props: Record<string, any>;
  slot: (node: HTMLElement | null) => void;
  text: string;
  value: unknown;
}

export type CanvasView = (context: CanvasViewContext) => ReactNode;

const GLOBAL_OBSERVED = ['hidden', 'class', 'style'];

export const defineCanvasElement = (
  spec: CanvasComponentSpec,
  view: CanvasView,
  getHosts: () => CanvasHostRoot,
) => {
  const sources = jsonSourceAttributes(spec);

  class CanvasElement extends HTMLElement {
    static get observedAttributes() {
      return [...Object.keys(spec.attributes), ...sources, ...GLOBAL_OBSERVED];
    }

    #mounted = false;
    #nodes: Node[] = [];
    #items: CanvasChildItem[] = [];
    #text = '';
    #childData: Record<string, unknown> = {};
    #loaded: Record<string, unknown> = {};
    #slotNode: HTMLElement | null = null;
    #value: unknown;
    #checked = false;

    get value() {
      return this.#value;
    }

    set value(next: unknown) {
      this.#value = next;
      this.#render();
    }

    get checked() {
      return this.#checked;
    }

    set checked(next: boolean) {
      this.#checked = next;
      this.#render();
    }

    connectedCallback() {
      if (!this.#mounted) {
        this.#mounted = true;
        this.#text = this.textContent ?? '';
        this.#childData = readJsonChildren(this);
        if (spec.children === 'options') this.#items = readChildItems(this);
        this.#nodes = spec.children === 'content' ? [...this.childNodes] : [];
        this.#value = this.getAttribute('value') ?? undefined;
        if (spec.attributes.value?.type === 'number' && this.#value !== undefined) {
          this.#value = Number(this.#value);
        }
        this.#checked = this.#readChecked();
        // Keep business nodes in the document until the React slot adopts them.
        if (spec.children !== 'content') this.replaceChildren();
        for (const source of sources) this.#loadSource(source);
      }
      getHosts().register(this, () => view(this.#context()));
    }

    disconnectedCallback() {
      getHosts().unregister(this);
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null) {
      if (!this.#mounted || previous === next) return;
      if (name === 'value') this.#value = next ?? undefined;
      if (name === 'checked') this.#checked = this.#readChecked();
      if (sources.includes(name)) this.#loadSource(name);
      this.#render();
    }

    #readChecked() {
      const raw = this.getAttribute('checked');
      return raw !== null && raw !== 'false';
    }

    #render() {
      if (this.#mounted) getHosts().update(this);
    }

    #loadSource(source: string) {
      const url = this.getAttribute(source);
      if (!url) return;
      const prop = source.slice(0, -'-src'.length);
      fetch(new URL(url, document.baseURI))
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return response.json();
        })
        .then((data) => {
          this.#loaded = { ...this.#loaded, [prop]: data };
          this.#render();
        })
        .catch((error) => {
          window.dispatchEvent(
            new CustomEvent('lobe-canvas-component-error', {
              detail: { message: `${source}="${url}": ${String(error)}`, tag: spec.tag },
            }),
          );
        });
    }

    #context(): CanvasViewContext {
      return {
        change: (value) => {
          if (typeof value === 'boolean') this.#checked = value;
          else this.#value = value;
          this.#render();
          this.dispatchEvent(
            new CustomEvent('lobe-change', {
              bubbles: true,
              detail: { checked: this.#checked, value },
            }),
          );
        },
        checked: this.#checked,
        items: this.#items,
        props: readProps(this, spec, { ...this.#childData, ...this.#loaded }),
        slot: (node) => {
          if (!node || node === this.#slotNode) return;
          this.#slotNode = node;
          node.append(...this.#nodes);
        },
        text: this.#text,
        value: this.#value,
      };
    }
  }

  return CanvasElement;
};
