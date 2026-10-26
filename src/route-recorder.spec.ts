/**
 * The recorder, and the glob it has to mean the same thing by as Playwright.
 *
 * The matcher is self-tested on every run with a specimen of each wildcard
 * AND a negative, for the reason five gates in this repo have had to learn
 * the hard way: a matcher that has stopped matching reports nothing and makes
 * every test that depends on it pass, and a matcher that matched EVERYTHING
 * would do the same.
 */
import { describe, expect, it } from 'vitest';

import { createRouteRecorder, globToRegExp } from './route-recorder.js';

describe('globToRegExp means what Playwright means', () => {
  it('matches the whole url, not a substring of it', () => {
    expect(
      globToRegExp('https://api.chatlychat.com/**').test('https://api.chatlychat.com/v1/x'),
    ).toBe(true);
    // The failure this anchoring prevents: a pattern that also matched a
    // DIFFERENT host whose name merely contains ours.
    expect(
      globToRegExp('https://api.chatlychat.com/**').test(
        'https://evil.com/?x=https://api.chatlychat.com/v1',
      ),
    ).toBe(false);
  });

  it('stops a single star at a slash and lets a double star cross one', () => {
    expect(globToRegExp('https://cdn.test/*.js').test('https://cdn.test/widget.js')).toBe(true);
    expect(globToRegExp('https://cdn.test/*.js').test('https://cdn.test/a/widget.js')).toBe(false);
    expect(globToRegExp('https://cdn.test/**.js').test('https://cdn.test/a/widget.js')).toBe(true);
  });

  it('treats a query string as ordinary characters a star can cover', () => {
    // The real case: the loader appends `?v=<buildId>`, so a pattern that
    // ended at `.js` would miss every bundle request.
    expect(globToRegExp('https://cdn.test/**').test('https://cdn.test/widget.js?v=abc123')).toBe(
      true,
    );
  });

  it('escapes regex metacharacters that are legal in a url', () => {
    expect(globToRegExp('https://cdn.test/a+b(1).js').test('https://cdn.test/a+b(1).js')).toBe(
      true,
    );
    // `.` is literal, so it must not match any character.
    expect(globToRegExp('https://cdn.test/a.js').test('https://cdn.test/aXjs')).toBe(false);
  });

  it('is not a matcher that matches everything', () => {
    expect(
      globToRegExp('https://api.chatlychat.com/**').test('https://widget.chatlychat.com/widget.js'),
    ).toBe(false);
  });

  it('treats `?` as exactly one non-slash character', () => {
    expect(globToRegExp('https://cdn.test/a?c').test('https://cdn.test/abc')).toBe(true);
    expect(globToRegExp('https://cdn.test/a?c').test('https://cdn.test/a/c')).toBe(false);
  });
});

describe('the recorder', () => {
  it('reports the fulfillment a handler built', async () => {
    const recorder = createRouteRecorder();
    await recorder.route('https://x.test/**', async (route) => {
      await route.fulfill({ status: 201, body: 'made' });
    });
    const outcome = await recorder.deliver({ url: 'https://x.test/a' });
    expect(outcome.kind).toBe('fulfilled');
    expect(outcome.response?.status).toBe(201);
    expect(outcome.response?.body).toBe('made');
    expect(outcome.pattern).toBe('https://x.test/**');
  });

  it('reports a pass-through and an abort distinctly from a fulfillment', async () => {
    const recorder = createRouteRecorder();
    await recorder.route('https://pass.test/**', async (route) => {
      await route.continue();
    });
    await recorder.route('https://stop.test/**', async (route) => {
      await route.abort('blockedbyclient');
    });
    expect((await recorder.deliver({ url: 'https://pass.test/a' })).kind).toBe('continued');
    const aborted = await recorder.deliver({ url: 'https://stop.test/a' });
    expect(aborted.kind).toBe('aborted');
    expect(aborted.errorCode).toBe('blockedbyclient');
  });

  it('reports an unrouted request rather than inventing an answer', async () => {
    /*
     * The distinction that makes the fixture's own tests meaningful: if an
     * unmatched request came back as `continued`, a pattern that matched
     * nothing would look exactly like a pattern that let the network through,
     * and every "the API was intercepted" assertion would be vacuous.
     */
    const recorder = createRouteRecorder();
    await recorder.route('https://x.test/**', async (route) => {
      await route.fulfill({ status: 200 });
    });
    expect((await recorder.deliver({ url: 'https://y.test/a' })).kind).toBe('unrouted');
  });

  it('gives a later pattern precedence over an earlier one, as Playwright does', async () => {
    const recorder = createRouteRecorder();
    await recorder.route('https://x.test/**', async (route) => {
      await route.fulfill({ status: 200, body: 'broad' });
    });
    await recorder.route('https://x.test/narrow', async (route) => {
      await route.fulfill({ status: 200, body: 'narrow' });
    });
    expect((await recorder.deliver({ url: 'https://x.test/narrow' })).response?.body).toBe(
      'narrow',
    );
    expect((await recorder.deliver({ url: 'https://x.test/other' })).response?.body).toBe('broad');
  });

  it('hands the handler the method and body it was given', async () => {
    const recorder = createRouteRecorder();
    const seen: string[] = [];
    await recorder.route('https://x.test/**', async (route) => {
      const request = route.request();
      seen.push(`${request.method()} ${request.url()} ${String(request.postData())}`);
      await route.fulfill({ status: 200 });
    });
    await recorder.deliver({ url: 'https://x.test/a', method: 'POST', postData: '{"a":1}' });
    await recorder.deliver({ url: 'https://x.test/b' });
    expect(seen).toEqual(['POST https://x.test/a {"a":1}', 'GET https://x.test/b null']);
  });

  it('records init scripts, evaluations and navigations', async () => {
    const recorder = createRouteRecorder();
    recorder.onEvaluate((expression) => (expression === '1+1' ? 2 : null));
    await recorder.addInitScript({ content: 'seed();' });
    await recorder.goto('https://host.test/');
    expect(await recorder.evaluate('1+1')).toBe(2);
    expect(recorder.initScripts).toEqual(['seed();']);
    expect(recorder.navigations).toEqual(['https://host.test/']);
    expect(recorder.evaluated).toEqual(['1+1']);
  });

  it('exposes patterns as a read-only view with a handler behind each one', async () => {
    const recorder = createRouteRecorder();
    await recorder.route('https://a.test/**', async (route) => {
      await route.fulfill({ status: 200 });
    });
    const patterns = recorder.patterns as string[];
    patterns.push('https://b.test/**');
    // The push went into a copy. A pattern with no handler would read as a
    // registered route and match nothing.
    expect(recorder.patterns).toEqual(['https://a.test/**']);
    expect((await recorder.deliver({ url: 'https://b.test/x' })).kind).toBe('unrouted');
  });
});
