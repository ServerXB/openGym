import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BUILD_MARKER = /const BUILD_ID = \/\* __OPENGYM_BUILD_ID__ \*\/ '[^']*'/
const PRECACHE_MARKER = /const PRECACHE_URLS = \/\* __OPENGYM_PRECACHE__ \*\/ \[[^\n]*\]/

function slash(value) {
  return value.split(path.sep).join('/')
}

export function shouldPrecache(relativePath) {
  const name = slash(relativePath)
  return name !== 'sw.js' &&
    !name.endsWith('.map') &&
    !name.startsWith('img/') &&
    !name.startsWith('gif/')
}

export async function listPrecacheFiles(outputDirectory, directory = outputDirectory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listPrecacheFiles(outputDirectory, absolute))
    else {
      const relative = slash(path.relative(outputDirectory, absolute))
      if (shouldPrecache(relative)) files.push(relative)
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

export async function buildFingerprint(outputDirectory, files) {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(await readFile(path.join(outputDirectory, file)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

export function renderServiceWorker(template, files, fingerprint) {
  if (!BUILD_MARKER.test(template) || !PRECACHE_MARKER.test(template)) {
    throw new Error('Service-worker build markers are missing or malformed')
  }

  const urls = files.map(file => `./${file}`)
  return template
    .replace(BUILD_MARKER, `const BUILD_ID = /* __OPENGYM_BUILD_ID__ */ '${fingerprint}'`)
    .replace(PRECACHE_MARKER, `const PRECACHE_URLS = /* __OPENGYM_PRECACHE__ */ ${JSON.stringify(urls)}`)
}

export async function buildServiceWorker({ outputDirectory, templateFile }) {
  const files = await listPrecacheFiles(outputDirectory)
  if (!files.includes('index.html')) throw new Error('Cannot build the offline shell without index.html')

  const fingerprint = await buildFingerprint(outputDirectory, files)
  const template = await readFile(templateFile, 'utf8')
  const output = renderServiceWorker(template, files, fingerprint)
  await writeFile(path.join(outputDirectory, 'sw.js'), output, 'utf8')
  return { files, fingerprint }
}
