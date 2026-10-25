# -*- coding: utf-8 -*-
"""按 v4 设计稿（design-v4/pages/*.png）批量对齐 S2-S7 视觉"""
import io, re, sys

BASE = r'E:\workbuddy\good finds WeChat\campus-share'
MP = BASE + r'\miniprogram'
miss = []

def read(p):
    return io.open(p, encoding='utf-8').read()

def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

def sub(path, old, new, tag):
    p = MP + path
    s = read(p)
    if old in s:
        write(p, s.replace(old, new, 1))
    else:
        miss.append(tag)

def append(path, text):
    p = MP + path
    s = read(p)
    if text.strip() not in s:
        write(p, s.rstrip() + '\n\n/* ---- v4 设计稿对齐（追加覆盖） ---- */\n' + text.strip() + '\n')

# ============ 图标：新增纸飞机 ============
g = BASE + r'\tools\gen-icons.js'
s = read(g)
if "'send-plane'" not in s:
    s = s.replace("  'tab-publish': ", "  'send-plane': '<path d=\"M6 24 L42 8 L30 42 L24 28 Z\"/>',\n  'tab-publish': ", 1)
    s = s.replace("  ['heart-fill', I['heart'], 'fill', C.purple],",
                  "  ['send-plane', I['send-plane'], 'fill', C.white],\n  ['heart-fill', I['heart'], 'fill', C.purple],", 1)
    write(g, s)

# ============ S5 问答页 ============
sub(r'\pages\ask\ask.wxml',
    """    <view class="hero-nav" style="height:{{navH}}px">
      <view class="hero-main">
        <view class="hero-title">AI 问答</view>
        <view class="hero-sub">仅基于本校同学的分享回答</view>
      </view>
    </view>""",
    """    <view class="hero-nav" style="height:{{navH}}px">
      <view class="hero-title">AI 问答</view>
    </view>
    <view class="hero-sub">仅基于本校同学的分享回答</view>""", 'ask-hero')

sub(r'\pages\ask\ask.wxml',
    '<view class="cite-meta">查看原帖</view>',
    '<view class="cite-meta">匿名 · {{c.timeText}}</view>', 'ask-cite-meta')

sub(r'\pages\ask\ask.wxml',
    'class="input-field" placeholder="问点什么…"',
    'class="input-field" placeholder="问问同学都在推荐什么"', 'ask-placeholder')

sub(r'\pages\ask\ask.wxml',
    '<image class="send-icon" src="/assets/icons/send.png" mode="aspectFit" />',
    '<image class="send-icon" src="/assets/icons/send-plane.png" mode="aspectFit" />', 'ask-send-icon')

append(r'\pages\ask\ask.wxss', """
.hero { text-align: center; }
.hero-nav { justify-content: center; }
.hero-title { font-size: 40rpx; }
.hero-sub {
  display: inline-block;
  margin: 10rpx auto 0;
  padding: 8rpx 28rpx;
  background: var(--brand-50);
  border: 2rpx solid var(--brand-100);
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--primary-deep);
}
.bubble-user { background: var(--sky); box-shadow: 0 8rpx 20rpx rgba(90, 169, 255, 0.3); }
.hot-chip { background: var(--brand-50); color: var(--primary-deep); border: 2rpx solid var(--brand-100); }
.cite-card { background: #FFFFFF; border: 2rpx solid var(--brand-100); }
.cite-meta { color: var(--text-3); }
.input-shell {
  background: linear-gradient(100deg, var(--brand-50) 0%, #FFFFFF 60%);
  border: 2rpx solid var(--brand-100);
}
.send-btn { background: var(--brand-200); box-shadow: none; }
.send-btn.can-send { background: var(--primary); box-shadow: 0 8rpx 20rpx rgba(108, 92, 231, 0.3); }
""")

# ask.js：引用卡补时间
sub(r'\pages\ask\ask.js',
    """        const cites = (res.citations || []).map(c => ({
          id: c.id,
          title: c.title,
          board: c.board,
          cover: c.cover || ''
        }))""",
    """        const cites = (res.citations || []).map(c => ({
          id: c.id,
          title: c.title,
          board: c.board,
          cover: c.cover || '',
          timeText: c.timeText || ''
        }))""", 'ask-js-cites')

# ============ S4 详情页 ============
sub(r'\pages\post\detail\detail.wxml',
    """    <!-- 正文卡 -->
    <view class="detail-card">
      <view class="board-chip board-{{post.boardColor}}">{{post.boardLabel}}</view>
      <view class="detail-title">{{post.title}}</view>
      <view class="detail-time">{{post.timeText}}</view>

      <!-- 图集 -->""",
    """    <!-- 图集（设计稿：全宽大图置顶） -->
    <view class="gallery-wrap">
      <!-- 图集 -->""", 'detail-gallery-top')

sub(r'\pages\post\detail\detail.wxml',
    """      <view wx:if="{{post.mediaView.length > 1}}" class="gallery-dots">{{imgIdx + 1}}/{{post.mediaView.length}}</view>

      <!-- 正文 -->""",
    """      <view wx:if="{{post.mediaView.length > 1}}" class="gallery-dots">{{imgIdx + 1}}/{{post.mediaView.length}}</view>
    </view>

    <!-- 正文卡 -->
    <view class="detail-card">
      <view class="board-chip board-{{post.boardColor}}">
        <icon name="{{post.boardSticker}}" size="26" />
        <text>{{post.boardLabel}}</text>
      </view>
      <view class="detail-title">{{post.title}}</view>
      <view class="detail-time">匿名 · {{post.timeText}}</view>

      <!-- 正文 -->""", 'detail-body-head')

sub(r'\pages\post\detail\detail.wxml',
    """      <!-- 结构化字段 -->
      <view wx:if="{{post.fieldRows.length}}" class="field-card">""",
    """      <!-- 结构化字段（设计稿：浅紫底小标签） -->
      <view wx:if="{{post.fieldChips.length}}" class="field-chips">
        <view class="field-chip" wx:for="{{post.fieldChips}}" wx:key="label" data-value="{{item.value}}" bind:tap="onCopyField">{{item.label}}</view>
      </view>
      <view wx:if="{{post.fieldRows.length && false}}" class="field-card">""", 'detail-field-chips')

sub(r'\pages\post\detail\detail.wxml',
    """    </view>

    <!-- 评论区 -->""",
    """      <!-- AI 引用卡 -->
      <view class="ai-cite-card">
        <icon name="ai-sparkle" size="30" />
        <text class="ai-cite-text">你的分享被 AI 引用了 {{post.citedCount || 0}} 次</text>
      </view>
    </view>

    <!-- 评论区 -->""", 'detail-ai-cite')

sub(r'\pages\post\detail\detail.wxml',
    """      <view class="action-send {{commentDraft ? 'can-send' : ''}}" bind:tap="onSendComment">发送</view>""",
    """      <view class="action-item" bind:tap="onReport">
        <image class="action-icon" src="/assets/icons/flag.png" mode="aspectFit" />
      </view>
      <view class="action-send {{commentDraft ? 'can-send' : ''}}" bind:tap="onSendComment">发送</view>""", 'detail-report')

append(r'\pages\post\detail\detail.wxss', """
.gallery-wrap { position: relative; }
.detail-card { margin-top: 0; }
.board-chip { display: inline-flex; align-items: center; gap: 8rpx; }
.field-chips { display: flex; flex-wrap: wrap; gap: 16rpx; margin-top: 24rpx; }
.field-chip {
  padding: 10rpx 24rpx;
  font-size: 24rpx;
  color: var(--primary-deep);
  background: var(--brand-50);
  border-radius: 999rpx;
}
.ai-cite-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 32rpx;
  padding: 24rpx 28rpx;
  background: linear-gradient(100deg, var(--brand-50) 0%, #FFFFFF 100%);
  border: 2rpx solid var(--brand-200);
  border-radius: 32rpx;
}
.ai-cite-text { font-size: 26rpx; font-weight: 600; color: var(--primary-deep); }
""")

# detail.js：补 boardSticker / fieldChips / citedCount
p = MP + r'\pages\post\detail\detail.js'
s = read(p)
if 'fieldChips' not in s:
    s = s.replace("    p.timeText = timeAgo(p.createdAt)",
                  "    p.timeText = timeAgo(p.createdAt)\n    p.boardSticker = (b && b.sticker) || 'sticker-lamp'\n    p.citedCount = p.citedCount || 0", 1)
    s = s.replace("      if (p.fields && p.fields[f.key]) p.fieldRows.push({ label: f.label, value: p.fields[f.key] })",
                  "      if (p.fields && p.fields[f.key]) p.fieldRows.push({ label: f.label, value: p.fields[f.key] })\n    p.fieldChips = p.fieldRows.map(r => ({ label: r.label + ' ' + r.value, value: r.value }))", 1)
    write(p, s)
else:
    miss.append('detail-js-already')

# ============ S3 发帖页 ============
sub(r'\pages\post\create\create.wxml',
    """  <!-- 渐变页头 -->
  <view class="hero" style="padding-top:{{statusBarH}}px">
    <view class="hero-nav" style="height:{{navH}}px">
      <view class="nav-back" bind:tap="onBack">
        <image class="nav-back-icon" src="/assets/icons/arrow-left.png" mode="aspectFit" />
      </view>
      <view class="hero-title">发布好物</view>
      <view class="nav-ph" />
    </view>
    <view class="hero-sub">分享让好东西被更多同学看见</view>
    <image class="hero-deco" src="/assets/deco/cloud.png" mode="aspectFit" />
  </view>""",
    """  <!-- 导航：取消 / 发布（设计稿：白底胶囊） -->
  <view class="hero" style="padding-top:{{statusBarH}}px">
    <view class="hero-nav" style="height:{{navH}}px">
      <view class="nav-pill" bind:tap="onBack">取消</view>
      <view class="nav-ph" />
      <view class="nav-pill nav-pill-primary" bind:tap="onSubmit">发布</view>
    </view>
  </view>""", 'create-nav')

sub(r'\pages\post\create\create.wxml',
    """  <!-- 板块选择 -->
  <view class="card">
    <view class="card-title">选个板块</view>
    <view class="board-row">""",
    """  <!-- 板块选择（设计稿：三个胶囊 chip，无卡片包裹） -->
  <view class="board-pick">
    <view class="board-row">""", 'create-board-pick')

sub(r'\pages\post\create\create.wxml',
    '<view class="card-title">补充信息 <text class="card-sub">选填</text></view>',
    '<view class="card-title">补充信息 <text class="card-sub">（选填）</text></view>', 'create-supplement')

sub(r'\pages\post\create\create.wxml',
    '<view class="footer-tip">发布后先审核，通过即展示</view>',
    """<view class="footer-tip">发布后前台统一显示为「匿名」，同学看不到你的昵称与年级</view>
    <view class="footer-tip">内容会先经过审核，通过后在对应板块出现</view>""", 'create-footer')

append(r'\pages\post\create\create.wxss', """
.nav-pill {
  padding: 10rpx 32rpx;
  font-size: 28rpx;
  color: var(--text-1);
  background: #FFFFFF;
  border-radius: 999rpx;
  box-shadow: var(--shadow-soft);
}
.nav-pill-primary { color: var(--primary); font-weight: 600; }
.board-pick { padding: 0 40rpx 8rpx; }
.content-input { background: #FFFFFF; }
.field-label { display: none; }
.field-input { background: var(--brand-50); border-radius: 32rpx; }
.media-add {
  width: 200rpx; height: 200rpx;
  border-radius: 24rpx;
  border: 2rpx dashed var(--brand-200);
  background: var(--brand-50);
  color: var(--primary);
  flex-direction: column;
  gap: 0;
}
.media-add text { display: none; }
.footer-tip { line-height: 1.6; }
""")

# ============ S2 板块页 ============
sub(r'\pages\board\board.wxml',
    """      <view class="banner-title font-title">{{meta.label}}</view>""",
    """      <view class="banner-text">
        <view class="banner-title font-title">{{meta.label}}</view>
        <view class="banner-sub">{{total}} 条分享</view>
      </view>""", 'board-banner-text')

sub(r'\pages\board\board.wxml',
    """    <view class="count-line">
      <view class="board-tag board-{{board}}">{{meta.label}}</view>
      <text class="count">{{total}} 条分享</text>
    </view>
""", "", 'board-count-line')

append(r'\pages\board\board.wxss', """
.banner-sticker {
  left: 28rpx; right: auto; bottom: auto;
  top: 50%;
  transform: translateY(-50%);
  width: 96rpx; height: 96rpx;
  border-radius: 50%;
  background: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 20rpx rgba(46, 42, 59, 0.18);
}
.banner-text { position: absolute; left: 148rpx; top: 50%; transform: translateY(-50%); }
.banner-title { position: static; font-size: 40rpx; }
.banner-sub { margin-top: 8rpx; font-size: 24rpx; color: rgba(255, 255, 255, 0.92); }
""")

# ============ S6 我的 ============
append(r'\pages\profile\profile.wxss', """
.stat-card, .menu-card, .menu-list, .profile-card {
  background: #FFFFFF;
  border: 2rpx solid var(--brand-200);
}
.menu-item { background: transparent; }
""")

# ============ S7 审核台 ============
append(r'\pkg-admin\admin\admin.wxss', """
.item {
  background: #FFFFFF;
  border: 2rpx solid var(--brand-200);
  border-radius: 40rpx;
  box-shadow: none;
}
.tab.is-on { color: var(--primary); border-bottom: 4rpx solid var(--primary); }
.act-btn { border-radius: 999rpx; }
.act-btn.reject { background: #FFFFFF; color: var(--primary); border: 2rpx solid var(--primary); }
.act-btn.approve { background: var(--primary); color: #FFFFFF; border: 2rpx solid var(--primary); }
""")

print('MISS:', miss if miss else 'none')
