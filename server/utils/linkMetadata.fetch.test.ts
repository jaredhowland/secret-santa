import { afterEach, describe, expect, test } from 'bun:test';
import { fetchLinkMetadata } from './linkMetadata';

// The guard is injected (not mock.module) so the real guard tests stay unaffected.
const allowAll = async (u: string) => new URL(u);
const EMPTY = { title: null, imageUrl: null, price: null };
const HTML = { 'content-type': 'text/html' };

const servers: ReturnType<typeof Bun.serve>[] = [];
const serve = (fetch: (req: Request) => Response | Promise<Response>) => {
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch });
  servers.push(s);
  return s;
};
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

describe('fetchLinkMetadata with stubbed guard', () => {
  test('returns parsed metadata', async () => {
    const s = serve(() => new Response('<title>Hello</title>', { headers: HTML }));
    const r = await fetchLinkMetadata(`http://127.0.0.1:${s.port}/`, allowAll);
    expect(r.title).toBe('Hello');
  });

  test('follows redirects and calls guard once per hop', async () => {
    const b = serve(() => new Response('<title>B</title>', { headers: HTML }));
    const a = serve(
      () => new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${b.port}/x` } }),
    );
    const calls: string[] = [];
    const r = await fetchLinkMetadata(`http://127.0.0.1:${a.port}/`, async (u) => {
      calls.push(u);
      return new URL(u);
    });
    expect(r.title).toBe('B');
    expect(calls).toHaveLength(2);
  });

  test('stops when guard rejects a redirect hop', async () => {
    let bHits = 0;
    const b = serve(() => {
      bHits++;
      return new Response('<title>B</title>', { headers: HTML });
    });
    const a = serve(
      () => new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${b.port}/` } }),
    );
    const r = await fetchLinkMetadata(`http://127.0.0.1:${a.port}/`, async (u) => {
      if (new URL(u).port === String(b.port)) throw new Error('Address not allowed');
      return new URL(u);
    });
    expect(r).toEqual(EMPTY);
    expect(bHits).toBe(0);
  });

  test('redirect loop stops after 4 requests', async () => {
    let hits = 0;
    const s = serve((req) => {
      hits++;
      return new Response(null, { status: 302, headers: { location: req.url } });
    });
    expect(await fetchLinkMetadata(`http://127.0.0.1:${s.port}/`, allowAll)).toEqual(EMPTY);
    expect(hits).toBe(4);
  });

  test('non-HTML content-type returns empty', async () => {
    const s = serve(
      () => new Response('<title>x</title>', { headers: { 'content-type': 'application/json' } }),
    );
    expect(await fetchLinkMetadata(`http://127.0.0.1:${s.port}/`, allowAll)).toEqual(EMPTY);
  });

  test('404 returns empty', async () => {
    const s = serve(() => new Response('<title>x</title>', { status: 404, headers: HTML }));
    expect(await fetchLinkMetadata(`http://127.0.0.1:${s.port}/`, allowAll)).toEqual(EMPTY);
  });

  test('ignores content past the 1MB cap but finds titles before it', async () => {
    const pad = '<!--' + 'a'.repeat(1_100_000) + '-->';
    const late = serve(() => new Response(`${pad}<title>Late</title>`, { headers: HTML }));
    const early = serve(() => new Response(`<title>Early</title>${pad}`, { headers: HTML }));
    expect((await fetchLinkMetadata(`http://127.0.0.1:${late.port}/`, allowAll)).title).toBeNull();
    expect((await fetchLinkMetadata(`http://127.0.0.1:${early.port}/`, allowAll)).title).toBe('Early');
  });

  test('decodes latin-1 charset', async () => {
    const body = Buffer.concat([
      Buffer.from('<title>Caf'),
      Buffer.from([0xe9]),
      Buffer.from('</title>'),
    ]);
    const s = serve(
      () => new Response(body, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } }),
    );
    expect((await fetchLinkMetadata(`http://127.0.0.1:${s.port}/`, allowAll)).title).toBe('Café');
  });
});
