/**
 * The structural slice of a browser this kit needs, and nothing else.
 *
 * ── Why these are hand-written interfaces and not `Window`/`Storage` ──────
 *
 * `tsconfig.src.json` builds this package with `lib: ["ES2022"]` and
 * `types: []`, so there is no `Window`, no `Storage` and no `document` to
 * refer to — a DOM reference in non-spec source is a compile error, the same
 * mechanical rule `@chatlychat/core` uses. That is not asceticism: this kit
 * runs in three places with three different globals — jsdom under vitest, a
 * real page under `page.evaluate`, and a bare Node process asserting over a
 * captured object — and a type that names `Window` would make the second and
 * third awkward while proving nothing about the first.
 *
 * Structural types also make the kit honest about how little it touches. If a
 * future helper needs `document`, it has to widen an interface here, in one
 * place, where somebody reviewing the diff can see the dependency arrive.
 */

/** The `localStorage` / `sessionStorage` surface this kit reads. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The window slice the kit installs onto and reads back.
 *
 * Both stores are optional, because both of the things that make them absent
 * are real: a bare Node global has neither, and a browser with site data
 * blocked throws on ACCESS rather than returning null — which is why every
 * read in this package goes through `readStore` rather than touching them
 * directly.
 */
export interface HostWindow {
  Chatly?: unknown;
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
}

/**
 * A store, or `null` when there is not one that can be read.
 *
 * `try/catch` around the PROPERTY ACCESS, not only around `getItem`. Reading
 * `window.localStorage` itself throws in a document with an opaque origin (a
 * sandboxed iframe) and in a browser with site data blocked — a trap this
 * repo has paid for once already, with eleven unguarded reads that stopped
 * the widget booting at all.
 */
export function readStore(win: HostWindow, which: 'local' | 'session'): StorageLike | null {
  try {
    const store = which === 'local' ? win.localStorage : win.sessionStorage;
    return store === undefined || store === null ? null : store;
  } catch {
    return null;
  }
}
