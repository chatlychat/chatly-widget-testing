/**
 * Crossing the page boundary with strings, because a zero-dependency package
 * cannot ship a function into a browser it has no types for.
 *
 * ── The problem ──────────────────────────────────────────────────────────
 *
 * `findChatlyStorage(win)` already answers "what did the widget write", and
 * it is written against `HostWindow` precisely so it can run in jsdom, in
 * `page.evaluate`, or over a captured object. The third of those was in the
 * docblock and had no implementation: there was no way to GET a capture out
 * of a real page, and no way to seed one before the page's own scripts ran.
 *
 * A browser driver can only be handed source TEXT (`page.evaluate('…')`,
 * `page.addInitScript({ content: '…' })`) unless the package bundles a
 * driver's types and serialises a closure. So the two directions are a pair
 * of source strings and one adapter:
 *
 *   seed    → `chatlyStorageSeedSource(entries)`   → `addInitScript`
 *   read    → `CHATLY_STORAGE_SNAPSHOT_SOURCE`     → `evaluate`
 *   assert  → `capturedHost(snapshot)`             → the existing helpers
 *
 * `capturedHost` is the piece that keeps this from becoming a parallel
 * vocabulary: it turns the snapshot into something satisfying `HostWindow`,
 * so `findChatlyStorage`, `expectNoChatlyStorage` and `clearChatlyStorage`
 * work on a real page's storage without knowing a page exists. There is no
 * second "expectNoStorageInSnapshot".
 *
 * ── Every string below is defensive about the SAME thing ─────────────────
 *
 * Reading `localStorage` THROWS — not returns null — in a private window, on
 * an opaque origin, and with site data blocked. An init script that threw
 * would take the whole page's boot with it, and a snapshot expression that
 * threw would fail the integrator's test with a browser error where the
 * answer "there is no readable store" is the correct one. So each access is
 * wrapped, and an unreadable store comes back as absent rather than empty —
 * which is the distinction `readStore` already makes, and which
 * `expectNoChatlyStorage` already reads in the safe direction.
 */
import type { HostWindow, StorageLike } from './host.js';

/** Two plain records, as a page reports its own storage. */
export interface ChatlyStorageSnapshot {
  /** `null` when the store could not be read at all. */
  readonly localStorage: Readonly<Record<string, string>> | null;
  readonly sessionStorage: Readonly<Record<string, string>> | null;
}

/**
 * An expression that evaluates to a `ChatlyStorageSnapshot` in a page.
 *
 * An EXPRESSION and not a statement: `page.evaluate` wraps what it is given,
 * so a `function(){}` declaration or a bare `const` would not return. Written
 * as an IIFE for that reason, and with `var` rather than `const` so it is
 * safe to concatenate into a surrounding scope.
 *
 * It captures the WHOLE store, not just `chatly:` keys. The filtering is
 * `findChatlyStorage`'s job and it enumerates rather than probing a list, for
 * the reason spelled out in `storage.ts`: "nothing of ours is in storage" has
 * to be true of keys this version of the kit has never heard of. Filtering
 * here would reintroduce exactly the blind spot that helper exists to avoid.
 */
export const CHATLY_STORAGE_SNAPSHOT_SOURCE = `(function(){
  function grab(name){
    try {
      var store = window[name];
      if (!store) { return null; }
      var out = {};
      for (var i = 0; i < store.length; i += 1) {
        var key = store.key(i);
        if (key !== null) { out[key] = store.getItem(key); }
      }
      return out;
    } catch (e) { return null; }
  }
  return { localStorage: grab('localStorage'), sessionStorage: grab('sessionStorage') };
})()`;

/**
 * A statement that writes `entries` into a page's storage.
 *
 * For `addInitScript`, which runs before any of the page's own scripts on
 * every navigation — which is the only moment that works. The loader decides
 * whether a visitor is a returning chatter by reading
 * `chatly:vr:<publicId>` as it evaluates, so a key written after navigation
 * is a key written too late, and the assertion "a returning chatter
 * preloads" would fail against a widget that is behaving correctly.
 *
 * One `try` around each write, not one around the loop: a single key the
 * browser refuses (a quota, a blocked origin) must not silently drop the
 * rest of the seed.
 */
export function chatlyStorageSeedSource(
  entries: Readonly<Record<string, string>>,
  store: 'localStorage' | 'sessionStorage' = 'localStorage',
): string {
  const writes = Object.entries(entries)
    .map(
      ([key, value]) =>
        `  try { window.${store}.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); } catch (e) {}`,
    )
    .join('\n');
  return `(function(){\n${writes}\n})();`;
}

/**
 * Whatever `evaluate` returned, narrowed to a snapshot.
 *
 * `evaluate` answers `unknown` — it crossed a process boundary as JSON — and
 * a kit that cast it would be asserting a shape it did not check. An
 * unreadable or unrecognisable store becomes `null`, which every helper
 * downstream already treats as "there is nothing here that could have been
 * written to".
 */
export function readChatlyStorageSnapshot(value: unknown): ChatlyStorageSnapshot {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    localStorage: records(source['localStorage']),
    sessionStorage: records(source['sessionStorage']),
  };
}

function records(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * A `HostWindow` over a captured snapshot.
 *
 * So that a snapshot taken out of a real browser is asserted with the SAME
 * four helpers as a jsdom window: `findChatlyStorage(capturedHost(snap))`,
 * `expectNoChatlyStorage(capturedHost(snap))`. The returned stores are
 * writable and the writes go nowhere but the capture — deliberately, so
 * `clearChatlyStorage` can be used to narrow a capture down without anybody
 * believing it reached the page. Clearing a real page is
 * `evaluate("localStorage.clear()")`, which is the page's business.
 *
 * `key(i)` is positional over a snapshot of `Object.keys`, which matches what
 * a real `Storage` promises (an unspecified but stable order) closely enough
 * for enumeration and is why `clearChatlyStorage` collects before deleting.
 */
export function capturedHost(snapshot: ChatlyStorageSnapshot): HostWindow {
  const host: HostWindow = {};
  if (snapshot.localStorage !== null) {
    host.localStorage = captureStore(snapshot.localStorage);
  }
  if (snapshot.sessionStorage !== null) {
    host.sessionStorage = captureStore(snapshot.sessionStorage);
  }
  return host;
}

function captureStore(entries: Readonly<Record<string, string>>): StorageLike {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
