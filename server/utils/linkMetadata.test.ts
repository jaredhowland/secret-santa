import { describe, expect, test } from 'bun:test';
import { fetchLinkMetadata, parseLinkMetadata } from './linkMetadata';

describe('parseLinkMetadata', () => {
  test('reads Open Graph tags and resolves relative images', () => {
    const html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Cool Mug">
      <meta property="og:image" content="/img/mug.png">
      <meta property="product:price:amount" content="12.50">
      <meta property="product:price:currency" content="USD">
    </head></html>`;
    expect(parseLinkMetadata(html, 'https://shop.example/p/1')).toEqual({
      title: 'Cool Mug',
      imageUrl: 'https://shop.example/img/mug.png',
      price: '12.50',
    });
  });

  test('falls back to <title> and ignores non-USD prices and non-http images', () => {
    const html = `<head><title> Plain Page </title>
      <meta property="og:image" content="javascript:alert(1)">
      <meta property="og:price:amount" content="10">
      <meta property="og:price:currency" content="EUR"></head>`;
    expect(parseLinkMetadata(html, 'https://x.example/')).toEqual({
      title: 'Plain Page',
      imageUrl: null,
      price: null,
    });
  });

  const priceOf = (amount: string, currency = 'USD') =>
    parseLinkMetadata(
      `<meta property="product:price:amount" content="${amount}"><meta property="product:price:currency" content="${currency}">`,
      'https://x.example/',
    ).price;

  test('accepts and rejects price formats', () => {
    expect(priceOf('1,299.99')).toBe('1,299.99');
    expect(priceOf('12.50')).toBe('12.50');
    expect(priceOf('1,2,3')).toBeNull();
    expect(priceOf('12.50', 'EUR')).toBeNull();
  });

  test('price regex is not vulnerable to ReDoS', () => {
    const html = `<meta property="product:price:amount" content="${'1'.repeat(100_000)}x">`;
    const start = performance.now();
    const result = parseLinkMetadata(html, 'https://x.example/');
    expect(performance.now() - start).toBeLessThan(200);
    expect(result.price).toBeNull();
  });

  test('drops oversized image URLs', () => {
    const html = `<meta property="og:image" content="https://x.example/${'a'.repeat(2100)}.png">`;
    expect(parseLinkMetadata(html, 'https://x.example/').imageUrl).toBeNull();
  });

  test('returns nulls when nothing is found', () => {
    expect(parseLinkMetadata('<html></html>', 'https://x.example/')).toEqual({
      title: null,
      imageUrl: null,
      price: null,
    });
  });
});

describe('fetchLinkMetadata', () => {
  test('never contacts loopback addresses', async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        hits++;
        return new Response('<title>secret</title>', { headers: { 'content-type': 'text/html' } });
      },
    });
    try {
      const result = await fetchLinkMetadata(`http://127.0.0.1:${server.port}/`);
      expect(result).toEqual({ title: null, imageUrl: null, price: null });
      expect(hits).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test('returns empty metadata for an invalid URL', async () => {
    expect(await fetchLinkMetadata('not a url')).toEqual({ title: null, imageUrl: null, price: null });
  });
});
