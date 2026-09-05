import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'fs/promises';

const entry = 'bplistCreator.js';
const outdir = 'dist';

await mkdir(outdir, { recursive: true });

const common = {
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node20.19',
  packages: 'external',
  sourcemap: true,
};

await build({ ...common, format: 'esm', outfile: `${outdir}/index.mjs` });

await build({
  ...common,
  format: 'cjs',
  outfile: `${outdir}/index.cjs`,
  // esbuild lowers `export default fn` to `module.exports = { default: fn }`,
  // which would break the long-standing `require('bplist-creator')(obj)` call
  // signature. Flatten it back so module.exports *is* the function; `Real`
  // rides along as a property already attached in the source.
  footer: { js: 'module.exports = module.exports.default;' },
});

// Ship the same declarations under both extensions so `import` and `require`
// consumers each resolve types under their own resolution mode.
const types = await readFile('bplistCreator.d.ts', 'utf8');
await writeFile(`${outdir}/index.d.ts`, types);
await writeFile(`${outdir}/index.d.cts`, types);

console.log('built', outdir);
