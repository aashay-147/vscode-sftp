// Features 2+3 — config validation for `confirmOverwrite` (boolean or the
// string 'confirm', mirroring `downloadOnOpen`) and `skipUnmodified`
// (plain boolean). Both optional.

import { validateConfig } from '../config';

const base = { host: 'host', username: 'username', remotePath: '/' };

describe('skipUnmodified config validation', () => {
  test.each([[false], [true]])('accepts %p', value => {
    expect(validateConfig({ ...base, skipUnmodified: value })).toBeFalsy();
  });

  test('rejects a string', () => {
    expect(validateConfig({ ...base, skipUnmodified: 'confirm' })).toBeTruthy();
  });
});

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
