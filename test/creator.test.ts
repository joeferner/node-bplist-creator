import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, it } from 'vitest';
import * as bplistParser from 'bplist-parser';
import bplistCreator from '../bplistCreator.js';

const dirname = import.meta.dirname;

describe('bplist-creator', function () {
  it('sample1', async function () {
    await testFile('sample1.bplist');
  });

  it('sample2', async function () {
    await testFile('sample2.bplist');
  });

  it('binary data', async function () {
    await testFile('binaryData.bplist');
  });

  it('accepts ArrayBuffers and ArrayBuffer views as data', function () {
    const expected = Buffer.from([0, 1, 2, 3]);
    const crossRealmBuffer = vm.runInNewContext('new Uint8Array([0, 1, 2, 3]).buffer');
    const views = [
      new Uint8Array([0, 1, 2, 3]),
      new Uint8Array([9, 0, 1, 2, 3, 9]).subarray(1, 5),
      new DataView(new Uint8Array([9, 0, 1, 2, 3, 9]).buffer, 1, 4)
    ];

    for (const value of [crossRealmBuffer, ...views]) {
      const [parsed] = bplistParser.parseBuffer(bplistCreator(value as any));
      assert.ok(Buffer.isBuffer(parsed));
      assert.deepStrictEqual(parsed, expected);
    }
  });

  it('airplay', async function () {
    await testFile('airplay.bplist');
  });

  it('integers', async function () {
    await testFile('integers.bplist');
  });

  it('64-bit integer payload', function () {
    const buf = bplistCreator([4294967296]);
    const integerObject = Buffer.from([0x13, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);

    assert.notStrictEqual(
      buf.indexOf(integerObject),
      -1,
      'expected 4294967296 to be written as an 8-byte integer'
    );
  });

  it('large whole-valued numbers are written as reals', function () {
    const values = [2 ** 53, 1e20, 1e39, 1.5e300, Number.MAX_VALUE, -1e19, -1e300];
    const [parsed] = bplistParser.parseBuffer(bplistCreator(values));
    assert.deepStrictEqual(parsed, values);

    const buf = bplistCreator([1e20]);
    const realObject = Buffer.alloc(9);
    realObject[0] = 0x23;
    realObject.writeDoubleBE(1e20, 1);
    assert.notStrictEqual(buf.indexOf(realObject), -1, 'expected 1e20 to be written as an 8-byte real');
  });

  it('safe integers and BigInts are written as integers', function () {
    const values = [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 2n ** 63n - 1n];
    const [parsed] = bplistParser.parseBuffer(bplistCreator(values));
    assert.deepStrictEqual(parsed, values);
  });

  it('skips null and undefined object values', function () {
    const buf = bplistCreator({a: null, b: 1, c: undefined, nested: {d: null, e: 'x'}, list: [{f: undefined}]});
    const [parsed] = bplistParser.parseBuffer(buf);
    assert.deepStrictEqual(parsed, {b: 1, nested: {e: 'x'}, list: [{}]});
  });

  it('throws a clear error for null and undefined array items', function () {
    assert.throws(() => bplistCreator([1, null]), /cannot encode null: binary plists have no null type/);
    assert.throws(() => bplistCreator([undefined]), /cannot encode undefined: binary plists have no null type/);
  });

  it('UID payload widths', function () {
    const buf = bplistCreator([
      {UID: 255},
      {UID: 256},
      {UID: 65536},
      {UID: 4294967296n}
    ]);

    assert.notStrictEqual(buf.indexOf(Buffer.from([0x80, 0xff])), -1, 'expected 255 to be written as a 1-byte UID');
    assert.notStrictEqual(buf.indexOf(Buffer.from([0x81, 0x01, 0x00])), -1, 'expected 256 to be written as a 2-byte UID');
    assert.notStrictEqual(buf.indexOf(Buffer.from([0x83, 0x00, 0x01, 0x00, 0x00])), -1, 'expected 65536 to be written as a 4-byte UID');
    assert.notStrictEqual(
      buf.indexOf(Buffer.from([0x87, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])),
      -1,
      'expected 4294967296 to be written as an 8-byte UID'
    );
  });

  it('accepts CF$UID dictionaries as UIDs', function () {
    const [values] = bplistParser.parseBuffer(bplistCreator([
      {'CF$UID': 1},
      {'CF$UID': 255},
      {'CF$UID': 65536},
      {plain: 1, uid: {'CF$UID': 42}}
    ]));

    assert.deepStrictEqual(values.slice(0, 3).map((value: any) => value.UID), [1, 255, 65536]);
    assert.strictEqual(values[3].plain, 1);
    assert.strictEqual(values[3].uid.UID, 42);
  });

  it('rejects invalid UID payloads as ordinary dictionaries', function () {
    const unsafe = Number.MAX_SAFE_INTEGER + 2;
    const [values] = bplistParser.parseBuffer(bplistCreator([
      {UID: unsafe},
      {UID: -1},
      {'CF$UID': -1n},
      {'CF$UID': 7, other: 1}
    ]));

    assert.deepStrictEqual(values[0], {UID: unsafe});
    assert.deepStrictEqual(values[1], {UID: -1});
    assert.deepStrictEqual(values[2], {'CF$UID': -1});
    assert.deepStrictEqual(values[3], {'CF$UID': 7, other: 1});
  });

  it('early Date object', function () {
    const buf = bplistCreator([new Date('0001-01-01T00:00:00Z')]);
    const dicts = bplistParser.parseBuffer(buf);

    assert.strictEqual((dicts[0] as Date[])[0].toISOString(), '0001-01-01T00:00:00.000Z');
  });

  it('top-level one-item array', function () {
    const buf = bplistCreator(['only-item']);
    const dicts = bplistParser.parseBuffer(buf);

    assert.deepStrictEqual(dicts, [['only-item']]);
  });
});

async function testFile(name: string): Promise<void> {
  const file = path.join(dirname, name);
  const fileData = await fs.readFile(file);
  const dicts = await bplistParser.parseFile(file);

  applyOverrides(dicts);

  const buf = bplistCreator(dicts[0]);
  compareBuffers(buf, fileData, name);
}

// The parser returns plain JS values, but round-tripping byte-for-byte requires
// telling the creator which of them were originally reals / utf16 strings.
function applyOverrides(dicts: any): void {
  const root = dicts && dicts[0];
  if (!root) {
    return;
  }

  const asDouble = (value: any) => ({bplistOverride: true, type: 'double', value});
  const asString = (value: any) => ({bplistOverride: true, type: 'string', value});
  const asUtf16 = (value: any) => ({bplistOverride: true, type: 'string-utf16', value});

  // airplay
  if (root.loadedTimeRanges && root.loadedTimeRanges[0] && 'start' in root.loadedTimeRanges[0]) {
    root.loadedTimeRanges[0].start = asDouble(root.loadedTimeRanges[0].start);
  }
  if (root.seekableTimeRanges && root.seekableTimeRanges[0] && 'start' in root.seekableTimeRanges[0]) {
    root.seekableTimeRanges[0].start = asDouble(root.seekableTimeRanges[0].start);
  }
  if ('rate' in root) {
    root.rate = asDouble(root.rate);
  }

  // utf16
  if ('NSHumanReadableCopyright' in root) {
    root.NSHumanReadableCopyright = asUtf16(root.NSHumanReadableCopyright);
  }
  if ('CFBundleExecutable' in root) {
    root.CFBundleExecutable = asString(root.CFBundleExecutable);
  }
  if (root.CFBundleURLTypes && root.CFBundleURLTypes[0] && 'CFBundleURLSchemes' in root.CFBundleURLTypes[0]) {
    root.CFBundleURLTypes[0].CFBundleURLSchemes[0] = asString(root.CFBundleURLTypes[0].CFBundleURLSchemes[0]);
  }
  if ('CFBundleDisplayName' in root) {
    root.CFBundleDisplayName = asString(root.CFBundleDisplayName);
  }
  if ('DTPlatformBuild' in root) {
    root.DTPlatformBuild = asString(root.DTPlatformBuild);
  }

  // integer
  if ('int64item' in root) {
    root.int64item = {bplistOverride: true, type: 'number', value: root.int64item};
  }
}

function compareBuffers(actual: Buffer, expected: Buffer, name: string): void {
  if (actual.length !== expected.length) {
    assert.fail(
      `${name}: buffer size mismatch. found: ${actual.length}, expected: ${expected.length}.\n` +
        dump(actual, expected)
    );
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      assert.fail(
        `${name}: buffer mismatch at offset 0x${i.toString(16)}. ` +
          `found: 0x${actual[i].toString(16)}, expected: 0x${expected[i].toString(16)}.\n` +
          dump(actual, expected)
      );
    }
  }
}

function dump(buf1: Buffer, buf2: Buffer): string {
  const lines: string[] = [];
  for (let offset = 0; offset < buf1.length || offset < buf2.length; offset += 16) {
    lines.push(
      offset.toString(16).padStart(8, '0') + ': ' +
      hex(buf1, offset) + ' ' + ascii(buf1, offset) +
      ' - ' +
      hex(buf2, offset) + ' ' + ascii(buf2, offset)
    );
  }
  return lines.join('\n');
}

function hex(buf: Buffer, offset: number): string {
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 8) {
      out += ' ';
    }
    out += offset + i < buf.length ? buf[offset + i].toString(16).padStart(2, '0') + ' ' : '   ';
  }
  return out;
}

function ascii(buf: Buffer, offset: number): string {
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (offset + i >= buf.length) {
      out += ' ';
      continue;
    }
    const ch = String.fromCharCode(buf[offset + i]);
    out += ch < ' ' || ch > '~' ? '.' : ch;
  }
  return out;
}
