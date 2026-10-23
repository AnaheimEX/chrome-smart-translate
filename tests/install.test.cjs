'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extensionIds } = require('../bridge/install.js');

test('registration includes the current unpacked extension ID even with a stale override', () => {
  const root = '~/Downloads/Project/chrome-smart-translate';
  assert.deepEqual(extensionIds(root), ['gnhmaeokfjlajelmbfdfkhelpogdlkcd']);
  assert.deepEqual(extensionIds(root, 'ogpfgdepaihlggpadbbjogmffiojlcjj'), [
    'gnhmaeokfjlajelmbfdfkhelpogdlkcd', 'ogpfgdepaihlggpadbbjogmffiojlcjj',
  ]);
  assert.throws(() => extensionIds(root, '*'), /扩展 ID/);
});
