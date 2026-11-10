// Apple's binary property lists ("bplist00"), which Safari keeps its bookmarks in. The file ends with a trailer saying
// how wide its numbers are, how many objects it has, which one is the top and where the table of their places is; each
// object starts with a byte whose high half is its type and low half its length (15: the length follows, as an int).
function parseBplist(buf) {
  if (buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') throw new Error('Not a binary property list');
  const t = buf.length - 32;
  const offsetSize = buf[t + 6];
  const refSize = buf[t + 7];
  const count = Number(buf.readBigUInt64BE(t + 8));
  const top = Number(buf.readBigUInt64BE(t + 16));
  const table = Number(buf.readBigUInt64BE(t + 24));
  const uint = (at, size) => {
    let n = 0;
    for (let i = 0; i < size; i += 1) n = n * 256 + buf[at + i];
    return n;
  };
  const offsets = Array.from({ length: count }, (_, i) => uint(table + i * offsetSize, offsetSize));
  const seen = new Set(); // (a list that contains itself is broken: not followed)
  const read = (ref) => {
    if (ref >= count || seen.has(ref)) return null;
    const at = offsets[ref];
    const marker = buf[at];
    const type = marker >> 4;
    let len = marker & 15;
    let body = at + 1;
    if (len === 15 && [4, 5, 6, 10, 12, 13].includes(type)) { // the length, as an int object of its own
      const size = 1 << (buf[body] & 15);
      len = uint(body + 1, size);
      body += 1 + size;
    }
    switch (type) {
      case 0: return marker === 9 ? true : marker === 8 ? false : null;
      case 1: { const size = 1 << len; return size === 8 ? Number(buf.readBigInt64BE(body)) : uint(body, size); }
      case 2: return len === 2 ? buf.readFloatBE(body) : buf.readDoubleBE(body);
      case 3: return new Date((buf.readDoubleBE(body) + 978307200) * 1000); // seconds since 2001
      case 4: return buf.subarray(body, body + len);
      case 5: return buf.toString('latin1', body, body + len);
      case 6: { // UTF-16, big-endian
        const s = Buffer.from(buf.subarray(body, body + len * 2));
        s.swap16();
        return s.toString('utf16le');
      }
      case 8: return { uid: uint(body, len + 1) };
      case 10: case 12: { // array, set
        seen.add(ref);
        const out = Array.from({ length: len }, (_, i) => read(uint(body + i * refSize, refSize)));
        seen.delete(ref);
        return out;
      }
      case 13: { // dictionary: its keys, then its values
        seen.add(ref);
        const out = {};
        for (let i = 0; i < len; i += 1) {
          const key = read(uint(body + i * refSize, refSize));
          out[String(key)] = read(uint(body + (len + i) * refSize, refSize));
        }
        seen.delete(ref);
        return out;
      }
      default: return null;
    }
  };
  return read(top);
}

module.exports = { parseBplist };
