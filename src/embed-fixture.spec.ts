/**
 * The embed fixture, driven by `createRouteRecorder` with no browser.
 *
 * ═══ WHAT THESE TESTS CAN AND CANNOT PROVE ════════════════════════════════
 *
 * They prove the fixture's own behaviour: which patterns it registers, which
 * paths it answers and with what, which it lets through to the network, what
 * it seeds, what it logs, and that each of CHT-D09's four acceptance
 * assertions is EXPRESSIBLE with what it returns. Every one of those is a
 * fact about this package's code, and the recorder runs the same handlers a
 * real `Page` would.
 *
 * They cannot prove that the real loader then behaves as asserted — that the
 * bundle really is withheld until a click, that a seeded `chatly:vr:` key
 * really does make it prefetch. Nothing in a package with no browser can, and
 * claiming otherwise would be the fake-that-agrees-with-the-bug all over
 * again. Those are facts about `apps/widget-loader`, which has its own 1,200
 * lines of specs for them, and the end-to-end proof is the integrator's own
 * suite plus `apps/widget/scripts/dist-smoke.mjs`.
 *
 * The seam between the two is `route-host.spec.ts`, which pins the driver
 * signatures, and the last describe block here, which walks the four
 * assertions in order.
 */
import { describe, expect, it } from 'vitest';

import { classifyScript, installChatlyEmbed, pathOf } from './embed-fixture.js';
import { createRouteRecorder } from './route-recorder.js';
import { WIDGET_FEATURE_DEFAULTS, WIRE_IDS } from './wire-fixture.js';

const PUBLIC_ID = 'pub_live_fixture';
const API = 'https://api.chatlychat.com';
const CDN = 'https://widget.chatlychat.com';

/** Whatever the fixture answered, parsed back out of the fulfillment. */
function jsonBody(body: string | undefined): Record<string, unknown> {
  return JSON.parse(body ?? '{}') as Record<string, unknown>;
}

describe('pathOf', () => {
  it('drops the query, which is where the bundle’s build id lives', () => {
    expect(pathOf(`${CDN}/widget.js?v=abc123`)).toBe('/widget.js');
    expect(pathOf(`${CDN}/widget.js#frag`)).toBe('/widget.js');
  });

  it('handles a bare origin and a path-only string', () => {
    expect(pathOf('https://x.test')).toBe('/');
    expect(pathOf('/widget.js')).toBe('/widget.js');
  });
});

describe('classifyScript', () => {
  it('tells the first-paint bundle apart from a deferred chunk', () => {
    /*
     * The whole of "nothing loaded before click" rests on this distinction. A
     * `startsWith('widget')` would collapse `widget.js` and
     * `widget-engine.js` into one kind and the assertion would pass against a
     * loader that had fetched everything.
     */
    expect(classifyScript('/widget.js')).toBe('bundle');
    expect(classifyScript('/widget-engine.js')).toBe('chunk');
    expect(classifyScript('/widget-commerce.js')).toBe('chunk');
    expect(classifyScript('/loader.js')).toBe('loader');
    expect(classifyScript('/widget-commerce.css')).toBe('style');
    expect(classifyScript('/something-else.png')).toBe('other');
  });
});

describe('the routes it registers', () => {
  it('intercepts the API origin and the script origin, and nothing else', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    expect(recorder.patterns).toEqual([`${API}/**`, `${CDN}/**`]);
  });

  it('adds a page route only when a host page was asked for', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      page: { url: 'https://shop.test/', html: '<!doctype html><title>t</title>' },
    });
    expect(recorder.patterns).toContain('https://shop.test/');
    const outcome = await recorder.deliver({ url: 'https://shop.test/' });
    expect(outcome.response?.contentType).toBe('text/html');
  });

  it('leaves the integrator’s own origin alone', async () => {
    // The default case is an integrator navigating to their OWN dev server.
    // A fixture that intercepted it would be a fixture that broke their app.
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    expect((await recorder.deliver({ url: 'http://localhost:3000/pricing' })).kind).toBe(
      'unrouted',
    );
  });

  it('honours an overridden pair of origins', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      apiOrigin: 'http://localhost:4000/',
      scriptOrigin: 'http://localhost:5174',
    });
    // Trailing slash normalised, so `//**` cannot happen.
    expect(recorder.patterns).toEqual(['http://localhost:4000/**', 'http://localhost:5174/**']);
  });
});

describe('the mocked API', () => {
  it('answers init with the real wire shape and permissive CORS', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    const outcome = await recorder.deliver({ url: `${API}/v1/widget/init`, method: 'POST' });
    expect(outcome.kind).toBe('fulfilled');
    expect(outcome.response?.contentType).toBe('application/json');
    /*
     * The embed is cross-origin by construction, so a fulfillment with no
     * `access-control-allow-origin` is a response the browser refuses to show
     * the page — and the symptom is a widget that renders its offline state
     * rather than anything that mentions CORS.
     */
    expect(outcome.response?.headers?.['access-control-allow-origin']).toBe('*');
    const body = jsonBody(outcome.response?.body);
    expect(Object.keys(body).sort()).toEqual(
      [
        'behavior',
        'branding',
        'copy',
        'features',
        'online',
        'profiles',
        'quickReactions',
        'realtimeUrl',
        'session',
        'workspace',
      ].sort(),
    );
    expect(body['features']).toEqual(WIDGET_FEATURE_DEFAULTS);
  });

  it('answers a preflight without running the wire fixture', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    const outcome = await recorder.deliver({ url: `${API}/v1/widget/init`, method: 'OPTIONS' });
    expect(outcome.response?.status).toBe(204);
    expect(outcome.response?.headers?.['access-control-allow-headers']).toBe('*');
  });

  it('answers an unmodelled path 200 { ok: true } rather than failing it', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    const outcome = await recorder.deliver({
      url: `${API}/v1/widget/conversations/${WIRE_IDS.conversation}/read`,
      method: 'POST',
    });
    expect(outcome.response?.status).toBe(200);
    expect(jsonBody(outcome.response?.body)).toEqual({ ok: true });
  });

  it('lets `respond` take a path before the wire fixture sees it', async () => {
    const recorder = createRouteRecorder();
    const seen: string[] = [];
    await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      respond: ({ path, method, postData }) => {
        seen.push(`${method} ${path} ${String(postData)}`);
        return path === '/v1/widget/init' ? { status: 503, body: { error: 'nope' } } : null;
      },
    });
    const refused = await recorder.deliver({
      url: `${API}/v1/widget/init`,
      method: 'POST',
      postData: '{"publicId":"x"}',
    });
    expect(refused.response?.status).toBe(503);
    // And a path it declined still falls through to the fixture.
    const listed = await recorder.deliver({
      url: `${API}/v1/widget/conversations/list`,
      method: 'POST',
    });
    expect(jsonBody(listed.response?.body)).toHaveProperty('conversations');
    expect(seen[0]).toBe('POST /v1/widget/init {"publicId":"x"}');
  });

  it('reflects identity and unread into the session and the thread', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      identity: { externalId: 'user-7', email: 'a@b.test', userHash: 'deadbeef' },
      unread: 2,
      online: false,
    });
    const init = jsonBody(
      (await recorder.deliver({ url: `${API}/v1/widget/init`, method: 'POST' })).response?.body,
    );
    const session = init['session'] as Record<string, unknown>;
    expect(session['visitorKey']).toBe('user-7');
    expect(session['identityVerified']).toBe(true);
    /*
     * `contactId` non-null because `unread` was asked for. The real server
     * answers null for a visitor who has never spoken, and for that visitor
     * the widget's unread module does not run at all — so a fixture that
     * served unread replies to a null contact would be serving a state the
     * product cannot be in.
     */
    expect(session['contactId']).toBe(WIRE_IDS.contact);
    expect(init['online']).toBe(false);

    const messages = jsonBody(
      (await recorder.deliver({ url: `${API}/v1/widget/messages/list`, method: 'POST' })).response
        ?.body,
    )['messages'] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);
    expect(messages.filter((m) => m['authorType'] === 'agent')).toHaveLength(2);
    // Distinct, well-formed v7-shaped ids: the widget anchors its polling
    // cursor on the newest id it has seen and refuses a malformed one.
    const ids = messages.map((m) => String(m['id']));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('answers an anonymous visitor an empty thread list, not an error', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    const init = jsonBody(
      (await recorder.deliver({ url: `${API}/v1/widget/init`, method: 'POST' })).response?.body,
    );
    expect((init['session'] as Record<string, unknown>)['contactId']).toBeNull();
    const listed = jsonBody(
      (await recorder.deliver({ url: `${API}/v1/widget/conversations/list`, method: 'POST' }))
        .response?.body,
    );
    expect(listed).toEqual({ conversations: [] });
  });
});

describe('where the script bytes come from', () => {
  it('passes them through to the network by default, and still logs them', async () => {
    const recorder = createRouteRecorder();
    const fixture = await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    expect((await recorder.deliver({ url: `${CDN}/loader.js` })).kind).toBe('continued');
    expect((await recorder.deliver({ url: `${CDN}/widget.js?v=abc` })).kind).toBe('continued');
    /*
     * Interception WITH pass-through is the whole trick. The real CDN bytes
     * arrive — the ones a customer's visitors are served — and the fixture
     * still sees that they were asked for, which is what makes "nothing
     * loaded before click" assertable against the real loader.
     */
    expect(fixture.scriptRequests().map((r) => `${r.kind}:${r.served}`)).toEqual([
      'loader:network',
      'bundle:network',
    ]);
  });

  it('serves them from disk bytes when given files, with no network at all', async () => {
    const recorder = createRouteRecorder();
    const fixture = await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      scripts: { files: { 'loader.js': '/* real loader */', 'widget.js': '/* real bundle */' } },
    });
    const bundle = await recorder.deliver({ url: `${CDN}/widget.js?v=abc` });
    expect(bundle.kind).toBe('fulfilled');
    expect(bundle.response?.body).toBe('/* real bundle */');
    // The query string the loader appends is dropped before the lookup, so a
    // caller never has to know the build id.
    expect(bundle.response?.contentType).toBe('text/javascript');
    expect(fixture.scriptRequests().map((r) => r.served)).toEqual(['fixture']);
  });

  it('404s a missing file by NAME rather than aborting it', async () => {
    /*
     * An aborted script is indistinguishable from an ad blocker, which the
     * loader is built to survive quietly — so the test would see a widget
     * that never appeared and no reason why. The 404 body names the file.
     */
    const recorder = createRouteRecorder();
    const fixture = await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      scripts: { files: { 'loader.js': '/* real loader */' } },
    });
    const outcome = await recorder.deliver({ url: `${CDN}/widget-engine.js` });
    expect(outcome.response?.status).toBe(404);
    expect(outcome.response?.body).toContain('widget-engine.js');
    expect(fixture.scriptRequests().map((r) => r.served)).toEqual(['unserved']);
  });
});

describe('seeding storage', () => {
  it('writes the returning-chatter key before the page’s own scripts run', async () => {
    const recorder = createRouteRecorder();
    const fixture = await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      seed: { returning: true },
    });
    expect(recorder.initScripts).toHaveLength(1);
    expect(recorder.initScripts[0]).toContain(`chatly:vr:${PUBLIC_ID}`);
    // `{}` — a real, parseable watermark map with no thread seen in it. The
    // loader checks only that the key is PRESENT; the widget parses it.
    expect(recorder.initScripts[0]).toContain('"{}"');
    expect(fixture.initScript()).toBe(recorder.initScripts[0]);
  });

  it('writes the identity key, and anything else by literal name', async () => {
    const recorder = createRouteRecorder();
    await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      seed: { externalId: 'user-7', entries: { 'chatly:seen': '1' } },
    });
    const script = recorder.initScripts[0] ?? '';
    expect(script).toContain(`chatly:xid:${PUBLIC_ID}`);
    expect(script).toContain('user-7');
    expect(script).toContain('chatly:seen');
  });

  it('registers no init script when nothing was asked for', async () => {
    const recorder = createRouteRecorder();
    const fixture = await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    expect(recorder.initScripts).toEqual([]);
    expect(fixture.initScript()).toBe('');
  });

  it('refuses a seed on a host that cannot run one', async () => {
    /*
     * Refused, not skipped. A seed that silently did not happen turns
     * "returning chatter preloads" into a test that fails against a correct
     * loader, and the integrator goes looking in the widget.
     */
    const bare = { route: () => Promise.resolve() };
    await expect(
      installChatlyEmbed(bare, { publicId: PUBLIC_ID, seed: { returning: true } }),
    ).rejects.toThrow(/addInitScript/);
  });
});

describe('reading the page back', () => {
  it('reads storage through evaluate and asserts with the kit’s own helpers', async () => {
    const recorder = createRouteRecorder();
    recorder.onEvaluate(() => ({
      localStorage: { [`chatly:xid:${PUBLIC_ID}`]: 'user-7', 'not-ours': '1' },
      sessionStorage: {},
    }));
    const fixture = await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    expect(await fixture.chatlyStorage()).toEqual([
      { key: `chatly:xid:${PUBLIC_ID}`, store: 'localStorage' },
    ]);
    await expect(fixture.expectNoStorage()).rejects.toThrow(/wrote 1 key\(s\)/);
  });

  it('passes expectNoStorage for a page that wrote nothing', async () => {
    const recorder = createRouteRecorder();
    recorder.onEvaluate(() => ({ localStorage: {}, sessionStorage: {} }));
    const fixture = await installChatlyEmbed(recorder, { publicId: PUBLIC_ID });
    await expect(fixture.expectNoStorage()).resolves.toBeUndefined();
  });

  it('names the missing capability rather than failing obscurely', async () => {
    const bare = { route: () => Promise.resolve() };
    const fixture = await installChatlyEmbed(bare, { publicId: PUBLIC_ID });
    await expect(fixture.storage()).rejects.toThrow(/evaluate/);
  });
});

describe('the four CHT-D09 acceptance assertions are expressible', () => {
  /** One lazy-mode page view, as the recorder sees it. */
  async function lazyPage(seed?: { returning?: boolean; externalId?: string }) {
    const recorder = createRouteRecorder();
    const fixture = await installChatlyEmbed(recorder, {
      publicId: PUBLIC_ID,
      ...(seed === undefined ? {} : { seed }),
    });
    return { recorder, fixture };
  }

  it('1. nothing loaded before click', async () => {
    const { recorder, fixture } = await lazyPage();
    // The loader is fetched on every page view in every mode; the BUNDLE is
    // what lazy mode withholds.
    await recorder.deliver({ url: `${CDN}/loader.js` });
    expect(fixture.loaderRequested()).toBe(true);
    expect(fixture.bundleRequested()).toBe(false);
    expect(() => fixture.expectBundleNotRequested('before any click')).not.toThrow();
    expect(() => fixture.expectBundleRequested()).toThrow(/never fetched/);
  });

  it('2. one click opens — the bundle arrives and the API answers it', async () => {
    const { recorder, fixture } = await lazyPage();
    await recorder.deliver({ url: `${CDN}/loader.js` });
    fixture.reset();
    // What the click causes: the bundle, then init.
    await recorder.deliver({ url: `${CDN}/widget.js?v=abc` });
    await recorder.deliver({ url: `${API}/v1/widget/init`, method: 'POST' });
    expect(() => fixture.expectBundleRequested('after one click')).not.toThrow();
    expect(fixture.apiRequests().map((r) => r.path)).toEqual(['/v1/widget/init']);
  });

  it('3. a returning chatter preloads — the key is seeded before the loader runs', async () => {
    const { recorder, fixture } = await lazyPage({ returning: true });
    expect(recorder.initScripts[0]).toContain(`chatly:vr:${PUBLIC_ID}`);
    await recorder.deliver({ url: `${CDN}/loader.js` });
    await recorder.deliver({ url: `${CDN}/widget.js?v=abc` });
    expect(() => fixture.expectBundleRequested('returning chatter, no interaction')).not.toThrow();
  });

  it('4. signed-out resets — the identity keys are gone and the kit says which', async () => {
    const { recorder, fixture } = await lazyPage({ externalId: 'user-7' });
    recorder.onEvaluate(() => ({
      // After `Chatly('reset')`: `xid` and `vh` dropped, the session token
      // left behind. `reset()` deletes the identity keys regardless of the
      // storage mode — withholding a write is a privacy choice, refusing to
      // delete would be the opposite of one.
      localStorage: { [`chatly:vt:${PUBLIC_ID}`]: 'vs1.x' },
      sessionStorage: {},
    }));
    const left = await fixture.chatlyStorage();
    expect(left.map((f) => f.key)).toEqual([`chatly:vt:${PUBLIC_ID}`]);
    expect(left.map((f) => f.key)).not.toContain(`chatly:xid:${PUBLIC_ID}`);
  });

  it('and the request log distinguishes every artifact it saw', async () => {
    const { recorder, fixture } = await lazyPage();
    for (const url of [
      `${CDN}/loader.js`,
      `${CDN}/widget.js?v=abc`,
      `${CDN}/widget-engine.js`,
      `${API}/v1/widget/init`,
    ]) {
      await recorder.deliver({ url, method: url.includes('/v1/') ? 'POST' : 'GET' });
    }
    expect(fixture.requests.map((r) => r.kind)).toEqual(['loader', 'bundle', 'chunk', 'api']);
    expect(fixture.requests.map((r) => r.path)).toEqual([
      '/loader.js',
      '/widget.js',
      '/widget-engine.js',
      '/v1/widget/init',
    ]);
  });
});
