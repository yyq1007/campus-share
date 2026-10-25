/**
 * 字体子集化流水线：扫描前端文案 → 抽取字符集 → 子集化 → woff2
 *
 * 前置（一次性）：
 *   1. 下载 ZCOOL KuaiLe（OFL 1.1）到 assets-font/ZCOOLKuaiLe-Regular.ttf
 *   2. pip install fonttools brotli
 *
 * 用法：
 *   node tools/collect-charset.js > tools/charset.txt
 *   python tools/build-font.py
 *   # 然后把 assets-font/zcool-kuaile-subset.woff2 上传到云存储 assets/fonts/
 */
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-font', 'ZCOOLKuaiLe-Regular.ttf')
OUT = os.path.join(ROOT, 'assets-font', 'zcool-kuaile-subset.woff2')
CHARSET = os.path.join(ROOT, 'tools', 'charset.txt')
LIMIT_KB = 120

if not os.path.exists(SRC):
    print('缺少字体源文件:', SRC)
    sys.exit(1)
if not os.path.exists(CHARSET):
    print('缺少字符集文件，请先执行 node tools/collect-charset.js > tools/charset.txt')
    sys.exit(1)

cmd = [
    sys.executable, '-m', 'fontTools.subset', SRC,
    '--text-file=' + CHARSET,
    '--output-file=' + OUT,
    '--flavor=woff2',
    '--layout-features=*',
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=DSIG',
    '--name-IDs=*',
    '--name-legacy',
    '--name-languages=*',
]
subprocess.run(cmd, check=True)

size = os.path.getsize(OUT)
kb = size / 1024
print(f'子集字体: {OUT}')
print(f'大小: {size} bytes = {kb:.1f} KB（限制 {LIMIT_KB} KB）')

# 字符覆盖校验
from fontTools.ttLib import TTFont  # noqa: E402

font = TTFont(OUT)
font.flavor = 'woff2'
cmap = font.getBestCmap()
need = set(open(CHARSET, encoding='utf-8').read())
missing = [c for c in need if ord(c) not in cmap]
if missing:
    print('缺失字符（多为字体本身无此字形的装饰符号）:', ''.join(missing))
else:
    print('字符覆盖: 完整')

if size > LIMIT_KB * 1024:
    print('❌ 超出 120KB 限制')
    sys.exit(1)
print('✅ 字体子集化完成，可上传云存储 assets/fonts/')
