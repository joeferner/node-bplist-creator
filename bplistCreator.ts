// adapted from http://code.google.com/p/plist/source/browse/trunk/src/main/java/com/dd/plist/BinaryPropertyListWriter.java

import util from 'node:util';
import streamBuffers from 'stream-buffers';

const debug = false;

export type PlistJsObj = any[] | Record<any, any>;

/** Wraps a number so it is always encoded as a binary plist `real`. */
export class Real {
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

type DictEntry = { type: 'dict'; entryKeys: Entry[]; entryValues: Entry[]; id?: number };
type NumberEntry = { type: 'number' | 'double'; value: number | bigint; id?: number; bplistOverride?: true };
type UidEntry = { type: 'UID'; value: number | bigint; id?: number };
type ArrayEntry = { type: 'array'; entries: Entry[]; id?: number };
type BooleanEntry = { type: 'boolean'; value: boolean; id?: number };
type StringEntry = {
  type: 'string' | 'string-utf16' | 'stringref';
  value: string;
  id?: number;
  bplistOverride?: true;
};
type DateEntry = { type: 'date'; value: Date | string; id?: number };
type DataEntry = { type: 'data'; value: Buffer; id?: number };

type Entry = DictEntry | NumberEntry | UidEntry | ArrayEntry | BooleanEntry | StringEntry | DateEntry | DataEntry;

interface BplistCreator {
  (dicts: PlistJsObj): Buffer;
  Real: typeof Real;
}

const bplistCreator = function bplistCreator(dicts: PlistJsObj): Buffer {
  const buffer = new streamBuffers.WritableStreamBuffer();
  buffer.write(Buffer.from("bplist00"));

  if (debug) {
    console.log('create', util.inspect(dicts, false, 10));
  }

  let entries = toEntries(dicts);
  if (debug) {
    console.log('entries', entries);
  }
  const idSizeInBytes = computeIdSizeInBytes(entries.length);
  const offsets: number[] = [];
  let offsetSizeInBytes: number;
  let offsetTableOffset: number;

  updateEntryIds();

  entries.forEach(function(entry, entryIdx) {
    offsets[entryIdx] = buffer.size();
    if (!entry) {
      buffer.write(Buffer.from([0x00]));
    } else {
      write(entry);
    }
  });

  writeOffsetTable();
  writeTrailer();
  return buffer.getContents() as Buffer;

  function updateEntryIds() {
    const strings: Record<string, number> = {};
    let entryId = 0;
    entries.forEach(function(entry) {
      if (entry.id) {
        return;
      }
      if (entry.type === 'string') {
        if (!entry.bplistOverride && Object.prototype.hasOwnProperty.call(strings, entry.value)) {
          (entry as StringEntry).type = 'stringref';
          entry.id = strings[entry.value];
        } else {
          strings[entry.value] = entry.id = entryId++;
        }
      } else {
        entry.id = entryId++;
      }
    });

    entries = entries.filter(function(entry) {
      return (entry.type !== 'stringref');
    });
  }

  function writeTrailer() {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeTrailer');
    }
    // 6 null bytes
    buffer.write(Buffer.from([0, 0, 0, 0, 0, 0]));

    // size of an offset
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeTrailer(offsetSizeInBytes):', offsetSizeInBytes);
    }
    writeByte(offsetSizeInBytes);

    // size of a ref
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeTrailer(offsetSizeInBytes):', idSizeInBytes);
    }
    writeByte(idSizeInBytes);

    // number of objects
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeTrailer(number of objects):', entries.length);
    }
    writeLong(entries.length);

    // top object
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeTrailer(top object)');
    }
    writeLong(0);

    // offset table offset
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeTrailer(offset table offset):', offsetTableOffset);
    }
    writeLong(offsetTableOffset);
  }

  function writeOffsetTable() {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeOffsetTable');
    }
    offsetTableOffset = buffer.size();
    offsetSizeInBytes = computeOffsetSizeInBytes(offsetTableOffset);
    offsets.forEach(function(offset) {
      writeBytes(offset, offsetSizeInBytes);
    });
  }

  function write(entry: Entry) {
    switch (entry.type) {
    case 'dict':
      writeDict(entry);
      break;
    case 'number':
    case 'double':
      writeNumber(entry);
      break;
    case 'UID':
      writeUID(entry);
      break;
    case 'array':
      writeArray(entry);
      break;
    case 'boolean':
      writeBoolean(entry);
      break;
    case 'string':
    case 'string-utf16':
      writeString(entry);
      break;
    case 'date':
      writeDate(entry);
      break;
    case 'data':
      writeData(entry);
      break;
    default:
      throw new Error("unhandled entry type: " + (entry as Entry).type);
    }
  }

  function writeDate(entry: DateEntry) {
    writeByte(0x33);
    const timestamp = entry.value instanceof Date ? entry.value.getTime() : Date.parse(entry.value);
    if (!isFinite(timestamp)) {
      throw new Error('invalid date: ' + entry.value);
    }
    const date = (timestamp / 1000) - 978307200;
    writeDouble(date);
  }

  function writeDict(entry: DictEntry) {
    if (debug) {
      const keysStr = entry.entryKeys.map(function(k) {return k.id;});
      const valsStr = entry.entryValues.map(function(k) {return k.id;});
      console.log('0x' + buffer.size().toString(16), 'writeDict', '(id: ' + entry.id + ')', '(keys: ' + keysStr + ')', '(values: ' + valsStr + ')');
    }
    writeIntHeader(0xD, entry.entryKeys.length);
    entry.entryKeys.forEach(function(entry) {
      writeID(entry.id as number);
    });
    entry.entryValues.forEach(function(entry) {
      writeID(entry.id as number);
    });
  }

  function writeNumber(entry: NumberEntry) {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeNumber', entry.value, ' (type: ' + entry.type + ')', '(id: ' + entry.id + ')');
    }

    if (entry.type !== 'double' && isIntegerValue(entry.value)) {
      writeInteger(entry.value);
    } else {
      writeByte(0x23);
      writeDouble(Number(entry.value));
    }
  }

  function writeInteger(value: number | bigint) {
    const integer = toBigInt(value);

    if (integer < 0n) {
      writeByte(0x13);
      writeBytes(integer, 8, true);
    } else if (integer <= 0xffn) {
      writeByte(0x10);
      writeBytes(integer, 1);
    } else if (integer <= 0xffffn) {
      writeByte(0x11);
      writeBytes(integer, 2);
    } else if (integer <= 0xffffffffn) {
      writeByte(0x12);
      writeBytes(integer, 4);
    } else if (integer <= 0x7fffffffffffffffn) {
      writeByte(0x13);
      writeBytes(integer, 8);
    } else {
      writeByte(0x14);
      writeBytes(integer, 16);
    }
  }

  function writeUID(entry: UidEntry) {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeUID', entry.value, ' (type: ' + entry.type + ')', '(id: ' + entry.id + ')');
    }

    const value = toBigInt(entry.value);
    const bytes = computeUIDSizeInBytes(value);
    writeByte(0x80 | (bytes - 1));
    writeBytes(value, bytes);
  }

  function writeArray(entry: ArrayEntry) {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeArray (length: ' + entry.entries.length + ')', '(id: ' + entry.id + ')');
    }
    writeIntHeader(0xA, entry.entries.length);
    entry.entries.forEach(function(e) {
      writeID(e.id as number);
    });
  }

  function writeBoolean(entry: BooleanEntry) {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeBoolean', entry.value, '(id: ' + entry.id + ')');
    }
    writeByte(entry.value ? 0x09 : 0x08);
  }

  function writeString(entry: StringEntry) {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeString', entry.value, '(id: ' + entry.id + ')');
    }
    if (entry.type === 'string-utf16' || mustBeUtf16(entry.value)) {
      const utf16 = Buffer.from(entry.value, 'ucs2');
      writeIntHeader(0x6, utf16.length / 2);
      // needs to be big endian so swap the bytes
      for (let i = 0; i < utf16.length; i += 2) {
        const t = utf16[i + 0];
        utf16[i + 0] = utf16[i + 1];
        utf16[i + 1] = t;
      }
      buffer.write(utf16);
    } else {
      const utf8 = Buffer.from(entry.value, 'ascii');
      writeIntHeader(0x5, utf8.length);
      buffer.write(utf8);
    }
  }

  function writeData(entry: DataEntry) {
    if (debug) {
      console.log('0x' + buffer.size().toString(16), 'writeData', entry.value, '(id: ' + entry.id + ')');
    }
    writeIntHeader(0x4, entry.value.length);
    buffer.write(entry.value);
  }

  function writeLong(l: number) {
    writeBytes(l, 8);
  }

  function writeByte(b: number) {
    buffer.write(Buffer.from([b]));
  }

  function writeDouble(v: number) {
    const buf = Buffer.alloc(8);
    buf.writeDoubleBE(v, 0);
    buffer.write(buf);
  }

  function writeIntHeader(kind: number, value: number) {
    if (value < 15) {
      writeByte((kind << 4) + value);
    } else if (value < 256) {
      writeByte((kind << 4) + 15);
      writeByte(0x10);
      writeBytes(value, 1);
    } else if (value < 65536) {
      writeByte((kind << 4) + 15);
      writeByte(0x11);
      writeBytes(value, 2);
    } else {
      writeByte((kind << 4) + 15);
      writeByte(0x12);
      writeBytes(value, 4);
    }
  }

  function writeID(id: number) {
    writeBytes(id, idSizeInBytes);
  }

  function writeBytes(value: number | bigint, bytes: number, isSignedInt?: boolean) {
    let integer = toBigInt(value);
    const bits = BigInt(bytes * 8);
    const limit = 1n << bits;

    if (isSignedInt) {
      const signedLimit = 1n << (bits - 1n);
      if (integer < -signedLimit || integer >= signedLimit) {
        throw new Error('integer out of range for ' + bytes + ' signed bytes: ' + value);
      }
      if (integer < 0n) {
        integer = limit + integer;
      }
    } else if (integer < 0n || integer >= limit) {
      throw new Error('integer out of range for ' + bytes + ' unsigned bytes: ' + value);
    }

    const buf = Buffer.alloc(bytes);
    for (let i = bytes - 1; i >= 0; i--) {
      buf[i] = Number(integer & 0xffn);
      integer >>= 8n;
    }
    buffer.write(buf);
  }

  function isIntegerValue(value: unknown): boolean {
    if (typeof value === 'bigint') {
      return true;
    }
    if (typeof value === 'number') {
      return isFinite(value) && Math.floor(value) === value;
    }
    if (typeof value === 'string') {
      return /^-?\d+$/.test(value);
    }
    return !!value && typeof (value as { toString?: unknown }).toString === 'function' && /^-?\d+$/.test(String(value));
  }

  function toBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return BigInt(value);
    }
    return BigInt(String(value));
  }

  function mustBeUtf16(string: string) {
    return Buffer.byteLength(string, 'utf8') !== string.length;
  }
} as BplistCreator;

function toEntries(dicts: any): Entry[] {
  if (dicts.bplistOverride) {
    return [dicts];
  }

  if (dicts instanceof Array) {
    return toEntriesArray(dicts);
  } else if (dicts instanceof Buffer) {
    return [
      {
        type: 'data',
        value: dicts
      }
    ];
  } else if (dicts instanceof Real) {
    return [
      {
        type: 'double',
        value: dicts.value
      }
    ];
  } else if (typeof(dicts) === 'object') {
    if (dicts instanceof Date) {
      return [
        {
          type: 'date',
          value: dicts
        }
      ];
    } else if (Object.keys(dicts).length === 1 && (typeof(dicts.UID) === 'number' || typeof(dicts.UID) === 'bigint')) {
      return [
        {
          type: 'UID',
          value: dicts.UID
        }
      ];
    } else {
      return toEntriesObject(dicts);
    }
  } else if (typeof(dicts) === 'string') {
    return [
      {
        type: 'string',
        value: dicts
      }
    ];
  } else if (typeof(dicts) === 'number') {
    return [
      {
        type: 'number',
        value: dicts
      }
    ];
  } else if (typeof(dicts) === 'boolean') {
    return [
      {
        type: 'boolean',
        value: dicts
      }
    ];
  } else if (typeof(dicts) === 'bigint') {
    return [
      {
        type: 'number',
        value: dicts
      }
    ];
  } else {
    throw new Error('unhandled entry: ' + dicts);
  }
}

function toEntriesArray(arr: any[]): Entry[] {
  if (debug) {
    console.log('toEntriesArray');
  }
  let results: Entry[] = [
    {
      type: 'array',
      entries: []
    }
  ];
  const arrayEntry = results[0] as ArrayEntry;
  arr.forEach(function(v) {
    const entry = toEntries(v);
    arrayEntry.entries.push(entry[0]);
    results = results.concat(entry);
  });
  return results;
}

function toEntriesObject(dict: Record<string, any>): Entry[] {
  if (debug) {
    console.log('toEntriesObject');
  }
  let results: Entry[] = [
    {
      type: 'dict',
      entryKeys: [],
      entryValues: []
    }
  ];
  const dictEntry = results[0] as DictEntry;
  Object.keys(dict).forEach(function(key) {
    const entryKey = toEntries(key);
    dictEntry.entryKeys.push(entryKey[0]);
    results = results.concat(entryKey[0]);
  });
  Object.keys(dict).forEach(function(key) {
    const entryValue = toEntries(dict[key]);
    dictEntry.entryValues.push(entryValue[0]);
    results = results.concat(entryValue);
  });
  return results;
}

function computeOffsetSizeInBytes(maxOffset: number): number {
  if (maxOffset < 256) {
    return 1;
  }
  if (maxOffset < 65536) {
    return 2;
  }
  if (maxOffset < 4294967296) {
    return 4;
  }
  return 8;
}

function computeIdSizeInBytes(numberOfIds: number): number {
  if (numberOfIds < 256) {
    return 1;
  }
  if (numberOfIds < 65536) {
    return 2;
  }
  return 4;
}

function computeUIDSizeInBytes(value: bigint): number {
  if (value < 0n) {
    throw new Error('UID out of range: ' + value);
  }
  if (value <= 0xffn) {
    return 1;
  }
  if (value <= 0xffffn) {
    return 2;
  }
  if (value <= 0xffffffffn) {
    return 4;
  }
  if (value <= 0xffffffffffffffffn) {
    return 8;
  }
  throw new Error('UID out of range: ' + value);
}

// Kept as a property of the default export so CommonJS consumers can continue
// to reach it via `require('bplist-creator').Real`.
bplistCreator.Real = Real;

export default bplistCreator;
