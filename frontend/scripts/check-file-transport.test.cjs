/* Exercise the actual TypeScript transport with isolated HTTP/storage boundaries. */
/* global __dirname, Buffer */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function client(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../src/api/client.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, fetch, Blob, FormData, Headers, AbortController, setTimeout, clearTimeout,
    process: { env: { EXPO_PUBLIC_BACKEND_URL: 'https://staging.invalid' } },
    require(name) {
      if (name === 'react-native') return { Platform: { OS: 'web' } };
      if (name === '@/src/utils/storage') return { storage: { secureGet: async () => 'test-token' } };
      if (name === '@/config/public-env') return { normalizeBackendUrl: value => value };
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

test('large web upload preserves bytes, auth and legacy returned path', async () => {
  const data = new Uint8Array(5 * 1024 * 1024).fill(71);
  const chunks = [];
  const api = client(async (url, init) => {
    if (url === 'blob:test') return new Response(data);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-token');
    assert(!url.includes('test-token'));
    if (url.endsWith('/chunks')) {
      assert.equal(JSON.parse(init.body).size, data.length);
      return Response.json({ id: 'upload', chunk_size: 3 * 1024 * 1024 });
    }
    if (url.endsWith('/complete')) return Response.json({ path: 'bring-gift-card/uploads/user/image.jpg' });
    assert.equal(init.method, 'PUT');
    assert(init.body.byteLength <= 3 * 1024 * 1024);
    chunks.push(Buffer.from(init.body));
    return Response.json({ ok: true });
  });
  assert.equal(await api.uploadImage('blob:test'), 'bring-gift-card/uploads/user/image.jpg');
  assert.equal(chunks.length, 2);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(data));
});

test('private image ranges reassemble bytes without credentials in URLs', async () => {
  const data = new Uint8Array(5 * 1024 * 1024).fill(93);
  let count = 0;
  const api = client(async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert(!url.includes('test-token'));
    const [, startText, endText] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    const start = Number(startText), end = Math.min(Number(endText), data.length - 1);
    count++;
    return new Response(data.slice(start, end + 1), { status: 206,
      headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${start}-${end}/${data.length}` } });
  });
  const blob = await api.privateImageBlob('https://staging.invalid/api/files/private.jpg', { Authorization: 'Bearer test-token' });
  assert.equal(count, 2);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(data));
});

test('malformed or unauthorized private downloads fail instead of displaying partial data', async () => {
  let api = client(async () => new Response('denied', { status: 403 }));
  await assert.rejects(api.privateImageBlob('https://staging.invalid/file'), { status: 403 });
  api = client(async () => new Response('partial', { status: 206, headers: { 'content-range': 'bytes 100-106/200' } }));
  await assert.rejects(api.privateImageBlob('https://staging.invalid/file'), { status: 502 });
});
