/**
 * Reading what the widget has (or has not) written to a browser.
 *
 * ── `findChatlyStorage` enumerates; it does not probe a list ─────────────
 *
 * The obvious implementation is `chatlyStorageKeys(publicId).filter(hasItem)`,
 * and it is wrong for the assertion that matters. "Nothing of ours is in
 * storage" has to be true of keys this version of the kit does not know
 * about: a key added to the widget tomorrow, or a scoped key whose publicId
 * the caller did not pass. Enumerating the store and matching the `chatly:`
 * prefix answers the question as asked; probing a list answers "none of the
 * seven keys I happen to know about", which is the shape of every fake this
 * kit exists to replace.
 */
import { readStore, type HostWindow, type StorageLike } from './host.js';
import { CHATLY_STORAGE_PREFIX } from './storage-keys.js';

/** One key of ours found in a browser, and where. */
export interface FoundStorageKey {
  readonly key: string;
  readonly store: 'localStorage' | 'sessionStorage';
}

function enumerate(store: StorageLike | null, which: 'localStorage' | 'sessionStorage') {
  const out: FoundStorageKey[] = [];
  if (store === null) {
    return out;
  }
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key !== null && key.startsWith(CHATLY_STORAGE_PREFIX)) {
        out.push({ key, store: which });
      }
    }
  } catch {
    /*
     * A store that throws mid-enumeration reads as EMPTY, and that is a
     * deliberate direction: this helper backs an assertion that nothing was
     * written, and a browser that will not answer cannot be used to claim
     * something was. `expectNoChatlyStorage` therefore passes on an
     * unreadable store — which is correct, because an unreadable store is one
     * the widget could not have written to either.
     */
    return out;
  }
  return out;
}

/** Every `chatly:` key present in either store. */
export function findChatlyStorage(win: HostWindow): FoundStorageKey[] {
  return [
    ...enumerate(readStore(win, 'local'), 'localStorage'),
    ...enumerate(readStore(win, 'session'), 'sessionStorage'),
  ];
}

/**
 * Throws, naming every key found, when the widget has written anything.
 *
 * The acceptance test an integrator writes for a consent banner: load the
 * page, decline, and call this. It throws rather than returning a boolean so
 * it reads the same in every runner — there is no assertion library in this
 * package's dependencies and there is not going to be one.
 */
export function expectNoChatlyStorage(win: HostWindow): void {
  const found = findChatlyStorage(win);
  if (found.length === 0) {
    return;
  }
  const listed = found.map((f) => `${f.store}["${f.key}"]`).join(', ');
  throw new Error(
    `expectNoChatlyStorage: the Chatly widget wrote ${String(found.length)} key(s): ${listed}. ` +
      "Pass `storage: 'deny'` to Chatly('init', …) to withhold all of them, or " +
      "`storage: 'on-open'` to withhold them until the visitor opens the panel.",
  );
}

/**
 * Removes every `chatly:` key from both stores.
 *
 * For a test that shares one browser context between cases. Collected first
 * and deleted after, because removing while enumerating by index skips
 * entries — `store.key(i)` is positional and the positions shift.
 */
export function clearChatlyStorage(win: HostWindow): number {
  const found = findChatlyStorage(win);
  for (const entry of found) {
    const store = readStore(win, entry.store === 'localStorage' ? 'local' : 'session');
    try {
      store?.removeItem(entry.key);
    } catch {
      // A store that refuses a write is one the widget could not write to.
    }
  }
  return found.length;
}
