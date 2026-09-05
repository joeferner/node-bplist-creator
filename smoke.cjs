// Verifies the published dual build: `require()` must return the callable
// creator itself (with `.Real` attached) and `import` must expose the same
// function as the default export. Run with `npm run smoke` after a build.
const assert = require('node:assert');

const expected = Buffer.from('bplist00');

const cjs = require('./dist/index.cjs');
assert.strictEqual(typeof cjs, 'function', 'require() should return the creator function');
assert.strictEqual(typeof cjs.Real, 'function', 'require().Real should be a constructor');
assert.ok(cjs(['only-item']).subarray(0, 8).equals(expected), 'require() build should emit a bplist header');

import('./dist/index.mjs').then((esm) => {
  assert.strictEqual(typeof esm.default, 'function', 'import default should be the creator function');
  assert.strictEqual(typeof esm.Real, 'function', 'import should expose the Real named export');
  assert.ok(esm.default(['only-item']).subarray(0, 8).equals(expected), 'import build should emit a bplist header');

  assert.ok(
    cjs(['only-item']).equals(esm.default(['only-item'])),
    'both builds should produce identical output'
  );

  console.log('smoke: cjs + esm builds OK');
});
