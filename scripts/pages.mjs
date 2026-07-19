import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const DOCS = path.join(ROOT, 'docs');
const PUBLIC_BASE = '/rettoroulette/';
const DEPLOYMENT_URL = 'https://11qaws.github.io/rettoroulette/';

function assetReferences(html) {
  return [...html.matchAll(/(?:src|href)="(\/rettoroulette\/assets\/[^"?#]+)"/g)]
    .map((match) => match[1]);
}

function localPathFromPublic(reference) {
  if (!reference.startsWith(PUBLIC_BASE)) {
    throw new Error(`Unexpected public path: ${reference}`);
  }
  return path.join(DOCS, reference.slice(PUBLIC_BASE.length));
}

async function hashFile(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function verifyLocal() {
  const docsIndex = path.join(DOCS, 'index.html');
  const html = await readFile(docsIndex, 'utf8');
  if (!html.includes('<title>Retto Roulette</title>')) throw new Error('docs/index.html title mismatch');

  const references = assetReferences(html);
  if (references.length !== 2) {
    throw new Error(`Expected one JS and one CSS asset, found ${references.length}`);
  }

  const expectedAssets = new Set(references.map((reference) => path.basename(reference)));
  for (const reference of references) await access(localPathFromPublic(reference));

  const actualAssets = new Set(await readdir(path.join(DOCS, 'assets')));
  const staleAssets = [...actualAssets].filter((name) => !expectedAssets.has(name));
  if (staleAssets.length > 0) throw new Error(`Stale docs assets: ${staleAssets.join(', ')}`);

  try {
    const distIndex = path.join(DIST, 'index.html');
    if (await hashFile(distIndex) !== await hashFile(docsIndex)) {
      throw new Error('dist/index.html and docs/index.html differ');
    }
    for (const name of expectedAssets) {
      if (await hashFile(path.join(DIST, 'assets', name)) !== await hashFile(path.join(DOCS, 'assets', name))) {
        throw new Error(`dist/docs asset mismatch: ${name}`);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  console.log(`Pages local check: OK (${[...expectedAssets].join(', ')})`);
  return references;
}

async function sync() {
  await access(path.join(DIST, 'index.html'));
  await rm(path.join(DOCS, 'assets'), { recursive: true, force: true });
  await mkdir(path.join(DOCS, 'assets'), { recursive: true });
  await cp(path.join(DIST, 'assets'), path.join(DOCS, 'assets'), { recursive: true });
  await cp(path.join(DIST, 'index.html'), path.join(DOCS, 'index.html'));
  await cp(path.join(DIST, 'retto-wheel.svg'), path.join(DOCS, 'retto-wheel.svg'));
  await verifyLocal();
}

async function health() {
  const expectedReferences = await verifyLocal();
  const response = await fetch(`${DEPLOYMENT_URL}?health=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`Deployment returned HTTP ${response.status}`);

  const remoteHtml = await response.text();
  const remoteReferences = assetReferences(remoteHtml);
  if (remoteReferences.join('\n') !== expectedReferences.join('\n')) {
    throw new Error(`Deployment assets do not match docs. Remote: ${remoteReferences.join(', ')}`);
  }

  for (const reference of remoteReferences) {
    const assetResponse = await fetch(new URL(reference, DEPLOYMENT_URL), { method: 'HEAD' });
    if (!assetResponse.ok) throw new Error(`${reference} returned HTTP ${assetResponse.status}`);
  }
  console.log(`Pages health check: OK (${DEPLOYMENT_URL})`);
}

const command = process.argv[2] ?? 'verify';
if (command === 'sync') await sync();
else if (command === 'verify') await verifyLocal();
else if (command === 'health') await health();
else throw new Error(`Unknown command: ${command}`);
