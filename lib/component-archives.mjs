// Deliberately narrow readers for official npm tgz and Astral ZIP artifacts.
// No executable extractor, links, devices, Windows aliases, or overwrites.
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const MAX = 512 * 1024 * 1024;
export function archivePath(root, name) {
  const parts = name.replace(/\/$/, '').split('/');
  if (
    !name ||
    /[\\:\x00-\x1f]/.test(name) ||
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
    )
  )
    throw new Error('unsafe_archive');
  const path = resolve(root, ...parts);
  if (!path.startsWith(resolve(root) + sep)) throw new Error('unsafe_archive');
  return path;
}
async function publish(entries, root) {
  const seen = new Set();
  let bytes = 0;
  // Validate the entire inventory before writing any entry.
  for (const entry of entries) {
    entry.path = archivePath(root, entry.name);
    const key = entry.path.toLowerCase();
    if (seen.has(key) || (bytes += entry.data.length) > MAX) throw new Error('unsafe_archive');
    seen.add(key);
  }
  // Destination must be new; its parent belongs to our fresh staging directory.
  await mkdir(root);
  for (const entry of entries) {
    if (entry.directory) await mkdir(entry.path, { recursive: true });
    else {
      await mkdir(dirname(entry.path), { recursive: true });
      await writeFile(entry.path, entry.data, { flag: 'wx' });
    }
  }
}
export async function extractTgz(buffer, root) {
  const tar = gunzipSync(buffer, { maxOutputLength: MAX });
  const entries = [];
  let pax = {};
  const field = (b, a, z) => b.subarray(a, z).toString('utf8').split('\0')[0];
  const octal = (s) => {
    if (!/^[0-7]+$/.test(s.trim())) throw new Error('unsafe_archive');
    return parseInt(s.trim(), 8);
  };
  let ended = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every((n) => n === 0)) {
      ended = true;
      break;
    }
    const checksum = h.reduce((sum, n, i) => sum + (i >= 148 && i < 156 ? 32 : n), 0);
    if (octal(field(h, 148, 156)) !== checksum) throw new Error('unsafe_archive');
    const size = octal(field(h, 124, 136));
    const type = field(h, 156, 157);
    if (offset + 512 + size > tar.length) throw new Error('unsafe_archive');
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = {};
      for (let p = 0; p < data.length;) {
        const space = data.indexOf(32, p);
        const count = Number(data.subarray(p, space).toString());
        if (space < p || !Number.isSafeInteger(count) || count <= space - p + 1 || p + count > data.length)
          throw new Error('unsafe_archive');
        const line = data.subarray(space + 1, p + count - 1).toString();
        const equal = line.indexOf('=');
        const key = line.slice(0, equal);
        if (!['path', 'mtime', 'atime', 'ctime'].includes(key)) throw new Error('unsafe_archive');
        pax[key] = line.slice(equal + 1);
        p += count;
      }
      continue;
    }
    if (!['', '0', '5'].includes(type)) throw new Error('unsafe_archive');
    const prefix = field(h, 345, 500);
    const name = pax.path || (prefix ? prefix + '/' : '') + field(h, 0, 100);
    pax = {};
    entries.push({ name, directory: type === '5', data });
    if (entries.length > 30000) throw new Error('unsafe_archive');
  }
  if (!ended || !entries.length) throw new Error('unsafe_archive');
  await publish(entries, root);
}
export async function extractZip(buffer, root) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || buffer.readUInt32LE(end) !== 0x06054b50 || buffer.readUInt32LE(end + 4) !== 0)
    throw new Error('unsafe_archive');
  const count = buffer.readUInt16LE(end + 10);
  if (!count || count > 1000 || count !== buffer.readUInt16LE(end + 8)) throw new Error('unsafe_archive');
  let offset = buffer.readUInt32LE(end + 16),
    total = 0;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('unsafe_archive');
    const flags = buffer.readUInt16LE(offset + 8),
      method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20),
      size = buffer.readUInt32LE(offset + 24);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const mode = buffer.readUInt32LE(offset + 38) >>> 16;
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (flags & 1 || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000 || (total += size) > MAX)
      throw new Error('unsafe_archive');
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50)
      throw new Error('unsafe_archive');
    const localNameSize = buffer.readUInt16LE(local + 26);
    if (buffer.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== name)
      throw new Error('unsafe_archive');
    const start = local + 30 + localNameSize + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new Error('unsafe_archive');
    const packed = buffer.subarray(start, start + compressed);
    const data = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size) throw new Error('unsafe_archive');
    entries.push({ name, directory: name.endsWith('/'), data });
    offset += 46 + nameSize + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  await publish(entries, root);
}
