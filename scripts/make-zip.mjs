import fs from 'fs';
import path from 'path';
import { createDeflateRaw } from 'zlib';

const distDir = path.resolve('dist');
const outZip = path.resolve('assets.zip');

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function deflate(data) {
  return new Promise((resolve, reject) => {
    const d = createDeflateRaw({ level: 6 });
    const bufs = [];
    d.on('data', b => bufs.push(b));
    d.on('end', () => resolve(Buffer.concat(bufs)));
    d.on('error', reject);
    d.end(data);
  });
}

const files = [];
function walk(dir, base) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const rel = base ? `${base}/${f}` : f;
    if (fs.statSync(full).isDirectory()) {
      walk(full, rel);
    } else {
      files.push({ zipPath: rel, fullPath: full });
    }
  }
}
walk(distDir, '');

console.log('Zipping files:');
files.forEach(f => console.log(' ', f.zipPath));

const now = new Date();
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

const chunks = [];
const centralDir = [];
let offset = 0;

for (const { zipPath, fullPath } of files) {
  const data = fs.readFileSync(fullPath);
  const compressed = await deflate(data);
  const nameBytes = Buffer.from(zipPath, 'utf8'); // forward slashes already
  const crc = crc32(data);

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  nameBytes.copy(central, 46);

  chunks.push(local, compressed);
  centralDir.push(central);
  offset += local.length + compressed.length;
}

const centralDirBuf = Buffer.concat(centralDir);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralDirBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.writeFileSync(outZip, Buffer.concat([...chunks, centralDirBuf, eocd]));
console.log(`\nCreated assets.zip (${(fs.statSync(outZip).size / 1024).toFixed(1)} KB)`);
console.log('Entry paths use forward slashes - ready for Amplify upload.');
