import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {DocumentEngine} from '../electron/engine.mjs'

test('concurrent starts share initialization and closing before spawn leaves no processes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nebula-engine-test-'))
  const engine = new DocumentEngine('not-used', 'not-used', {profileDirectory: path.join(directory, 'profile')})
  try {
    const first = engine.start(), second = engine.start()
    assert.equal(first, second)
    const closing = engine.close()
    await assert.rejects(first, /closed during startup/)
    await closing
    assert.equal(engine.child, undefined)
    assert.equal(engine.office, undefined)
    assert.equal(engine.pending.size, 0)
    await assert.rejects(engine.start(), /closing/)
    await assert.rejects(engine.request('ping'), /not running/)
  } finally { await engine.close(); await rm(directory, {recursive: true, force: true}) }
})
