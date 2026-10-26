/**
 * A `RouteHost` with no browser behind it.
 *
 * ── Why this ships rather than living in a spec ──────────────────────────
 *
 * Two reasons, and the second is the better one.
 *
 * This package cannot depend on a browser driver, so the only way its own
 * fixture can be tested is against a double — and a double that lives in a
 * spec file is a double nobody else can use. An integrator wiring
 * `installChatlyEmbed` into a harness of their own has exactly the same
 * problem we do: they want to know their route patterns match before they pay
 * for a browser. So it is exported.
 *
 * And it is the honest answer to "how do you know the fixture works". The
 * recorder replays a request through the registered handlers and reports what
 * came back, so every assertion about the fixture's BEHAVIOUR — this path is
 * answered from the wire fixture, that one is passed through to the network,
 * this one was never routed at all — is made against the same code a real
 * `Page` would run. What it cannot prove is that Playwright calls it the way
 * we think; that is `route-host.spec.ts`'s job, and the two together are the
 * whole of the claim.
 *
 * ── The glob, and why it is reimplemented ────────────────────────────────
 *
 * Playwright matches a string `url` as a glob, not a substring. The recorder
 * has to mean the same thing by a pattern as a real `Page` does or it would
 * agree with a pattern that matches nothing in a browser — the exact shape of
 * "a fake transport that answers every route agrees with whatever you asked
 * for", which has cost this repo two shipped SDK bugs. `*` stops at a `/`,
 * `**` does not, `?` is one non-slash character, and everything else is
 * literal. `route-recorder.spec.ts` self-tests that against a specimen of
 * each, including a negative, because a matcher that matched EVERYTHING would
 * make every fixture test below trivially pass.
 */
import type { RouteFulfillment, RouteHandler, RouteHost, RouteLike } from './route-host.js';

/** A request to push through the registered handlers. */
export interface RecorderRequest {
  readonly url: string;
  readonly method?: string;
  readonly postData?: string | null;
}

/** What a handler did with it. */
export interface RecorderOutcome {
  readonly kind: 'fulfilled' | 'continued' | 'aborted' | 'unrouted';
  /** The response the handler built, on `fulfilled`. */
  readonly response?: RouteFulfillment;
  /** The code passed to `abort`, on `aborted`. */
  readonly errorCode?: string;
  /** The pattern whose handler took it, on anything but `unrouted`. */
  readonly pattern?: string;
}

export interface RouteRecorder extends RouteHost {
  route(pattern: string, handler: RouteHandler): Promise<void>;
  addInitScript(script: { content: string }): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  goto(url: string): Promise<unknown>;
  /** Push one request through the handlers, newest pattern first. */
  deliver(request: RecorderRequest): Promise<RecorderOutcome>;
  /** Every pattern registered, in registration order. */
  readonly patterns: readonly string[];
  /** Every init script's source, in registration order. */
  readonly initScripts: readonly string[];
  /** Every expression passed to `evaluate`, in order. */
  readonly evaluated: readonly string[];
  /** Every url passed to `goto`, in order. */
  readonly navigations: readonly string[];
  /** What `evaluate` should answer. Returns `undefined` until set. */
  onEvaluate(answer: (expression: string) => unknown): void;
}

/**
 * `*` → one path segment, `**` → anything, `?` → one non-slash character.
 *
 * Deliberately NOT anchored with a trailing `.*`: a pattern has to match the
 * WHOLE url, which is what Playwright does and is what makes
 * `https://api.chatlychat.com/**` mean "that host" rather than "any url
 * containing that host".
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch !== undefined && /[\\^$.|+()[\]{}]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch ?? '';
    }
  }
  return new RegExp(`^${out}$`);
}

/** A `RouteHost` that records instead of driving a browser. */
export function createRouteRecorder(): RouteRecorder {
  const registered: { pattern: string; matcher: RegExp; handler: RouteHandler }[] = [];
  const initScripts: string[] = [];
  const evaluated: string[] = [];
  const navigations: string[] = [];
  let answer: (expression: string) => unknown = () => undefined;

  const recorder: RouteRecorder = {
    route(pattern, handler) {
      registered.push({ pattern, matcher: globToRegExp(pattern), handler });
      return Promise.resolve();
    },
    addInitScript(script) {
      initScripts.push(script.content);
      return Promise.resolve();
    },
    evaluate(expression) {
      evaluated.push(expression);
      return Promise.resolve(answer(expression));
    },
    goto(url) {
      navigations.push(url);
      return Promise.resolve(null);
    },
    async deliver(request) {
      const method = request.method ?? 'GET';
      const postData = request.postData ?? null;
      /*
       * REVERSE registration order, which is Playwright's rule: the handler
       * registered last sees the request first. The fixture's own patterns do
       * not overlap, so this changes nothing for it — it is here so that an
       * integrator who adds a narrower route of their own AFTER installing
       * the fixture gets the behaviour they will get in a browser.
       */
      for (let i = registered.length - 1; i >= 0; i -= 1) {
        const entry = registered[i];
        if (entry === undefined || !entry.matcher.test(request.url)) {
          continue;
        }
        let outcome: RecorderOutcome = { kind: 'continued', pattern: entry.pattern };
        const route: RouteLike = {
          request: () => ({
            url: () => request.url,
            method: () => method,
            postData: () => postData,
          }),
          fulfill(response) {
            outcome = { kind: 'fulfilled', response, pattern: entry.pattern };
            return Promise.resolve();
          },
          continue() {
            outcome = { kind: 'continued', pattern: entry.pattern };
            return Promise.resolve();
          },
          abort(errorCode) {
            outcome = {
              kind: 'aborted',
              ...(errorCode === undefined ? {} : { errorCode }),
              pattern: entry.pattern,
            };
            return Promise.resolve();
          },
        };
        await entry.handler(route);
        return outcome;
      }
      return { kind: 'unrouted' };
    },
    patterns: [],
    initScripts,
    evaluated,
    navigations,
    onEvaluate(next) {
      answer = next;
    },
  };

  /*
   * `patterns` is a live view rather than the array itself, so a caller
   * cannot push a pattern that has no handler behind it — which would read
   * as a registered route and match nothing.
   */
  Object.defineProperty(recorder, 'patterns', {
    get: () => registered.map((r) => r.pattern),
    enumerable: true,
  });

  return recorder;
}
