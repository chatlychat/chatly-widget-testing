/**
 * The structural slice of a BROWSER DRIVER this kit needs, and nothing else.
 *
 * ── Why hand-written interfaces and not `import type { Page }` ───────────
 *
 * `@playwright/test` is a dependency, and this package has none and is going
 * to keep having none (CLAUDE.md §2: no new dependency without approval). It
 * is also the wrong shape of promise to make: an integrator on Puppeteer, or
 * on a harness of their own, has the same four acceptance assertions to make
 * and nothing about them is Playwright-specific.
 *
 * So this file does to the driver what `host.ts` does to the browser — names
 * the four methods the fixture calls and takes them as an argument. A
 * Playwright `Page`, a Playwright `BrowserContext`, a Puppeteer page with a
 * thin shim, and `createRouteRecorder()` from this package all satisfy
 * `RouteHost`, and none of them is imported here.
 *
 * ── How the shapes below are kept honest ─────────────────────────────────
 *
 * By hand-matching them to Playwright's own `types.d.ts` and then PINNING
 * that match: `route-host.spec.ts` reads playwright-core's declaration file
 * off disk (the same trick `parity.spec.ts` uses on `widget-api.ts`) and
 * fails if any signature this file was written against has moved. Structural
 * typing against a package you do not depend on is only safe while something
 * notices the drift, and a kit whose whole argument is "it cannot drift from
 * the real thing" does not get to make an exception for its own driver.
 *
 * Three facts about those signatures that the shapes below depend on:
 *
 *  - `Page.route(url, handler)` takes `string | RegExp | ((url: URL) =>
 *    boolean)`, so declaring `pattern: string` is a narrowing a real `Page`
 *    satisfies. We only ever pass a glob.
 *  - `Route.fulfill(options?)` and `Route.continue(options?)` take their
 *    options OPTIONALLY, so a required parameter here is satisfied by them.
 *  - `Page.evaluate` and `Page.addInitScript` both accept a plain STRING of
 *    source, which is the only form available to a package that cannot ship a
 *    function into a page it has no types for.
 */

/** The request behind an intercepted route. */
export interface RouteRequestLike {
  url(): string;
  method(): string;
  postData(): string | null;
}

/** What the fixture answers an intercepted request with. */
export interface RouteFulfillment {
  status?: number;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * One intercepted request, and the three things that can be done with it.
 *
 * `continue()` is the one that matters most here and is the reason this is
 * not just a response map: letting the REAL bytes through while still seeing
 * that they were asked for is what makes "nothing loaded before click"
 * assertable against the real loader rather than against a stand-in.
 */
export interface RouteLike {
  request(): RouteRequestLike;
  fulfill(response: RouteFulfillment): Promise<void>;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export type RouteHandler = (route: RouteLike) => Promise<void>;

/**
 * The driver the fixture installs onto.
 *
 * `route` is the only required member, so the smallest possible host is an
 * object with one method. The other three are optional because each one is
 * needed by exactly one capability, and the fixture says which when it is
 * missing rather than failing obscurely:
 *
 *  - `addInitScript` — seeding storage BEFORE the page's own scripts run,
 *    which is what "returning chatter preloads" needs. Without it the
 *    fixture hands the caller `initScript()` to inject however they can.
 *  - `evaluate` — reading storage back out of the page, which is what
 *    "signed-out resets" needs.
 *  - `goto` — convenience only. The fixture never navigates on its own; an
 *    integrator's e2e navigates its own app.
 */
export interface RouteHost {
  route(pattern: string, handler: RouteHandler): Promise<void>;
  addInitScript?(script: { content: string }): Promise<void>;
  evaluate?(expression: string): Promise<unknown>;
  goto?(url: string): Promise<unknown>;
}
