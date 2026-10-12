import { describe, expect, test } from 'bun:test';
import { parseWishlistInput } from './wishlistInput';
import { isAmazonUrl } from './amazon';

describe('parseWishlistInput', () => {
  test('accepts url only', () => {
    expect(parseWishlistInput({ url: ' https://shop.example/a ' })).toEqual({
      ok: true, url: 'https://shop.example/a', description: null,
    });
  });

  test('accepts description only', () => {
    expect(parseWishlistInput({ description: ' a blue scarf ' })).toEqual({
      ok: true, url: null, description: 'a blue scarf',
    });
  });

  test('accepts both and treats blank strings as missing', () => {
    expect(parseWishlistInput({ url: 'http://a.example', description: 'x' })).toEqual({
      ok: true, url: 'http://a.example', description: 'x',
    });
    expect(parseWishlistInput({ url: '  ', description: 'x' })).toEqual({
      ok: true, url: null, description: 'x',
    });
  });

  test.each([
    [{}], [{ url: '', description: '  ' }], [null], [undefined], ['str'],
  ])('rejects when neither is present: %j', (body) => {
    expect(parseWishlistInput(body).ok).toBe(false);
  });

  test.each([
    [{ url: 'not a url' }],
    [{ url: 'ftp://files.example/x' }],
    [{ url: 'javascript:alert(1)' }],
    [{ url: 123 }],
    [{ description: 123 }],
    [{ url: 'https://a.example/' + 'x'.repeat(2100) }],
    [{ description: 'x'.repeat(501) }],
  ])('rejects invalid input: %j', (body) => {
    expect(parseWishlistInput(body).ok).toBe(false);
  });
});

describe('isAmazonUrl', () => {
  test('matches amazon hosts only', () => {
    expect(isAmazonUrl('https://www.amazon.com/dp/B08N5WRWNW')).toBe(true);
    expect(isAmazonUrl('https://smile.amazon.com/dp/B08N5WRWNW')).toBe(true);
    expect(isAmazonUrl('https://amazon.com.evil.example/dp/x')).toBe(false);
    expect(isAmazonUrl('https://shop.example/')).toBe(false);
  });
});
