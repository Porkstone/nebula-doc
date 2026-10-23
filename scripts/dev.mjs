import { spawn } from 'node:child_process'
import electron from 'electron'
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })
let desktop
for (let attempt = 0; attempt < 80; attempt++) {
  try { const response = await fetch('http://127.0.0.1:5173'); if (response.ok) break } catch {}
  await new Promise(resolve => setTimeout(resolve, 250))
}
const env = { ...process.env, NEBULA_DEV_URL: 'http://127.0.0.1:5173' }
delete env.ELECTRON_RUN_AS_NODE
desktop = spawn(electron, ['.'], { stdio: 'inherit', env })
desktop.on('exit', code => { vite.kill(); process.exit(code ?? 0) })
process.on('SIGINT', () => { desktop.kill(); vite.kill(); process.exit() })
