/**
 * Drive the REAL `loader.js` and `widget.js` in a browser, against a mocked
 * API, with no account and no `allowedOrigins` entry (CHT-D09).
 *
 * ═══ WHAT THIS IS AND WHY IT IS NOT `installChatlyMock` ═══════════════════
 *
 * `installChatlyMock` is a stand-in for the embed: it answers "what did my
 * page call and what did the embed's state become" with no browser at all.
 * This is the other half of CHT-D09, and it is the opposite trade — the embed
 * is the real artifact, byte for byte, and what is faked is the SERVER.
 *
 * The acceptance line is Referalli's: delete `FAKE_WIDGET` and still assert
 * "nothing loaded before click; one click opens; returning chatter preloads;
 * signed-out resets". Three of those four are facts about the loader's lazy
 * mode — which script was fetched, and when — and no stand-in can answer them,
 * because the thing under test is the loader's own decision. The fourth is a
 * fact about what is left in storage after `reset()`.
 *
 * ═══ THE BLOCKER THAT DID NOT SURVIVE ════════════════════════════════════
 *
 * The tracker recorded this half as "cannot be done with no network". It can,
 * and the proof was already in the repository:
 * `apps/widget/scripts/dist-smoke.mjs` boots the minified `widget.js` in
 * Chromium against a loopback stub API and evaluates every deferred chunk. So
 * "real artifact + mocked API + no network" is not merely possible here, it
 * is a check that runs. What that harness cannot do is be USED by an
 * integrator: it serves `apps/widget/dist` off disk, which only exists in
 * this monorepo.
 *
 * So the seam is where the SCRIPT BYTES come from, and both answers are
 * offered because the two callers are genuinely different:
 *
 *  - `scripts: 'network'` (the default) intercepts the script origin and
 *    `continue()`s it. The real CDN bytes arrive — the ones that customer's
 *    visitors are served, including whatever version is live right now — and
 *    the fixture still SEES the request, which is what makes "nothing loaded
 *    before click" assertable. This is the only answer available to an
 *    integrator, who has no `dist/`.
 *  - `scripts: { files }` fulfils them from bytes the caller read off disk.
 *    For us (a pre-release bundle, before it is anywhere), and for an
 *    air-gapped CI that vendors a copy. No network at all.
 *
 * The API is mocked in BOTH modes, which is the part that makes real-origin
 * testing work at all: `allowedOrigins` is enforced by the server, and there
 * is no server. The spec's complaint that "localhost had to be added to
 * production" is answered for tests by never reaching production.
 *
 * ═══ WHAT IT DOES NOT DO ═════════════════════════════════════════════════
 *
 * It does not navigate, does not assert anything about the DOM, and does not
 * serve a host page unless asked. The integrator's own app is the host page —
 * that is the whole point of an e2e — and a snippet generated here would be a
 * THIRD copy of the embed snippet, whose two existing copies are held
 * together by `scripts/check-embed-snippet-parity.mjs`, a gate that cannot
 * see this package. `GET /v1/channels/{publicId}/embed` is the one authority
 * for that string; `page.html` is there for a caller who wants to paste it.
 */
import {
  CHATLY_STORAGE_SNAPSHOT_SOURCE,
  capturedHost,
  chatlyStorageSeedSource,
  readChatlyStorageSnapshot,
} from './page-bridge.js';
import { expectNoChatlyStorage, findChatlyStorage } from './storage.js';
import { chatlyWireResponse } from './wire-fixture.js';

import type { ChatlyStorageSnapshot } from './page-bridge.js';
import type { RouteHost, RouteLike } from './route-host.js';
import type { FoundStorageKey } from './storage.js';
import type { ChatlyWireOptions, WireResponse } from './wire-fixture.js';

/** What the embed asked the network for. */
export interface EmbedRequest {
  readonly method: string;
  readonly url: string;
  /** The url's pathname, with its query dropped. */
  readonly path: string;
  readonly kind: 'loader' | 'bundle' | 'chunk' | 'style' | 'api' | 'page' | 'other';
  /** Where the answer came from. */
  readonly served: 'fixture' | 'network' | 'unserved';
}

/** Where the real `loader.js` / `widget.js` bytes come from. */
export type EmbedScriptSource =
  | 'network'
  /**
   * Published path → file contents. `'widget.js'`, `'loader.js'`,
   * `'widget-engine.js'` and the other deferred chunks, keyed exactly as the
   * loader asks for them. The query string the loader appends
   * (`widget.js?v=<buildId>`) is dropped before the lookup, so a caller never
   * has to know the build id.
   */
  | { readonly files: Readonly<Record<string, string>> };

export interface ChatlyEmbedOptions extends ChatlyWireOptions {
  /** The channel's public id. Scoped storage keys are built from it. */
  readonly publicId: string;
  /** Default `'network'`. */
  readonly scripts?: EmbedScriptSource;
  /** Default `https://api.chatlychat.com`. */
  readonly apiOrigin?: string;
  /**
   * Default `https://widget.chatlychat.com`, which is where the dashboard's
   * snippet points and from which the bundle derives the API origin
   * (`widget.` → `api.`, see `apps/widget/src/api-origin.ts`). Override both
   * together or the bundle will talk to a host nothing is intercepting.
   */
  readonly scriptOrigin?: string;
  /**
   * A host page to serve, for a caller who has no app to navigate to. The
   * `html` is served verbatim — the fixture writes no snippet of its own.
   */
  readonly page?: { readonly url: string; readonly html: string };
  /**
   * Browser storage to write BEFORE the page's own scripts run. Needs
   * `host.addInitScript`; without it the fixture throws rather than quietly
   * seeding nothing, and `initScript()` is the manual route.
   */
  readonly seed?: {
    /**
     * Write `chatly:vr:<publicId>`, the key the loader reads to recognise a
     * returning chatter (`hasStoredThread` in `apps/widget-loader/src/lazy.ts`
     * checks only that it is PRESENT). In every lazy mode but `'manual'` that
     * makes the loader fetch the bundle with no interaction at all, which is
     * the "returning chatter preloads" assertion.
     *
     * The value written is `{}` — a real, parseable watermark map with no
     * thread seen in it. The widget's unread module reads the same key.
     */
    readonly returning?: boolean;
    /** Write `chatly:xid:<publicId>`, as a previous `identify()` would. */
    readonly externalId?: string;
    /** Anything else, by literal key. */
    readonly entries?: Readonly<Record<string, string>>;
  };
  /**
   * Answer a request before the wire fixture sees it. Return `null` or
   * `undefined` to fall through.
   *
   * This is the escape hatch for everything `wire-fixture.ts` deliberately
   * does not model — it holds no state, so a posted message does not come
   * back in a later list. A caller who needs that owns it here and knows
   * they do.
   */
  readonly respond?: (request: {
    readonly path: string;
    readonly method: string;
    readonly url: string;
    readonly postData: string | null;
  }) => WireResponse | null | undefined;
}

export interface ChatlyEmbedFixture {
  /** Every intercepted request, in order. */
  readonly requests: readonly EmbedRequest[];
  /** `loader.js`, `widget.js` and the deferred chunks. */
  scriptRequests(): readonly EmbedRequest[];
  /** `/v1/widget/*` and anything else on the API origin. */
  apiRequests(): readonly EmbedRequest[];
  /** Whether `widget.js` itself has been fetched. */
  bundleRequested(): boolean;
  /** Whether `loader.js` has been fetched. */
  loaderRequested(): boolean;
  /** Throws, listing what WAS requested, unless `widget.js` was fetched. */
  expectBundleRequested(why?: string): void;
  /** Throws, naming the request, if `widget.js` was fetched. */
  expectBundleNotRequested(why?: string): void;
  /** The page's two stores, read through `host.evaluate`. */
  storage(): Promise<ChatlyStorageSnapshot>;
  /** Every `chatly:` key the page currently holds. */
  chatlyStorage(): Promise<FoundStorageKey[]>;
  /** Throws, naming every key, if the embed has written anything. */
  expectNoStorage(): Promise<void>;
  /**
   * The seed as one source string, for a host with no `addInitScript`.
   * Empty when nothing was asked for.
   */
  initScript(): string;
  /** Forget the request log. For asserting about one phase of a test. */
  reset(): void;
}

const JSON_HEADERS: Readonly<Record<string, string>> = {
  /*
   * Permissive CORS on every answer, and an OPTIONS arm below.
   *
   * The embed is cross-origin by construction — the page is the customer's
   * host and the API is ours — so every POST the widget makes is preflighted,
   * and a fulfilled response with no `access-control-allow-*` is a response
   * the browser refuses to show the page. The failure looks nothing like a
   * CORS problem from inside the test: the widget's fetch rejects, the panel
   * renders its offline state, and the only trace is a console message the
   * harness may not be reading.
   */
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-max-age': '0',
};

/**
 * The pathname of a url, parsed by hand.
 *
 * `new URL()` is not available here: `tsconfig.src.json` builds with
 * `lib: ["ES2022"]` and `types: []`, and `URL` is a DOM/Node global rather
 * than an ES one. That restriction is the package's DOM-free proof and is
 * worth more than the convenience — this kit is evaluated inside pages, in
 * jsdom and in bare Node, and a global it assumed would be the one thing
 * missing in whichever of the three nobody tried.
 *
 * Deliberately lenient: a string with no scheme is treated as already being
 * a path, and anything unparseable comes back whole so that it is still
 * LOGGED rather than dropped. A request the fixture cannot classify is still
 * a request the integrator may need to see.
 */
export function pathOf(url: string): string {
  const scheme = url.indexOf('://');
  const start = scheme === -1 ? 0 : scheme + 3;
  const slash = url.indexOf('/', start);
  const path = slash === -1 ? '/' : url.slice(slash);
  let end = path.length;
  for (const mark of ['?', '#']) {
    const at = path.indexOf(mark);
    if (at !== -1 && at < end) {
      end = at;
    }
  }
  return path.slice(0, end);
}

/**
 * Which artifact a script path is.
 *
 * By exact filename, never by prefix. `widget.js` is the first-paint bundle
 * and `widget-engine.js` is a deferred chunk, and the whole of the "nothing
 * loaded before click" assertion is about telling those two apart — a
 * `startsWith('widget')` would collapse them and make the assertion pass
 * against a loader that had fetched everything.
 */
export function classifyScript(path: string): EmbedRequest['kind'] {
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (file === 'loader.js') {
    return 'loader';
  }
  if (file === 'widget.js') {
    return 'bundle';
  }
  if (file.endsWith('.css')) {
    return 'style';
  }
  if (/^widget-[a-z]+\.js$/.test(file)) {
    return 'chunk';
  }
  return 'other';
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.css')) {
    return 'text/css';
  }
  if (path.endsWith('.html')) {
    return 'text/html';
  }
  return 'text/javascript';
}

/** Installs the fixture's routes onto `host`. */
export async function installChatlyEmbed(
  host: RouteHost,
  options: ChatlyEmbedOptions,
): Promise<ChatlyEmbedFixture> {
  const apiOrigin = (options.apiOrigin ?? 'https://api.chatlychat.com').replace(/\/$/, '');
  const scriptOrigin = (options.scriptOrigin ?? 'https://widget.chatlychat.com').replace(/\/$/, '');
  const scripts = options.scripts ?? 'network';
  const requests: EmbedRequest[] = [];

  const log = (route: RouteLike, kind: EmbedRequest['kind'], served: EmbedRequest['served']) => {
    const request = route.request();
    const url = request.url();
    requests.push({ method: request.method(), url, path: pathOf(url), kind, served });
  };

  await host.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const url = request.url();
    const path = pathOf(url);
    const method = request.method();
    log(route, 'api', 'fixture');
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...JSON_HEADERS } });
      return;
    }
    const override = options.respond?.({ path, method, url, postData: request.postData() });
    const answer: WireResponse = override ??
      chatlyWireResponse(path, options) ?? {
        /*
         * `{ ok: true }` for everything unmodelled, the same choice
         * `dist-smoke-stub.mjs` makes. The widget fires a dozen small
         * acknowledged POSTs whose bodies it never reads, and failing them
         * would fill the integrator's console with errors that look like widget
         * defects.
         */
        status: 200,
        body: { ok: true },
      };
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      headers: { ...JSON_HEADERS },
      body: JSON.stringify(answer.body),
    });
  });

  await host.route(`${scriptOrigin}/**`, async (route) => {
    const path = pathOf(route.request().url());
    const kind = classifyScript(path);
    if (scripts === 'network') {
      log(route, kind, 'network');
      await route.continue();
      return;
    }
    const file = path.replace(/^\//, '');
    const body = scripts.files[file];
    if (body === undefined) {
      /*
       * A 404 with a NAMED body, not an abort.
       *
       * An aborted script is indistinguishable from an ad blocker, which is a
       * case the loader is built to survive quietly — so the test would see a
       * widget that simply never appeared and no reason why. A 404 whose body
       * says which file was missing puts the answer in the one place the
       * integrator is already looking.
       */
      log(route, kind, 'unserved');
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: `@chatlychat/widget-testing: no fixture file for "${file}". Pass it in scripts.files.`,
      });
      return;
    }
    log(route, kind, 'fixture');
    await route.fulfill({ status: 200, contentType: contentTypeFor(path), body });
  });

  if (options.page !== undefined) {
    const { url, html } = options.page;
    await host.route(url, async (route) => {
      log(route, 'page', 'fixture');
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
  }

  const seedEntries: Record<string, string> = {};
  if (options.seed?.returning === true) {
    seedEntries[`chatly:vr:${options.publicId}`] = '{}';
  }
  if (options.seed?.externalId !== undefined) {
    seedEntries[`chatly:xid:${options.publicId}`] = options.seed.externalId;
  }
  Object.assign(seedEntries, options.seed?.entries ?? {});
  const seedSource =
    Object.keys(seedEntries).length === 0 ? '' : chatlyStorageSeedSource(seedEntries);

  if (seedSource !== '') {
    if (host.addInitScript === undefined) {
      /*
       * Refused, not skipped. A seed that silently did not happen turns
       * "returning chatter preloads" into a test that fails against a correct
       * loader, and the integrator would go looking in the widget.
       */
      throw new Error(
        'installChatlyEmbed: `seed` needs a host with addInitScript (a Playwright Page or ' +
          'BrowserContext has one). Without it, call fixture.initScript() and inject it ' +
          "yourself before the page's own scripts run — a key written after navigation is " +
          'a key the loader has already read past.',
      );
    }
    await host.addInitScript({ content: seedSource });
  }

  const evaluate = async (expression: string): Promise<unknown> => {
    if (host.evaluate === undefined) {
      throw new Error(
        'installChatlyEmbed: reading the page back needs a host with evaluate (a Playwright ' +
          'Page has one). Use CHATLY_STORAGE_SNAPSHOT_SOURCE with whatever your driver ' +
          'offers, then readChatlyStorageSnapshot() and capturedHost() to assert on it.',
      );
    }
    return host.evaluate(expression);
  };

  const describe = (): string => {
    if (requests.length === 0) {
      return 'no requests were intercepted at all';
    }
    return requests.map((r) => `${r.kind}:${r.path} (${r.served})`).join(', ');
  };

  const fixture: ChatlyEmbedFixture = {
    requests,
    scriptRequests: () =>
      requests.filter(
        (r) =>
          r.kind === 'loader' || r.kind === 'bundle' || r.kind === 'chunk' || r.kind === 'style',
      ),
    apiRequests: () => requests.filter((r) => r.kind === 'api'),
    bundleRequested: () => requests.some((r) => r.kind === 'bundle'),
    loaderRequested: () => requests.some((r) => r.kind === 'loader'),
    expectBundleRequested(why) {
      if (fixture.bundleRequested()) {
        return;
      }
      throw new Error(
        `expectBundleRequested: widget.js was never fetched${why === undefined ? '' : ` (${why})`}. ` +
          `Intercepted: ${describe()}. ` +
          'In lazy mode the bundle is fetched on hover, click, a queued open/toggle/load, or ' +
          'for a returning chatter — and `lazy: "manual"` fetches for none of those.',
      );
    },
    expectBundleNotRequested(why) {
      const hit = requests.find((r) => r.kind === 'bundle');
      if (hit === undefined) {
        return;
      }
      throw new Error(
        `expectBundleNotRequested: widget.js WAS fetched (${hit.url})` +
          `${why === undefined ? '' : ` (${why})`}. ` +
          'Lazy mode fetches eagerly for a returning chatter, so check that no `chatly:vr:` ' +
          'key is seeded, and that the embed set Chatly.lazy before loader.js ran — it is ' +
          'read once, as the loader evaluates.',
      );
    },
    async storage() {
      return readChatlyStorageSnapshot(await evaluate(CHATLY_STORAGE_SNAPSHOT_SOURCE));
    },
    async chatlyStorage() {
      return findChatlyStorage(capturedHost(await fixture.storage()));
    },
    async expectNoStorage() {
      expectNoChatlyStorage(capturedHost(await fixture.storage()));
    },
    initScript: () => seedSource,
    reset() {
      requests.length = 0;
    },
  };

  return fixture;
}
