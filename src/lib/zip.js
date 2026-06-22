/**
 * src/lib/zip.js
 *
 * Helper de download + extração segura de zips do MinIO para uso no pipeline
 * de agendamento ClickUp → GHL.
 *
 * Guardas de segurança implementadas (STRIDE Threat Register 02-02-PLAN.md):
 *   T-02-04  SSRF: valida protocol === 'https:' ANTES de fazer fetch
 *   T-02-05  Zip-bomb: teto MAX_DOWNLOAD_BYTES (100 MB) antes de descomprimir
 *   T-02-07  Conteúdo não-zip: verifica magic bytes PK\x03\x04 antes de criar AdmZip
 *   T-02-06  Zip-slip: basename + relative(tmpDir, resolve(tmpDir, name)) não começa com '..'
 *   T-02-03  Info Disclosure: NUNCA logar zipUrl (só taskId+fileName em camadas superiores)
 *
 * Exportações:
 *   downloadAndExtract(zipUrl) → Promise<{ files: Array<{name,path,buffer}>, tmpDir: string }>
 *   cleanupTmp(tmpDir)         → Promise<void>
 *   mimeFromFilename(filename) → string
 */

import AdmZip from 'adm-zip';
import { tmpdir } from 'node:os';
import { join, relative, resolve, basename, extname } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Teto de download: 100 MB (proteção contra zip-bomb / downloads gigantes) */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/** Mapeamento extensão → MIME type */
const MIME_BY_EXT = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
};

/** Magic bytes do formato ZIP: PK\x03\x04 */
const ZIP_MAGIC = [0x50, 0x4B, 0x03, 0x04];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Retorna o MIME type correspondente à extensão do filename.
 * Extensões desconhecidas retornam 'application/octet-stream'.
 *
 * @param {string} filename
 * @returns {string}
 */
export function mimeFromFilename(filename) {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Baixa um arquivo zip de uma URL HTTPS (pré-assinada MinIO ou pública),
 * valida e descompacta com guardas de segurança, e retorna os arquivos extraídos
 * ordenados numericamente por nome.
 *
 * NUNCA logar `zipUrl` — apenas taskId e fileName devem aparecer em logs (T-02-03).
 *
 * Ordem das validações (obrigatória):
 *   1. SSRF guard: URL deve usar protocol 'https:' (T-02-04)
 *   2. Fetch + arrayBuffer com teto de 100 MB (T-02-05)
 *   3. Magic bytes PK\x03\x04 (T-02-07)
 *   4. AdmZip: iterar entries com zip-slip guard + filtro de sistema (T-02-06)
 *   5. Escrever em tmpDir e ordenar numericamente
 *
 * @param {string} zipUrl - URL HTTPS do zip a baixar
 * @returns {Promise<{ files: Array<{name: string, path: string, buffer: Buffer}>, tmpDir: string }>}
 * @throws {Error} Se a URL não for HTTPS, o conteúdo não for zip, exceder 100 MB, ou zip-slip detectado
 */
export async function downloadAndExtract(zipUrl) {
  // --- 1. SSRF guard: validar protocolo ANTES de qualquer fetch (T-02-04, HIGH) ---
  let parsedUrl;
  try {
    parsedUrl = new URL(zipUrl);
  } catch {
    throw new Error(`URL inválida: não foi possível parsear "${zipUrl.slice(0, 30)}..."`);
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(
      `SSRF guard: URL deve usar protocolo https:// (recebido: ${parsedUrl.protocol})`,
    );
  }

  // --- 2. Download com teto de tamanho (T-02-05, zip-bomb guard) ---
  // NUNCA logar zipUrl aqui
  const response = await fetch(zipUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar zip: HTTP ${response.status}`);
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Arquivo excede o limite de ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB ` +
      `(recebido: ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`,
    );
  }

  const zipBuffer = Buffer.from(buf);

  // --- 3. Validação de magic bytes: PK\x03\x04 (T-02-07) ---
  if (
    zipBuffer.length < 4 ||
    zipBuffer[0] !== ZIP_MAGIC[0] ||
    zipBuffer[1] !== ZIP_MAGIC[1] ||
    zipBuffer[2] !== ZIP_MAGIC[2] ||
    zipBuffer[3] !== ZIP_MAGIC[3]
  ) {
    throw new Error('Conteúdo não-zip: magic bytes inválidos (esperado PK\\x03\\x04)');
  }

  // --- 4. Extração com AdmZip + zip-slip guard (T-02-06, HIGH) ---
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Diretório temporário único por execução
  const tmpDir = join(tmpdir(), `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(tmpDir, { recursive: true });

  const files = [];

  for (const entry of entries) {
    // Pular diretórios
    if (entry.isDirectory) continue;

    const entryName = entry.entryName;

    // Pular arquivos de sistema (__MACOSX, .DS_Store, arquivos começando com '.')
    const base = basename(entryName);
    if (
      base.startsWith('.') ||
      base.startsWith('__') ||
      entryName.includes('__MACOSX/')
    ) {
      continue;
    }

    // ZIP-SLIP GUARD (HIGH — T-02-06):
    // Usar basename para remover qualquer componente de path do entry name,
    // depois verificar que o caminho resolvido fica dentro do tmpDir.
    const safeName = basename(entryName);
    const destPath = resolve(tmpDir, safeName);
    const rel = relative(tmpDir, destPath);

    // Se rel começa com '..' ou é um caminho absoluto → zip-slip detectado
    if (rel.startsWith('..') || resolve(destPath) !== destPath) {
      throw new Error(`Zip-slip detectado: entry "${entryName}" resultaria em path fora do tmpDir`);
    }
    // Verificação adicional: caminho absoluto indica tentativa de escape
    if (safeName !== base) {
      throw new Error(`Zip-slip detectado: nome de arquivo suspeito "${entryName}"`);
    }

    const fileBuffer = entry.getData();
    await writeFile(destPath, fileBuffer);

    files.push({ name: safeName, path: destPath, buffer: fileBuffer });
  }

  // --- 5. Ordenação numérica (parseInt) com fallback localeCompare ---
  files.sort((a, b) => {
    const numA = parseInt(a.name, 10);
    const numB = parseInt(b.name, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.name.localeCompare(b.name);
  });

  return { files, tmpDir };
}

/**
 * Remove o diretório temporário de extração.
 * Silencioso em caso de erro (já pode ter sido removido ou não existir).
 *
 * @param {string} tmpDir - Caminho do diretório a remover
 * @returns {Promise<void>}
 */
export async function cleanupTmp(tmpDir) {
  if (!tmpDir) return;
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
