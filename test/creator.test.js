import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'vitest';
import bplistParser from 'bplist-parser';
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

  it('top-level one-item array', function () {
    const buf = bplistCreator(['only-item']);
    const dicts = bplistParser.parseBuffer(buf);

    assert.deepStrictEqual(dicts, [['only-item']]);
  });
});

async function testFile(name) {
  const file = path.join(dirname, name);
  const fileData = await fs.readFile(file);
  const dicts = await bplistParser.parseFile(file);

  applyOverrides(dicts);

  const buf = bplistCreator(dicts[0]);
  compareBuffers(buf, fileData, name);
}

// The parser returns plain JS values, but round-tripping byte-for-byte requires
// telling the creator which of them were originally reals / utf16 strings.
function applyOverrides(dicts) {
  const root = dicts && dicts[0];
  if (!root) {
    return;
  }

  const asDouble = (value) => ({bplistOverride: true, type: 'double', value});
  const asString = (value) => ({bplistOverride: true, type: 'string', value});
  const asUtf16 = (value) => ({bplistOverride: true, type: 'string-utf16', value});

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
    root.int64item = {bplistOverride: true, type: 'number', value: root.int64item.value};
  }
}

function compareBuffers(actual, expected, name) {
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

function dump(buf1, buf2) {
  const lines = [];
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

function hex(buf, offset) {
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 8) {
      out += ' ';
    }
    out += offset + i < buf.length ? buf[offset + i].toString(16).padStart(2, '0') + ' ' : '   ';
  }
  return out;
}

function ascii(buf, offset) {
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
