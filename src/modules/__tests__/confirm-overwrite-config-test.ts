// Feature 2 — config validation for `confirmOverwrite`. Mirrors the
// `downloadOnOpen` shape: boolean or the string 'confirm', optional.

import { validateConfig } from '../config';

const base = { host: 'host', username: 'username', remotePath: '/' };

describe('confirmOverwrite config validation', () => {
  test.each([[false], [true], ['confirm']])('accepts %p', value => {
    expect(validateConfig({ ...base, confirmOverwrite: value })).toBeFalsy();
  });

  test('rejects an arbitrary string', () => {
    expect(validateConfig({ ...base, confirmOverwrite: 'nope' })).toBeTruthy();
  });

  test('is optional (omitted is valid)', () => {
    expect(validateConfig(base)).toBeFalsy();
  });
});
