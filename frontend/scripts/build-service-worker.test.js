import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildFingerprint,
  buildServiceWorker,
  listPrecacheFiles,
  renderServiceWorker,
  shouldPrecache
} from './build-service-worker.mjs'

const temporaryDirectories = []
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const templateFile = path.join(scriptDirectory, '..', 'public', 'sw.js')

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'opengym-sw-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'assets'))
  await mkdir(path.join(root, 'img'))
  await writeFile(path.join(root, 'index.html'), '<main>openGym</main>')
  await writeFile(path.join(root, 'manifest.json'), '{}')
  await writeFile(path.join(root, 'assets', 'z.js'), 'z')
  await writeFile(path.join(root, 'assets', 'a.css'), 'a')
  await writeFile(path.join(root, 'img', 'exercise.jpg'), 'large dynamic media')
  await writeFile(path.join(root, 'bundle.js.map'), 'source map')
  await writeFile(path.join(root, 'sw.js'), 'old generated worker')
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('offline app-shell build', () => {
  it('selects a deterministic sorted manifest and excludes generated or runtime-only files', async () => {
    const root = await fixture()
    expect(await listPrecacheFiles(root)).toEqual([
      'assets/a.css',
      'assets/z.js',
      'index.html',
      'manifest.json'
    ])
    expect(shouldPrecache('sw.js')).toBe(false)
    expect(shouldPrecache('img/exercise.jpg')).toBe(false)
    expect(shouldPrecache('gif/exercise.gif')).toBe(false)
    expect(shouldPrecache('assets/app.js.map')).toBe(false)
  })

  it('derives the cache version from paths and file contents', async () => {
    const root = await fixture()
    const files = await listPrecacheFiles(root)
    const first = await buildFingerprint(root, files)
    expect(await buildFingerprint(root, [...files])).toBe(first)

    await writeFile(path.join(root, 'index.html'), '<main>new build</main>')
    expect(await buildFingerprint(root, files)).not.toBe(first)
  })

  it('injects every built asset and leaves no development cache version in dist', async () => {
    const root = await fixture()
    const result = await buildServiceWorker({ outputDirectory: root, templateFile })
    const generated = await readFile(path.join(root, 'sw.js'), 'utf8')

    expect(result.files).toContain('index.html')
    expect(generated).toContain(`const BUILD_ID = /* __OPENGYM_BUILD_ID__ */ '${result.fingerprint}'`)
    expect(generated).toContain('"./assets/a.css"')
    expect(generated).not.toContain("/* __OPENGYM_BUILD_ID__ */ 'development'")
    expect(generated).not.toContain('exercise.jpg')
  })

  it('fails the build if the template markers or application shell are missing', async () => {
    expect(() => renderServiceWorker('broken', ['index.html'], 'hash')).toThrow(/markers/)

    const root = await mkdtemp(path.join(tmpdir(), 'opengym-sw-empty-'))
    temporaryDirectories.push(root)
    await expect(buildServiceWorker({ outputDirectory: root, templateFile })).rejects.toThrow(/index\.html/)
  })
})
