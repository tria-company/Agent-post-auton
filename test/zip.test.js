/**
 * test/zip.test.js
 *
 * Testes de segurança e funcionalidade para src/lib/zip.js.
 *
 * Cobre:
 *   - SSRF guard: protocolo não-https rejeita ANTES de fetch (T-02-04)
 *   - Magic bytes: conteúdo não-zip lança antes de instanciar AdmZip (T-02-07)
 *   - Zip-bomb: arrayBuffer > 100 MB lança antes de descomprimir (T-02-05)
 *   - Zip-slip: entry com '../' não escreve fora do tmpDir (T-02-06)
 *   - Ordenação numérica: 2.jpg,10.jpg,1.jpg → 1,2,10
 *   - mimeFromFilename: .jpg→image/jpeg, .mp4→video/mp4, desconhecido→application/octet-stream
 *   - uploadMedia: monta FormData sem Content-Type; 4xx vira AppError; sucesso retorna {url,fileId}
 */

import 'dotenv/config';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppError } from '../src/lib/errors.js';
import { config } from '../src/config/index.js';

// ---------------------------------------------------------------------------
// Helper: cria um Buffer de zip válido com os arquivos especificados
// ---------------------------------------------------------------------------

/**
 * Cria um Buffer de zip válido contendo os arquivos informados.
 * @param {Array<{name: string, content: string|Buffer}>} files
 * @returns {Buffer}
 */
function createZipBuffer(files) {
  const zip = new AdmZip();
  for (const f of files) {
    zip.addFile(f.name, Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
  }
  return zip.toBuffer();
}

/**
 * Cria um Buffer de zip válido com um arquivo de mídia de nome numérico.
 * Suficiente para todos os testes de extração funcional.
 */
function createSingleFileZip(name = '1.jpg', content = 'fake-image-data') {
  return createZipBuffer([{ name, content }]);
}

// ---------------------------------------------------------------------------
// Helper: fakeResponse compatível com fetch
// ---------------------------------------------------------------------------
function fakeResponse(status, body = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
    async arrayBuffer() {
      // Para testes de zip: retorna buffer de zip válido se body for Buffer
      if (Buffer.isBuffer(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      return Buffer.from(JSON.stringify(body)).buffer;
    },
  };
}

// ---------------------------------------------------------------------------
// Importar módulo (dinâmico pois depende de config via dotenv)
// ---------------------------------------------------------------------------
const { downloadAndExtract, cleanupTmp, mimeFromFilename } = await import('../src/lib/zip.js');

// ---------------------------------------------------------------------------
// TEST: mimeFromFilename
// ---------------------------------------------------------------------------

test('mimeFromFilename: .jpg → image/jpeg', () => {
  assert.strictEqual(mimeFromFilename('photo.jpg'), 'image/jpeg');
});

test('mimeFromFilename: .jpeg → image/jpeg', () => {
  assert.strictEqual(mimeFromFilename('photo.jpeg'), 'image/jpeg');
});

test('mimeFromFilename: .mp4 → video/mp4', () => {
  assert.strictEqual(mimeFromFilename('video.mp4'), 'video/mp4');
});

test('mimeFromFilename: .mov → video/quicktime', () => {
  assert.strictEqual(mimeFromFilename('clip.mov'), 'video/quicktime');
});

test('mimeFromFilename: .png → image/png', () => {
  assert.strictEqual(mimeFromFilename('image.png'), 'image/png');
});

test('mimeFromFilename: extensão desconhecida → application/octet-stream', () => {
  assert.strictEqual(mimeFromFilename('arquivo.xyz'), 'application/octet-stream');
  assert.strictEqual(mimeFromFilename('sem-extensao'), 'application/octet-stream');
});

// ---------------------------------------------------------------------------
// TEST: SSRF guard — protocolo não-https deve lançar ANTES de chamar fetch (T-02-04)
// ---------------------------------------------------------------------------

test('downloadAndExtract: URL com protocolo ftp:// lança erro de SSRF ANTES de fetch', async (t) => {
  let fetchCalled = false;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    fetchCalled = true;
    return fakeResponse(200, {});
  });

  await assert.rejects(
    () => downloadAndExtract('ftp://evil.com/malware.zip'),
    (err) => {
      assert.ok(err instanceof Error, 'Deve lançar Error');
      assert.ok(
        err.message.toLowerCase().includes('https') || err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('protocolo'),
        `Mensagem deve mencionar SSRF/https/protocolo. Recebido: ${err.message}`,
      );
      return true;
    },
  );

  assert.strictEqual(fetchCalled, false, 'fetch NÃO deve ser chamado para protocolo inválido (SSRF guard)');
  fetchMock.mock.restore();
});

test('downloadAndExtract: URL com protocolo http:// lança erro de SSRF ANTES de fetch', async (t) => {
  let fetchCalled = false;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    fetchCalled = true;
    return fakeResponse(200, {});
  });

  await assert.rejects(
    () => downloadAndExtract('http://minio.example.com/media.zip'),
    (err) => {
      assert.ok(err.message.toLowerCase().includes('https') || err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('protocolo'));
      return true;
    },
  );

  assert.strictEqual(fetchCalled, false, 'fetch NÃO deve ser chamado para http:// (SSRF guard)');
  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST: Magic bytes — conteúdo não-zip lança ANTES de instanciar AdmZip (T-02-07)
// ---------------------------------------------------------------------------

test('downloadAndExtract: buffer sem magic bytes PK\\x03\\x04 lança erro de conteúdo não-zip', async (t) => {
  // Buffer com 100 bytes de conteúdo inválido (não-zip)
  const invalidContent = Buffer.alloc(100, 0x41); // 'AAAA...' sem PK magic

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    async arrayBuffer() {
      return invalidContent.buffer.slice(
        invalidContent.byteOffset,
        invalidContent.byteOffset + invalidContent.byteLength,
      );
    },
  }));

  await assert.rejects(
    () => downloadAndExtract('https://minio.example.com/media.zip'),
    (err) => {
      assert.ok(
        err.message.toLowerCase().includes('zip') || err.message.toLowerCase().includes('magic') || err.message.toLowerCase().includes('pk'),
        `Mensagem deve mencionar zip/magic/PK. Recebido: ${err.message}`,
      );
      return true;
    },
  );

  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST: Zip-bomb guard — arrayBuffer > 100 MB lança antes de descomprimir (T-02-05)
// ---------------------------------------------------------------------------

test('downloadAndExtract: arrayBuffer acima do limite lança erro antes de descomprimir', async (t) => {
  const MAX_BYTES = config.MAX_DOWNLOAD_MB * 1024 * 1024;

  // Simula retorno de arrayBuffer com tamanho > 100 MB
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    async arrayBuffer() {
      // Retorna um ArrayBuffer com byteLength > 100 MB sem alocar memória real
      // Usa um Proxy para simular o tamanho
      const ab = new ArrayBuffer(0);
      Object.defineProperty(ab, 'byteLength', { value: MAX_BYTES + 1 });
      return ab;
    },
  }));

  await assert.rejects(
    () => downloadAndExtract('https://minio.example.com/big.zip'),
    (err) => {
      assert.ok(
        err.message.toLowerCase().includes('mb') || err.message.toLowerCase().includes('limite') || err.message.toLowerCase().includes('excede'),
        `Mensagem deve mencionar MB/limite/excede. Recebido: ${err.message}`,
      );
      return true;
    },
  );

  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST: Zip-slip — entry com '../' não escreve fora do tmpDir (T-02-06, HIGH)
// ---------------------------------------------------------------------------

test('downloadAndExtract: entry com "../evil.txt" não escreve fora do tmpDir (zip-slip)', async (t) => {
  // Criar zip com entry malicioso — o nome de entry contém traversal
  // AdmZip preserva o nome como está (sem normalizar), então o guard
  // deve detectar e descartar ou lançar
  const zip = new AdmZip();
  zip.addFile('../evil.txt', Buffer.from('conteudo malicioso'));
  zip.addFile('safe.jpg', Buffer.from('imagem valida'));
  const zipBuffer = zip.toBuffer();

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    async arrayBuffer() {
      return zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength);
    },
  }));

  // O comportamento esperado: o guard de zip-slip descarta ou lança para a entry maliciosa.
  // O arquivo 'evil.txt' NÃO deve existir fora do tmpDir.
  // Pode ou não lançar (dependendo da implementação: throw vs. skip).
  // O que importa: o arquivo não foi criado fora do tmp.
  let result;
  try {
    result = await downloadAndExtract('https://minio.example.com/evil.zip');
  } catch {
    // Também aceitável: lançar para zip-slip
    fetchMock.mock.restore();
    return; // teste passou (lançou corretamente)
  }

  // Se não lançou: o arquivo malicioso NÃO deve ter sido escrito fora do tmpDir
  // Caminhos comuns de escape:
  const projectRoot = resolve(process.cwd());
  const evilPaths = [
    join(projectRoot, 'evil.txt'),
    join(tmpdir(), '..', 'evil.txt'),
    resolve('evil.txt'),
  ];

  for (const p of evilPaths) {
    assert.strictEqual(
      existsSync(p),
      false,
      `Arquivo zip-slip NÃO deve existir em: ${p}`,
    );
  }

  // O arquivo safe.jpg PODE ter sido extraído normalmente
  // (comportamento: skip do malicioso, processa o safe)
  await cleanupTmp(result?.tmpDir);
  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST: Ordenação numérica — 2.jpg, 10.jpg, 1.jpg → 1, 2, 10
// ---------------------------------------------------------------------------

test('downloadAndExtract: arquivos ordenados numericamente (1,2,10 não lexicograficamente)', async (t) => {
  // Criar zip com arquivos em ordem desordenada
  const zipBuffer = createZipBuffer([
    { name: '2.jpg',  content: 'img2' },
    { name: '10.jpg', content: 'img10' },
    { name: '1.jpg',  content: 'img1' },
  ]);

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    async arrayBuffer() {
      return zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength);
    },
  }));

  const { files, tmpDir } = await downloadAndExtract('https://minio.example.com/media.zip');

  assert.strictEqual(files.length, 3, 'Deve retornar 3 arquivos');
  assert.strictEqual(files[0].name, '1.jpg',  'Primeiro deve ser 1.jpg');
  assert.strictEqual(files[1].name, '2.jpg',  'Segundo deve ser 2.jpg');
  assert.strictEqual(files[2].name, '10.jpg', 'Terceiro deve ser 10.jpg (não lexicográfico)');

  await cleanupTmp(tmpDir);
  fetchMock.mock.restore();
});

test('downloadAndExtract: filtra __MACOSX e .DS_Store', async (t) => {
  const zipBuffer = createZipBuffer([
    { name: '1.jpg',                    content: 'img1' },
    { name: '__MACOSX/._1.jpg',         content: 'mac junk' },
    { name: '.DS_Store',                content: 'ds store' },
    { name: '__MACOSX/.DS_Store',       content: 'nested ds' },
  ]);

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    async arrayBuffer() {
      return zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength);
    },
  }));

  const { files, tmpDir } = await downloadAndExtract('https://minio.example.com/media.zip');

  // Apenas 1.jpg deve ter sido extraído
  assert.strictEqual(files.length, 1, 'Apenas 1 arquivo real deve ser extraído (sem __MACOSX/.DS_Store)');
  assert.strictEqual(files[0].name, '1.jpg', 'O arquivo deve ser 1.jpg');

  await cleanupTmp(tmpDir);
  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST: uploadMedia — NÃO seta Content-Type; 4xx vira AppError; sucesso {url,fileId}
// ---------------------------------------------------------------------------

test('ghl.uploadMedia: sucesso retorna {url, fileId}', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    fakeResponse(200, { url: 'https://cdn.ghl.com/media/test.jpg', fileId: 'FILE001' }),
  );

  const { ghl } = await import('../src/clients/ghl.js');
  const result = await ghl.uploadMedia(Buffer.from('fake'), 'test.jpg', 'image/jpeg');

  assert.strictEqual(result.url, 'https://cdn.ghl.com/media/test.jpg', 'url deve estar presente');
  assert.strictEqual(result.fileId, 'FILE001', 'fileId deve estar presente');

  fetchMock.mock.restore();
});

test('ghl.uploadMedia: NÃO seta Content-Type manual (FormData define boundary)', async (t) => {
  let capturedHeaders;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    capturedHeaders = opts?.headers ?? {};
    return fakeResponse(200, { url: 'https://cdn.ghl.com/test.jpg', fileId: 'F1' });
  });

  const { ghl } = await import('../src/clients/ghl.js');
  await ghl.uploadMedia(Buffer.from('fake'), 'test.jpg', 'image/jpeg');

  // Headers capturados como objeto plano
  const headersObj = capturedHeaders;
  const contentTypeKey = Object.keys(headersObj).find(
    (k) => k.toLowerCase() === 'content-type',
  );

  assert.strictEqual(
    contentTypeKey,
    undefined,
    `uploadMedia NÃO deve setar Content-Type manualmente (boundary é automático do FormData). Headers: ${JSON.stringify(headersObj)}`,
  );

  fetchMock.mock.restore();
});

test('ghl.uploadMedia: 4xx não-429 vira AppError (não retenta)', async (t) => {
  let callCount = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return fakeResponse(400, { message: 'Bad Request', statusCode: 400 });
  });

  const { ghl } = await import('../src/clients/ghl.js');

  let caughtErr;
  try {
    await ghl.uploadMedia(Buffer.from('fake'), 'bad.jpg', 'image/jpeg');
  } catch (err) {
    caughtErr = err;
  }

  assert.ok(caughtErr instanceof AppError, `Deve lançar AppError para 4xx. Got: ${caughtErr?.constructor?.name}`);
  assert.strictEqual(caughtErr.status, 400, 'AppError.status deve ser 400');
  assert.strictEqual(callCount, 1, 'NÃO deve retentar para 4xx — AbortError pára p-retry');

  fetchMock.mock.restore();
});
