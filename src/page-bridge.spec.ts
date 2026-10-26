/**
 * The two string seams, and the one adapter that keeps them from becoming a
 * parallel vocabulary.
 *
 * The snapshot and seed sources are JavaScript this package cannot execute —
 * they run in a page. So what is testable here is their TEXT (does the seed
 * carry the keys, is each write guarded) and the adapter that turns what
 * comes back into something the kit's existing assertions already understand.
 * The one test that proves the source actually works is the last one, which
 * runs the snapshot expression with `eval` against a hand-built store.
 */
import { describe, expect, it } from 'vitest';

import {
  CHATLY_STORAGE_SNAPSHOT_SOURCE,
  capturedHost,
  chatlyStorageSeedSource,
  readChatlyStorageSnapshot,
} from './page-bridge.js';
import { clearChatlyStorage, expectNoChatlyStorage, findChatlyStorage } from './storage.js';

describe('chatlyStorageSeedSource', () => {
  it('writes every key, each inside its own try', () => {
    const source = chatlyStorageSeedSource({
      'chatly:vr:pub_1': '{}',
      'chatly:xid:pub_1': 'user-7',
    });
    expect(source).toContain('window.localStorage.setItem("chatly:vr:pub_1", "{}")');
    expect(source).toContain('window.localStorage.setItem("chatly:xid:pub_1", "user-7")');
    /*
     * One guard PER WRITE, not one around the loop. A single key the browser
     * refuses — a quota, a blocked origin — must not silently drop the rest
     * of the seed, which would make a correct loader look wrong.
     */
    expect(source.match(/try \{/g)?.length).toBe(2);
  });

  it('escapes a value that would otherwise terminate its own quoting', () => {
    // `JSON.stringify`, never string concatenation: a seeded value is
    // caller-supplied and a quote in it would turn a seed into a syntax error
    // — or, worse, into other code.
    const source = chatlyStorageSeedSource({ 'chatly:x': '{"a":"b\\"c"}' });
    expect(source).toContain('"{\\"a\\":\\"b\\\\\\"c\\"}"');
  });

  it('can target sessionStorage, which is where one real key lives', () => {
    // `chatly:utm` is the one key that is NOT in localStorage — campaign
    // attribution is a tab-session fact. See `storage-keys.ts`.
    expect(chatlyStorageSeedSource({ 'chatly:utm': 'x' }, 'sessionStorage')).toContain(
      'window.sessionStorage.setItem',
    );
  });

  it('produces a runnable statement for an empty seed', () => {
    expect(() => eval(chatlyStorageSeedSource({}))).not.toThrow();
  });
});

describe('readChatlyStorageSnapshot', () => {
  it('narrows what crossed the process boundary instead of casting it', () => {
    const snapshot = readChatlyStorageSnapshot({
      localStorage: { 'chatly:vt:pub_1': 'tok', bad: 7 },
      sessionStorage: {},
    });
    expect(snapshot.localStorage).toEqual({ 'chatly:vt:pub_1': 'tok' });
    expect(snapshot.sessionStorage).toEqual({});
  });

  it('reads an unreadable or missing store as null, never as empty', () => {
    /*
     * The distinction `readStore` already makes and that every assertion
     * downstream depends on: an unreadable store is one the widget could not
     * have written to either, and conflating it with an EMPTY store would
     * make "nothing was written" pass for a browser that simply refused to
     * answer.
     */
    expect(readChatlyStorageSnapshot({ localStorage: null }).localStorage).toBeNull();
    expect(readChatlyStorageSnapshot(undefined).localStorage).toBeNull();
    expect(readChatlyStorageSnapshot('not an object').sessionStorage).toBeNull();
  });
});

describe('capturedHost', () => {
  it('lets the kit’s existing assertions run over a page capture', () => {
    const host = capturedHost(
      readChatlyStorageSnapshot({
        localStorage: { 'chatly:vt:pub_1': 'tok', 'not-ours': '1' },
        sessionStorage: { 'chatly:utm': 'src=x' },
      }),
    );
    // The point of the adapter: no second vocabulary. These are the same
    // three functions a jsdom test calls.
    expect(findChatlyStorage(host)).toEqual([
      { key: 'chatly:vt:pub_1', store: 'localStorage' },
      { key: 'chatly:utm', store: 'sessionStorage' },
    ]);
    expect(() => expectNoChatlyStorage(host)).toThrow(/wrote 2 key\(s\)/);
    expect(clearChatlyStorage(host)).toBe(2);
    expect(() => expectNoChatlyStorage(host)).not.toThrow();
  });

  it('omits a store that was unreadable, so an absent one is not an empty one', () => {
    const host = capturedHost({ localStorage: null, sessionStorage: {} });
    expect(host.localStorage).toBeUndefined();
    // And the kit's safe direction holds: nothing readable means nothing to
    // claim was written.
    expect(() => expectNoChatlyStorage(host)).not.toThrow();
  });

  it('enumerates positionally, so a clear does not skip entries', () => {
    const host = capturedHost({
      localStorage: { 'chatly:a': '1', 'chatly:b': '2', 'chatly:c': '3' },
      sessionStorage: null,
    });
    expect(clearChatlyStorage(host)).toBe(3);
    expect(findChatlyStorage(host)).toEqual([]);
  });
});

describe('CHATLY_STORAGE_SNAPSHOT_SOURCE', () => {
  /** A `Storage`-shaped double, which is all the source reads. */
  const store = (entries: Record<string, string>) => {
    const keys = Object.keys(entries);
    return {
      get length() {
        return keys.length;
      },
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => entries[k] ?? null,
    };
  };

  it('evaluates to a snapshot of both stores', () => {
    /*
     * The one test that RUNS the source rather than reading it. A direct
     * `eval` sees this function's scope, so the `window` below is the one the
     * source resolves — which is as close as a Node process gets to a page,
     * and close enough to catch the two mistakes that matter: a STATEMENT
     * where an expression is needed (`page.evaluate` wraps what it is given,
     * so a `const` or a function declaration would return nothing), and an
     * unguarded read.
     */
    const window = {
      localStorage: store({ 'chatly:vr:pub_1': '{}' }),
      sessionStorage: store({}),
    };
    expect(window.localStorage.length).toBe(1);
    expect(readChatlyStorageSnapshot(eval(CHATLY_STORAGE_SNAPSHOT_SOURCE))).toEqual({
      localStorage: { 'chatly:vr:pub_1': '{}' },
      sessionStorage: {},
    });
  });

  it('answers null for a store whose ACCESS throws', () => {
    // Reading `window.localStorage` itself throws in a private window, on an
    // opaque origin, and with site data blocked — the trap this repo has
    // already paid for with eleven unguarded reads. A `getItem` guard alone
    // would not survive it.
    const window = {
      get localStorage(): never {
        throw new Error('site data blocked');
      },
      sessionStorage: null,
    };
    expect(() => window.localStorage).toThrow(/site data blocked/);
    expect(readChatlyStorageSnapshot(eval(CHATLY_STORAGE_SNAPSHOT_SOURCE))).toEqual({
      localStorage: null,
      sessionStorage: null,
    });
  });
});
