/**
 * 验证 wx-server-sdk 的 db.startTransaction 是否存在。
 *
 * interactionToggle 的 toggleOnce 第一行就是：
 *   const t = await db.startTransaction();
 * 如果这个 API 不存在或行为异常，整个函数会抛异常 → 被 withAuth 捕获 → 返回 50001。
 *
 * 但注意：withAuth 的 catch 会把异常变成 fail(50001)，
 * 前端 api.interactionToggle 会 reject → 首页 catch → 回滚 + toast「操作失败」。
 * 用户说数字"显示增加"却没提到 toast…… 但如果 rollback 生效，数字也会退回去。
 *
 * 检查 SDK 里有哪些 transaction 相关方法。
 */
const path = require('path')

// 找到 wx-server-sdk
let sdkPath = null
const candidates = [
  'C:\\Users\\Admin（无密码）\\.workbuddy\\binaries\\node\\workspace\\node_modules\\wx-server-sdk',
]
for (const p of candidates) {
  try {
    require.resolve(p)
    sdkPath = p
    break
  } catch (e) { /* try next */ }
}

if (!sdkPath) {
  console.log('wx-server-sdk 未安装在 workspace，尝试全局查找...')
  const fs = require('fs')
  const glob = require('path')
  const roots = [
    'C:\\Users\\Admin（无密码）\\.workbuddy\\binaries\\node\\workspace\\node_modules',
    'C:\\Users\\Admin（无密码）\\.workbuddy\\binaries\\node\\versions\\22.22.2-3\\lib\\node_modules',
  ]
  for (const r of roots) {
    if (!fs.existsSync(r)) continue
    for (const d of fs.readdirSync(r)) {
      if (d.startsWith('wx-server-sdk')) {
        sdkPath = path.join(r, d)
        break
      }
    }
    if (sdkPath) break
  }
}

console.log('SDK 路径:', sdkPath || '未找到')

if (sdkPath) {
  const pkg = require(path.join(sdkPath, 'package.json'))
  console.log('版本:', pkg.version)

  // 搜 transaction 相关实现
  const fs = require('fs')
  const hit = []
  function walk(dir, depth) {
    if (depth > 4) return
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f)
      const st = fs.statSync(fp)
      if (st.isDirectory()) {
        if (f === 'node_modules' && depth > 1) continue
        walk(fp, depth + 1)
      } else if (f.endsWith('.js')) {
        const txt = fs.readFileSync(fp, 'utf-8')
        if (/startTransaction|runTransaction/.test(txt)) {
          const names = [...new Set((txt.match(/\b(startTransaction|runTransaction|transaction)\b/g) || []))]
          hit.push(`${path.relative(sdkPath, fp)}  → ${names.join(', ')}`)
        }
      }
    }
  }
  walk(sdkPath, 0)
  console.log('\n含 transaction API 的文件:')
  hit.slice(0, 25).forEach(h => console.log('  ', h))
}
