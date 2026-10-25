/**
 * 全量静态校验（无网络依赖，纯本地）
 * 1. WXML：wx:else/wx:elif 必须紧邻 wx:if/wx:elif 兄弟节点（编译硬约束）
 * 2. WXML：标签配对（自闭合/成对标签平衡）
 * 3. WXML：bind/catch 事件方法必须在同目录 JS 中有定义
 * 4. WXSS：V-01 禁止硬编码色值（theme.wxss 之外出现 #hex / rgba()）
 * 5. WXSS：V-04 字号必须落在 12 档字阶内（var(--fs-*) 或白名单值）
 * 6. JSON：全部可解析 + usingComponents 引用文件存在
 * 7. 资源：WXML/JS 引用的 /assets/icons/*.png 本地存在
 * 8. 路由：app.json 的 pages/subPackages 页面文件齐全
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const ALLOWED_FS = [22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 72];
const VOID_TAGS = new Set(['image', 'import', 'include']); // 小程序自闭合语义标签（block 是成对标签，不可入列）
const SELF_CLOSING = /^<(image|import|include|input|icon)\b[^>]*\/>/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------- WXML ----------
function checkWxml(file) {
  const src = fs.readFileSync(file, 'utf8');
  const errs = [];
  // 去掉注释，避免注释里的标签干扰
  const clean = src.replace(/<!--[\s\S]*?-->/g, '');

  // 1. 标签配对 + 兄弟顺序：逐行扫描顶层标签太粗糙，用栈解析
  //    小程序 WXML 根节点必须唯一；标签大小写不敏感
  const tagRe = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
  const stack = [];
  let m;
  let prevEl = null; // 上一个完整元素 {tag, cond}
  let lineOf = (idx) => src.slice(0, idx).split('\n').length;

  while ((m = tagRe.exec(clean))) {
    const [full, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    const isClose = full.startsWith('</');
    const idx = m.index;

    if (isClose) {
      const top = stack.pop();
      if (!top) {
        errs.push(`L${lineOf(idx)} 多余的闭合标签 </${tag}>`);
      } else if (top.tag !== tag) {
        errs.push(`L${lineOf(idx)} 标签不匹配：<${top.tag}>（开于 L${lineOf(top.idx)}）被 </${tag}> 闭合`);
      }
      // 刚闭合的元素就是下一个同级节点的「前一个兄弟」
      prevEl = top ? { tag: top.tag, hasIf: top.hasIf, hasElif: top.hasElif } : null;
      continue;
    }

    // 开标签
    const hasIf = /\bwx:if\s*=/.test(attrs);
    const hasElse = /\bwx:else\s*=/.test(attrs);
    const hasElif = /\bwx:elif\s*=/.test(attrs);

    if ((hasElse || hasElif)) {
      // wx:else/wx:elif 前一个兄弟必须是带 wx:if/wx:elif 的元素
      if (!prevEl || !prevEl.hasIf && !prevEl.hasElif) {
        errs.push(
          `L${lineOf(idx)} <${tag} wx:${hasElse ? 'else' : 'elif'}> 未紧邻 wx:if/wx:elif 兄弟节点（编译硬约束）`
        );
      }
    }
    if (hasElse && hasIf) {
      errs.push(`L${lineOf(idx)} <${tag}> 同时写了 wx:if 与 wx:else（冲突）`);
    }

    if (selfClose || SELF_CLOSING.test(full) || VOID_TAGS.has(tag)) {
      // 自闭合：登记为兄弟元素
      prevEl = { tag, hasIf, hasElif };
    } else {
      stack.push({ tag, idx, hasIf, hasElif });
      prevEl = null; // 开标签内部不算前一个兄弟
    }
    // 同层前一个兄弟（如果紧接着是下一个兄弟标签）由循环继续推进
    // 注意：标签之间可能有文本，WXML 允许，这里只做约束检查
  }
  if (stack.length) {
    for (const t of stack) {
      errs.push(`L${lineOf(t.idx)} <${t.tag}> 未闭合`);
    }
  }
  return errs;
}

// ---------- WXSS ----------
function checkWxss(file, isTheme) {
  const src = fs.readFileSync(file, 'utf8');
  const errs = [];
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  if (!isTheme) {
    // V-01：硬编码色值（排除注释与 var() 兜底参数——var(--x, #fff) 是令牌化合法形式）
    // 先把 var(...) 调用整段替换为等长空格，保持行号不变
    const noComment = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/var\([^)]*\)/g, (m) => ' '.repeat(m.length));
    let m;
    const hexRe = /#([0-9a-fA-F]{3,8})\b/g;
    while ((m = hexRe.exec(noComment))) {
      const before = noComment.slice(Math.max(0, m.index - 6), m.index);
      if (before.includes('url(')) continue; // url(#id) SVG 引用等
      errs.push(`L${lineOf(m.index)} V-01 硬编码色值 ${m[0]}`);
    }
    // rgba/HSLA 直写也视为违规（白名单已在 theme.wxss；var() 内兜底已剔除）
    const rgbRe = /(?:rgba?|hsla?)\([^)]*\)/g;
    while ((m = rgbRe.exec(noComment))) {
      errs.push(`L${lineOf(m.index)} V-01 硬编码颜色函数 ${m[0]}`);
    }
  }

  // V-04：字号字阶（所有 wxss 都查，theme.wxss 是令牌定义处）
  const fsRe = /font-size\s*:\s*([^;}]+)/g;
  let m;
  while ((m = fsRe.exec(src))) {
    const val = m[1].trim();
    if (val.startsWith('var(')) continue; // 走令牌
    const num = parseFloat(val);
    if (!isNaN(num)) {
      const unitOk = /rpx$/.test(val);
      if (!unitOk) {
        errs.push(`L${lineOf(m.index)} V-04 font-size "${val}" 未用 var(--fs-*)，且非 rpx 单位`);
        continue;
      }
      if (!ALLOWED_FS.includes(num)) {
        errs.push(`L${lineOf(m.index)} V-04 font-size ${val} 不在 12 档字阶内（${ALLOWED_FS.join('/')}）`);
      }
    } else if (!/^(inherit|initial|unset)$/.test(val)) {
      errs.push(`L${lineOf(m.index)} V-04 font-size 异常值 "${val}"`);
    }
  }
  return errs;
}

// ---------- WXML 事件绑定 vs JS 方法 ----------
function checkHandlers(file) {
  const js = file.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(js)) return [];
  const wxml = fs.readFileSync(file, 'utf8');
  const src = fs.readFileSync(js, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lineOf = (idx) => wxml.slice(0, idx).split('\n').length;
  const errs = [];
  const handlerRe = /\b(?:bind|catch|capture-bind|capture-catch):([a-zA-Z][\w]*)\s*=\s*"([^"]+)"|\b(bind[a-zA-Z]+|catch[a-zA-Z]+)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = handlerRe.exec(wxml))) {
    const name = m[2] || m[4];
    if (!name || /[{}]/.test(name)) continue; // 内联表达式跳过
    // JS 侧需存在同名方法定义（对象字面量 key 或函数声明）
    const defined =
      new RegExp('(^|[\\s,{])' + name + '\\s*[:(\[]', 'm').test(src) ||
      new RegExp('\\b' + name + '\\s*\\(', 'm').test(src) ||
      new RegExp('function\\s+' + name + '\\b').test(src);
    if (!defined) errs.push(`L${lineOf(m.index)} 事件绑定未定义方法: ${name}（应存在于 ${path.basename(js)}）`);
  }
  return errs;
}

// ---------- JSON ----------
function checkJson(file) {
  const errs = [];
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [`JSON 解析失败: ${e.message}`];
  }
  if (j.usingComponents) {
    for (const [name, relPath] of Object.entries(j.usingComponents)) {
      // 绝对路径 /xxx 相对 miniprogram 根；相对路径相对 JSON 所在目录
      const base = relPath.startsWith('/')
        ? path.join(ROOT, relPath)
        : path.join(path.dirname(file), relPath);
      if (!fs.existsSync(base + '.js') && !fs.existsSync(base + '.wxml')) {
        errs.push(`usingComponents[${name}] -> ${relPath} 不存在`);
      }
    }
  }
  return errs;
}

// ---------- 运行 ----------
const files = walk(ROOT);
const wxmls = files.filter((f) => f.endsWith('.wxml'));
const wxsss = files.filter((f) => f.endsWith('.wxss'));
const jsons = files.filter((f) => f.endsWith('.json'));

let total = 0;
for (const f of wxmls) {
  const errs = [...checkWxml(f), ...checkHandlers(f)];
  if (errs.length) {
    total += errs.length;
    console.log(`\n✗ ${path.relative(ROOT, f).replace(/\\/g, '/')}`);
    errs.forEach((e) => console.log(`   ${e}`));
  }
}
for (const f of wxsss) {
  const isTheme = path.basename(f) === 'theme.wxss';
  const errs = checkWxss(f, isTheme);
  if (errs.length) {
    total += errs.length;
    console.log(`\n✗ ${path.relative(ROOT, f).replace(/\\/g, '/')}`);
    errs.forEach((e) => console.log(`   ${e}`));
  }
}
for (const f of jsons) {
  const errs = checkJson(f);
  if (errs.length) {
    total += errs.length;
    console.log(`\n✗ ${path.relative(ROOT, f).replace(/\\/g, '/')}`);
    errs.forEach((e) => console.log(`   ${e}`));
  }
}

// 资源引用：WXML/JS 里的 /assets/icons/*.png
const iconMiss = [];
for (const f of [...wxmls, ...files.filter((x) => x.endsWith('.js'))]) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\/assets\/icons\/[\w-]+\.png/g)) {
    if (!fs.existsSync(path.join(ROOT, m[0]))) {
      iconMiss.push(`${path.relative(ROOT, f).replace(/\\/g, '/')} 引用缺失 ${m[0]}`);
    }
  }
}
if (iconMiss.length) {
  total += iconMiss.length;
  console.log('\n✗ 图标资源缺失');
  iconMiss.forEach((e) => console.log(`   ${e}`));
}

// 路由完整性
try {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const routeMiss = [];
  (app.pages || []).forEach((p) => {
    if (!fs.existsSync(path.join(ROOT, p + '.wxml'))) routeMiss.push(`pages 缺失: ${p}`);
  });
  (app.subPackages || app.subpackages || []).forEach((sp) => {
    (sp.pages || []).forEach((p) => {
      if (!fs.existsSync(path.join(ROOT, sp.root, p + '.wxml'))) routeMiss.push(`分包缺失: ${sp.root}/${p}`);
    });
  });
  if (routeMiss.length) {
    total += routeMiss.length;
    console.log('\n✗ app.json 路由');
    routeMiss.forEach((e) => console.log(`   ${e}`));
  }
} catch (e) {
  total++;
  console.log(`\n✗ app.json 解析失败: ${e.message}`);
}

console.log(
  `\n===== 校验完成：${wxmls.length} WXML + ${wxsss.length} WXSS + ${jsons.length} JSON，共 ${total} 处问题 =====`
);
process.exit(total > 0 ? 1 : 0);
