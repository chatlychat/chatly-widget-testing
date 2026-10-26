/**
 * A faithful stand-in for the Chatly embed, with no network and no account.
 *
 * ═══ WHAT THIS REPLACES ═══════════════════════════════════════════════════
 *
 * Every integrator who e2e-tests a page with Chatly on it writes the same
 * thirty lines: a `window.Chatly` stub that queues calls, flips a `ready`
 * flag, remembers whether the panel is open, and ignores an `open()` that
 * arrives too early. One of them (Referalli, CHT-D09) wrote it, shipped it,
 * and the behaviour it encoded — "an `open()` before ready is dropped" — had
 * stopped being true of the real widget. Their suite was green against their
 * own fake and told them nothing.
 *
 * So the point of this file is NOT that it is a mock. It is that its
 * behaviour is pinned to the real embed's by tests that read the real
 * sources: `parity.spec.ts` derives the method surface from
 * `packages/sdk-js/src/widget-api.ts` and the storage keys from
 * `@livechat/shared`'s manifest, and fails in either direction.
 *
 * ═══ THE THREE BEHAVIOURS WORTH BEING EXACT ABOUT ═════════════════════════
 *
 *  1. **A call before load is QUEUED, not dropped.** The real snippet is
 *     `w.Chatly = w.Chatly || function(){ (w.Chatly.q = w.Chatly.q||[]).push(arguments) }`
 *     and the bundle replays `q` on boot. So `Chatly('open')` fired from a
 *     React effect that runs before the async loader tag finishes DOES open
 *     the panel, eventually. A fake that dropped it taught its author to add
 *     a `setTimeout` they did not need.
 *
 *  2. **`q` is EMPTIED on replay.** This is NCH-06, and it is the half that
 *     bites: a replay that leaves the queue in place makes a later `destroy()`
 *     + re-`init()` replay every call the page has ever made, so one
 *     `startConversation()` becomes three.
 *
 *  3. **`hasSession()` answers BEFORE the bundle exists.** The real loader
 *     assigns it on the shim unconditionally and it reads
 *     `chatly:vr:<publicId>` — the same key the loaded bundle reads — so a
 *     host in manual mode can decide whether to load at all. A fake that only
 *     had it after `ready` could not test that decision.
 *
 * ═══ WHAT IT DELIBERATELY DOES NOT DO ════════════════════════════════════
 *
 * No network, no rendering, no DOM. It does not draw a launcher or a panel,
 * so it cannot answer "is the panel 372px wide" — that is what
 * `apps/widget/scripts/dist-smoke.mjs` does against a real Chromium, and it
 * is not a thing an integrator can run. What this answers is the integration
 * contract: what the page called, in what order, what the embed's state
 * became, and what landed in storage.
 */
import { readStore, type HostWindow } from './host.js';
import { isChatlyMethod, type ChatlyMethod } from './surface.js';

/** One invocation, exactly as the page made it. */
export interface ChatlyCall {
  readonly method: string;
  readonly args: readonly unknown[];
  /** True when the call was replayed off the queue rather than made live. */
  readonly queued: boolean;
}

/** The identity the page last asserted, or `null` after a `reset`. */
export interface MockIdentity {
  readonly externalId?: string;
  readonly email?: string;
  readonly name?: string;
  readonly userHash?: string;
}

export interface ChatlyMockState {
  readonly publicId: string | undefined;
  readonly ready: boolean;
  readonly open: boolean;
  /** Which screen `open()` was asked for. `null` while closed. */
  readonly view: 'home' | 'messages' | 'help' | null;
  readonly identity: MockIdentity | null;
  readonly unread: number;
  readonly destroyed: boolean;
  /** `init`'s `storage` option, which decides whether anything is written. */
  readonly storage: 'allow' | 'deny' | 'on-open';
  readonly locale: string | undefined;
  readonly labels: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly tracked: readonly { readonly name: string; readonly properties?: unknown }[];
}

export interface ChatlyMockOptions {
  /**
   * Install and mark ready in one step. Defaults to FALSE, so a test gets the
   * real embed's lifecycle — shim first, bundle later — which is the thing
   * most integrator fakes get wrong.
   */
  readonly ready?: boolean;
  /** Seeds `getUnreadCount()`. */
  readonly unread?: number;
  /** Seeds the identity, as if a previous `identify()` had succeeded. */
  readonly identity?: MockIdentity;
  /**
   * Seeds `hasSession()` to true by writing `chatly:vr:<publicId>`, which is
   * how the real loader recognises a returning chatter. Needs a `publicId`
   * and a readable `localStorage`; without either it is ignored, and
   * `returningVisitor` on the mock reports what actually happened.
   */
  readonly returning?: boolean;
  /** `init`'s storage mode, when the test does not pass one to `init`. */
  readonly storage?: 'allow' | 'deny' | 'on-open';
  /** Set when the snippet carries it, as the real one does. */
  readonly publicId?: string;
}

/** The shim the kit installs at `window.Chatly`. */
type Shim = ((...args: unknown[]) => void) & {
  q?: unknown[];
  publicId?: string;
  hasSession?: () => boolean;
};

export interface ChatlyMock {
  /** Every call, in order, live and replayed. */
  readonly calls: readonly ChatlyCall[];
  /** The embed's state after the calls so far. */
  state(): ChatlyMockState;
  /**
   * What the real loader's `onload` does: replay `q` in order, empty it, and
   * dispatch live from here on. Idempotent — the real loader guards its
   * injection the same way, because a hover prefetch and a click can both
   * fire for one visitor.
   */
  load(): void;
  /** Whether `chatly:vr:<publicId>` is present, i.e. a returning chatter. */
  returningVisitor(): boolean;
  /** Calls of one method, for an assertion that does not care about order. */
  callsTo(method: string): readonly ChatlyCall[];
  /** Puts `window.Chatly` back to whatever it was, and clears the state. */
  uninstall(): void;
}

/**
 * Installs the mock onto `win` and returns the handle.
 *
 * It does NOT clear existing `chatly:` storage: a test that wants a clean
 * browser calls `clearChatlyStorage` itself, because silently deleting a
 * caller's fixture is worse than making them ask.
 */
export function installChatlyMock(win: HostWindow, options: ChatlyMockOptions = {}): ChatlyMock {
  const previous = win.Chatly;
  const calls: ChatlyCall[] = [];

  let ready = false;
  let open = false;
  let view: ChatlyMockState['view'] = null;
  let identity: MockIdentity | null = options.identity ?? null;
  let unread = options.unread ?? 0;
  let destroyed = false;
  let storage: ChatlyMockState['storage'] = options.storage ?? 'on-open';
  let locale: string | undefined;
  const labels: string[] = [];
  const attributes: Record<string, unknown> = {};
  const tracked: { name: string; properties?: unknown }[] = [];

  const shim = function chatly(this: void, ...args: unknown[]): void {
    if (!ready) {
      (shim.q = shim.q ?? []).push(args);
      return;
    }
    dispatch(args, false);
  } as Shim;
  shim.publicId = options.publicId;

  /** `chatly:<name>:<publicId>`, or null when there is no public id. */
  const scopedKey = (name: string): string | null =>
    shim.publicId === undefined || shim.publicId.length === 0
      ? null
      : `chatly:${name}:${shim.publicId}`;

  const write = (name: string, value: string): void => {
    /*
     * `'deny'` withholds everything and `'on-open'` withholds it until the
     * panel has been opened, which is the real widget's default since
     * 2026-10-19. A key whose trigger fired while storage is withheld is held
     * in page memory and written when consent arrives — or never. This mock
     * takes the simpler half of that promise: it does not write, and it does
     * not back-fill on consent, because a test asserting "nothing was
     * written" is the case the kit exists for and a test asserting the
     * back-fill would be asserting this mock rather than the widget.
     */
    if (storage === 'deny' || (storage === 'on-open' && !open)) {
      return;
    }
    const key = scopedKey(name);
    const store = readStore(win, 'local');
    if (key === null || store === null) {
      return;
    }
    try {
      store.setItem(key, value);
    } catch {
      // Blocked site data. The widget survives it and so does this.
    }
  };

  const drop = (name: string): void => {
    const key = scopedKey(name);
    const store = readStore(win, 'local');
    if (key === null || store === null) {
      return;
    }
    try {
      store.removeItem(key);
    } catch {
      // As above.
    }
  };

  function dispatch(args: readonly unknown[], queued: boolean): void {
    const method = typeof args[0] === 'string' ? args[0] : '';
    const rest = args.slice(1);
    if (!isChatlyMethod(method)) {
      /*
       * REFUSED, not swallowed. The real embed ignores an unknown method and
       * that silence is the single most expensive thing about it: a typo'd
       * `setLable` queues, replays, matches nothing, and the label simply
       * never arrives. See `surface.ts`.
       */
      throw new Error(
        `Chatly(${JSON.stringify(args[0])}) is not a method of the Chatly embed. ` +
          'The real widget ignores an unknown method silently, which is why this kit does ' +
          "not. Check the spelling against @chatlychat/sdk-js's `ChatlyApi`.",
      );
    }
    calls.push({ method, args: rest, queued });
    apply(method, rest);
  }

  function apply(method: ChatlyMethod, args: readonly unknown[]): void {
    const first = args[0];
    switch (method) {
      case 'init': {
        const opts = (typeof first === 'object' && first !== null ? first : {}) as Record<
          string,
          unknown
        >;
        if (typeof opts['publicId'] === 'string') {
          shim.publicId = opts['publicId'];
        }
        const mode = opts['storage'];
        if (mode === 'allow' || mode === 'deny' || mode === 'on-open') {
          storage = mode;
        }
        destroyed = false;
        // The session token the server would mint. Its trigger is
        // `session-start`, so it is subject to the storage mode like the rest.
        write('vt', 'mock-visitor-token');
        return;
      }
      case 'open': {
        open = true;
        view =
          first === 'messages' || first === 'help' || first === 'home'
            ? first
            : typeof first === 'object' && first !== null
              ? 'messages'
              : 'home';
        return;
      }
      case 'close': {
        open = false;
        view = null;
        return;
      }
      case 'toggle': {
        const wanted =
          first === 'open' || first === true
            ? true
            : first === 'close' || first === false
              ? false
              : !open;
        if (wanted) {
          apply('open', []);
        } else {
          apply('close', []);
        }
        return;
      }
      case 'identify':
      case 'setUser': {
        const next: MockIdentity =
          method === 'setUser'
            ? {
                ...(typeof first === 'string' ? { externalId: first } : {}),
                ...((args[1] ?? {}) as MockIdentity),
              }
            : ((typeof first === 'object' && first !== null ? first : {}) as MockIdentity);
        identity = next;
        if (typeof next.externalId === 'string') {
          write('xid', next.externalId);
        }
        if (typeof next.userHash === 'string') {
          write('vh', next.userHash);
        }
        return;
      }
      case 'reset': {
        /*
         * The whole reason `reset()` exists on the real embed: a sign-out must
         * not leave the next visitor identified as the last one. So the
         * identity goes AND the two keys that carry it do, regardless of the
         * storage mode — withholding a write is a privacy choice, and
         * refusing to delete would be the opposite of one.
         */
        identity = null;
        drop('xid');
        drop('vh');
        return;
      }
      case 'destroy': {
        destroyed = true;
        open = false;
        view = null;
        return;
      }
      case 'setLocale': {
        if (typeof first === 'string') {
          locale = first;
        }
        return;
      }
      case 'setLabel': {
        if (typeof first === 'string' && !labels.includes(first)) {
          labels.push(first);
        }
        return;
      }
      case 'removeLabel': {
        const at = typeof first === 'string' ? labels.indexOf(first) : -1;
        if (at !== -1) {
          labels.splice(at, 1);
        }
        return;
      }
      case 'setCustomAttributes': {
        if (typeof first === 'object' && first !== null) {
          Object.assign(attributes, first);
        }
        return;
      }
      case 'deleteCustomAttribute': {
        if (typeof first === 'string') {
          delete attributes[first];
        }
        return;
      }
      case 'track': {
        if (typeof first === 'string') {
          tracked.push({ name: first, properties: args[1] });
        }
        return;
      }
      case 'setStorageConsent': {
        if (first === 'allow' || first === 'deny' || first === 'on-open') {
          storage = first;
        }
        return;
      }
      case 'startConversation': {
        open = true;
        view = 'messages';
        return;
      }
      default: {
        /*
         * Recorded and otherwise inert: `mount`, `unmount`, `on`, `off`,
         * `dismiss`, `setTheme`, `setOffset`, `setConsent`, `setContext`, `reportAction`,
         * `registerPushToken`, `getUnreadCount`, `hasSession`.
         *
         * Deliberately not modelled rather than modelled badly. A kit that
         * pretended to implement `setTheme` would invite an assertion about
         * rendering it cannot support, and `calls` already answers the only
         * question it honestly can: did the page call it, with what.
         */
        return;
      }
    }
  }

  shim.hasSession = () => {
    const key = scopedKey('vr');
    const store = readStore(win, 'local');
    if (key === null || store === null) {
      return false;
    }
    try {
      return store.getItem(key) !== null;
    } catch {
      return false;
    }
  };

  if (options.returning === true) {
    const key = scopedKey('vr');
    const store = readStore(win, 'local');
    try {
      if (key !== null && store !== null) {
        store.setItem(key, JSON.stringify({ mock: Date.now() }));
      }
    } catch {
      // `returningVisitor()` reports what actually happened.
    }
  }

  win.Chatly = shim;

  const mock: ChatlyMock = {
    calls,
    state: () => ({
      publicId: shim.publicId,
      ready,
      open,
      view,
      identity,
      unread,
      destroyed,
      storage,
      locale,
      labels: [...labels],
      attributes: { ...attributes },
      tracked: [...tracked],
    }),
    load() {
      if (ready) {
        return;
      }
      ready = true;
      /*
       * SPLICED OUT, not iterated and left in place. This is NCH-06: a replay
       * that leaves `q` populated makes a later `destroy()` + re-`init()`
       * replay the page's entire history, so one `startConversation()`
       * becomes three. Taking the entries off the array before dispatching
       * also means a call MADE DURING replay (an `on('ready')` handler that
       * calls `open()`) goes through the live path rather than being appended
       * to a queue nothing will read again.
       */
      const pending = shim.q ?? [];
      shim.q = [];
      for (const entry of pending.splice(0, pending.length)) {
        dispatch(Array.isArray(entry) ? entry : Array.from(entry as ArrayLike<unknown>), true);
      }
    },
    returningVisitor: () => shim.hasSession?.() === true,
    callsTo: (method: string) => calls.filter((c) => c.method === method),
    uninstall() {
      if (previous === undefined) {
        delete win.Chatly;
      } else {
        win.Chatly = previous;
      }
      ready = false;
      calls.length = 0;
    },
  };

  if (options.ready === true) {
    mock.load();
  }
  // `unread` is seeded and then read back through the state, so the variable
  // is used even when no call touches it.
  unread = options.unread ?? unread;
  return mock;
}

/** Throws unless the panel is open. */
export function expectPanelOpen(mock: ChatlyMock): void {
  const state = mock.state();
  if (state.open) {
    return;
  }
  throw new Error(
    `expectPanelOpen: the panel is closed. ready=${String(state.ready)}, ` +
      `calls=[${mock.calls.map((c) => c.method).join(', ') || 'none'}]. ` +
      (state.ready
        ? ''
        : 'The embed has not loaded yet — a call before load is QUEUED, not applied, so call ' +
          'mock.load() (what the real loader does on its onload) before asserting.'),
  );
}

/** Throws unless the panel is closed. */
export function expectPanelClosed(mock: ChatlyMock): void {
  const state = mock.state();
  if (!state.open) {
    return;
  }
  throw new Error(
    `expectPanelClosed: the panel is open on the "${String(state.view)}" view, after ` +
      `[${mock.calls.map((c) => c.method).join(', ')}].`,
  );
}
