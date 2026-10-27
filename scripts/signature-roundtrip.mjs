import { DocumentEngine, locateEngine } from '../electron/engine.mjs'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
if (!process.argv[2]) throw new Error('Usage: pnpm test:signature <path-to-sample.doc>')
await mkdir('test-output', { recursive: true })
const program = locateEngine(process.cwd())
if (!program) throw new Error('Run pnpm setup:engine before testing the document engine.')
const unit = spawnSync(path.join(program, 'python.exe'), ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], { stdio: 'inherit', windowsHide: true })
if (unit.status !== 0) throw new Error('Floating-frame guard tests failed.')
const engine = new DocumentEngine(program, path.resolve('tests/signature_fast_roundtrip.py'))
try {
  await engine.start()
  const result = await engine.request('verify', { source: path.resolve(process.argv[2]), output: path.resolve('test-output/signature-edited.doc') })
  console.log('PASS: signature text and fonts edit/save/reopen, floating frames and bookmarks preserved, original unchanged.', result)
} finally { await engine.close() }
