/**
 * 批量下载并解压环境云函数源码到本地 cloudfunctions 目录
 * 用法：node tools/fetch-env-src.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const PY = 'C:/Users/YQ/.workbuddy/binaries/python/versions/3.13.12/python.exe'
const OUT = path.resolve(__dirname, '..', 'cloudfunctions')

const LINKS = require('./env-links.json')

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })
  for (const [name, url] of Object.entries(LINKS)) {
    const dest = path.join(OUT, name)
    try {
      execFileSync(PY, [
        '-c',
        `
import urllib.request, zipfile, io, os, sys
url=sys.argv[1]; dest=sys.argv[2]
data=urllib.request.urlopen(url, timeout=90).read()
z=zipfile.ZipFile(io.BytesIO(data))
os.makedirs(dest, exist_ok=True)
for n in z.namelist():
    if n.startswith('node_modules/') or n.endswith('/'):
        continue
    if '/package-lock' in n or n.startswith('package-lock'):
        continue
    z.extract(n, dest)
print('ok', dest)
`,
        url,
        dest
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      console.log('[ok]', name)
    } catch (e) {
      console.log('[FAIL]', name, String(e.stderr || e.message).slice(0, 200))
    }
  }
}
main()
