# 排行榜 MVP 开发方案

> 项目：好物分享（校园分享小程序）
> 版本：v1.0 ｜ 状态：待实施 ｜ 日期：2026-11-11
> 云开发环境：`yyq-d6g1dv0kgf893afe8` ｜ 代码基线：`campus-share/`
> 关联文档：`MVP产品开发文档-v1.0.md`（第 9 章云函数契约）、`契约映射-前端与环境版.md`

---

## 一、目标与 MVP 边界

### 1.1 目标

新增一个排行榜页面，含三个榜：**长期热度榜**、**板块榜**、**新秀榜**。让用户能快速发现"社区里公认的好东西"，同时给新发布内容一个独立的曝光位置。

### 1.2 MVP 做（P0）

| 项 | 说明 |
|---|---|
| 热度榜 | 全部帖子，按 `赞×3 + 藏×4` 累计值排名，长期有效，取 50 名 |
| 板块榜 | 按 美食 / 生活 / 学习 三个板块分别排名，同公式，各取 50 名 |
| 新秀榜 | 最近 7 天发布的帖子，按现有 `hotScore`（带时间衰减）排名，取 50 名 |
| 榜单页 | 一级 Tab（热度榜/新秀榜）+ 板块筛选 chips + 榜单列表 + 空态 |
| 首页入口 | 信息流上方一条「排行榜」入口条 |
| 点赞限速 | 每人每分钟 60 次，防止刷榜 |

### 1.3 MVP 不做（明确排除，避免范围蔓延）

| 不做 | 原因 |
|---|---|
| 榜单页内点赞/收藏 | 会引入第五处需要同步补丁的位置，破坏现有 `utils/feed-patch.js` 的四页一致性设计；榜单定位是发现入口，交互留在详情页 |
| 作者榜 / 贡献者榜 | 与项目匿名定位冲突（个人页写"你的身份仅自己可见"、评论头像按楼层取色），MVP 阶段不做 |
| 飙升榜 / 黑马榜 | 需要维护历史基线，校园体量下增长率噪声极大，噪声大于价值 |
| 总榜与周榜切换 | 热度榜本身已是长期累计，无第二套周期需求 |
| 榜单分页 / 无限滚动 | 50 名一次返回，前端不翻页 |
| 榜单缓存层 | 单次查询走索引 + limit 50，耗时可接受，不做额外缓存 |

### 1.4 三个榜分工（产品逻辑）

- **热度榜**回答"这个社区历史上最好的东西是什么" —— 权威、稳定，适合答辩展示
- **新秀榜**回答"这几天在火什么" —— 活力、新鲜，适合日常浏览
- **板块榜**回答"我想找吃喝 / 学习资料时看什么" —— 场景化，用户在特定板块里的决策辅助

长期累计榜必然头部固化（淘宝总销量榜同理），新秀榜是对冲手段，两者配套而非重复。

---

## 二、榜单口径

### 2.1 三个榜的排序定义

| 榜 | 排序字段 | 数据范围 | 刷新时机 |
|---|---|---|---|
| 热度榜（长期） | `posts.popScore`（新增） | `status='published'` 且 `popScore > 0` | 点赞/收藏即时生效 |
| 板块榜 | `posts.popScore` | 同上 + `board` 过滤 | 同上 |
| 新秀榜 | `posts.hotScore`（现有） | `publishedAt >= 今天 - 7 天` | 每小时（`taskHotScore`） |

### 2.2 分数公式

```
popScore = 3 × stats.likeCount + 4 × stats.favCount     （累计，不衰减）
```

- 收藏权重高于点赞，因为收藏代表"我真的想要"，比随手点赞更强的意向信号
- **不含评论数、不含 AI 引用数**（产品口径明确为"按点赞收藏排"）
- 只增不减的累计值，随时间不衰减

### 2.3 为什么新秀榜不复用 popScore

`popScore` 是累计值。假设两条帖子都在 7 天窗口内：

- A 是 7 天前发布，累计了 7 天
- B 是 1 天前发布，只累计了 1 天

用累计值比较，B 永远吃亏，新帖无法上榜。而现有 `hotScore` 公式自带时间衰减：

```
hotScore = (3×赞 + 4×藏 + 5×评论 + 6×AI引用 + 1) / (小时数 + 2)^1.5
```

分母随时间增长，天然对新鲜内容公平。该字段已由 `taskHotScore` 每小时维护，新秀榜**零新增计算逻辑**。

> 注意：新秀榜的权重含评论与引用，与热度榜口径不完全一致。这是刻意设计——新秀榜考察的是"新鲜度加权后的整体热度"，热度榜考察的是"纯赞藏累计"。文案上不展示分数值，用户无感知差异。

### 2.4 常量

| 常量 | 值 | 位置 |
|---|---|---|
| 榜长 | 50 | `rankList` 云函数 `LIMIT` |
| 新秀窗口 | 7 天 | `rankList` 云函数 `FRESH_DAYS` |
| 赞权重 | 3 | `interactionToggle` |
| 藏权重 | 4 | `interactionToggle` |
| 板块顺序 | 全部 / 美食 / 生活 / 学习 | `pages/rank/rank.js` 的 `BOARDS` |
| 板块 key | `food` / `life` / `study` | 与现有 `utils/config.js` 的 `BOARDS` 一致 |

---

## 三、数据结构变更

### 3.1 posts 集合新增字段

```js
popScore: number   // 3 × likeCount + 4 × favCount，累计不衰减，默认 0
```

不新增集合、不改 `stats` 结构、不改 `hotScore` 公式。

### 3.2 索引（云开发控制台手工创建，**必做**）

| 集合 | 索引字段（按顺序） | 用途 |
|---|---|---|
| posts | `status`(1) + `popScore`(-1) + `publishedAt`(-1) | 热度榜 |
| posts | `board`(1) + `status`(1) + `popScore`(-1) + `publishedAt`(-1) | 板块榜 |
| posts | `status`(1) + `hotScore`(-1) + `publishedAt`(-1) | 新秀榜 |

说明：

- `publishedAt` 作为第二排序键，保证同分（尤其是大量 0 分 / 同热度帖）时排序稳定，不会每次刷新顺序乱跳
- 若控制台对单索引字段数有限制，可退化为前两个字段，同分抖动可接受
- 不建索引会导致查询超时或直接报错，这一步不能省

---

## 四、接口契约：`rankList`

### 4.1 请求

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 否 | `hot`（热度榜，默认）/ `board`（板块榜）/ `fresh`（新秀榜） |
| `board` | string | 条件 | `type='board'` 时必填，取值 `food` / `life` / `study` |

### 4.2 响应

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "rank": 1,
        "id": "帖子 _id",
        "shortId": "ABC123",
        "board": "life",
        "title": "标题",
        "excerpt": "摘要",
        "cover": "cloud://... 或空",
        "mediaType": "image",
        "likeCount": 128,
        "favCount": 45,
        "commentCount": 12,
        "score": 564,
        "publishedAt": 1762300000000,
        "status": "published",
        "expired": false
      }
    ],
    "type": "hot",
    "board": "",
    "updatedAt": 1762300000000
  }
}
```

### 4.3 契约要点

- 每个条目 = `postBrief` 的字段 + `rank` + `score`，与首页 / 搜索页字段口径完全一致
- **不下发 `authorUid`、昵称、头像** —— 榜单只表彰内容，与项目匿名设定一致
- `cover` 仍是云存储 fileID，由前端 `api.js` 的 `decorateBriefs` 统一转临时链接并补 `boardLabel`
- 错误码沿用现有约定：`40001` 参数不合法、`50001` 服务端异常

---

## 五、改动清单（按执行顺序）

### 步骤 1：`cloudfunctions/interactionToggle/index.js`

**1.1 维护 popScore**

位置：`toggleOnce()` 内，现有 `await t.collection(COL.posts).doc(targetId).update({ ... })`（约第 67-69 行）。同一事务内顺手写入，不额外查询。

```js
const stats = Object.assign(
  { likeCount: 0, favCount: 0, commentCount: 0, citedCount: 0, viewCount: 0 },
  post.stats || {}
);
const key = STAT_KEY[type];
stats[key] = Math.max(0, (stats[key] || 0) + delta);

// 新增：长期热度分（累计，不衰减）
const popScore = 3 * (stats.likeCount || 0) + 4 * (stats.favCount || 0);

await t.collection(COL.posts).doc(targetId).update({
  data: { stats, popScore, updatedAt: db.serverDate() },
});

await t.commit();
return { active: !existed, count: stats[key], popScore, post, stats };
```

**1.2 加频控**

位置：`exports.main` 开头，参数校验之后、事务循环之前。`lib/rate.js` 已存在，可直接引用（用法参照 `authLogin/index.js` 第 41-48 行）。

```js
const rate = require('./lib/rate');

// ...参数校验通过后...
try {
  const rl = await rate.hit(ctx.uid, 'interact', 60, 60 * 1000);
  if (!rl.allowed) return fail(42901);
} catch (e) {
  // 限流模块异常不阻断互动（可用性优先）
  console.warn('[interactionToggle] rate limit failed', e && e.message);
}
```

> 长期榜的排名收益是永久的，刷赞动机比短期榜强得多，这一步不能省。

### 步骤 2：`cloudfunctions/postCreate/index.js`

位置：约第 166 行，帖子文档组装处。

```js
stats: { likeCount: 0, favCount: 0, commentCount: 0, citedCount: 0, viewCount: 0 },
popScore: 0,                       // 新增
commentSeq: 0,
```

### 步骤 3：新建云函数 `cloudfunctions/rankList/`

做法：**整目录复制 `cloudfunctions/postList/`** 后改名（项目里每个云函数自带独立 `lib/` 副本，这是既定约定）。

- `postList/` 只含 `index.js`、`lib/`、`package.json`，无 `config.json`，因此不需要清理定时触发器
- 修改 `package.json` 的 `name` 为 `rankList`

`index.js` 实现：

```js
/**
 * rankList：排行榜（热度榜 / 板块榜 / 新秀榜）
 * 入参 { type: 'hot'|'board'|'fresh', board?: 'food'|'life'|'study' }
 * 出参 { list, type, board, updatedAt }
 * 约束：不下发 authorUid；cover 保持 fileID 由前端转临时链接
 */
const { coll, _, COL } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { postBrief } = require('./lib/present');

const LIMIT = 50;
const FRESH_DAYS = 7;
const BOARDS = ['food', 'life', 'study'];

exports.main = withAuth(async (event) => {
  const type = String(event.type || 'hot');
  const board = String(event.board || '');

  const where = { status: 'published' };
  let orderField = 'popScore';

  if (type === 'fresh') {
    where.publishedAt = _.gte(new Date(Date.now() - FRESH_DAYS * 86400000));
    orderField = 'hotScore';
  } else if (type === 'board') {
    if (BOARDS.indexOf(board) === -1) return fail(40001, '板块参数不合法');
    where.board = board;
    where.popScore = _.gt(0);
  } else {
    where.popScore = _.gt(0);
  }

  let res;
  try {
    res = await coll(COL.posts)
      .where(where)
      .orderBy(orderField, 'desc')
      .orderBy('publishedAt', 'desc')
      .limit(LIMIT)
      .get();
  } catch (e) {
    console.error('[rankList query]', e && (e.message || e));
    return fail(50001);
  }

  const list = (res.data || []).map((p, i) => Object.assign(postBrief(p), {
    rank: i + 1,
    score: type === 'fresh' ? (p.hotScore || 0) : (p.popScore || 0),
  }));

  return ok({ list, type, board, updatedAt: Date.now() });
}, {});
```

> `withAuth` 第二参数 `{}` 表示只读操作，与 `postList` 一致。

### 步骤 4：`miniprogram/utils/api.js` 新增适配方法

在「内容」区块（`postList` 附近）追加：

```js
/** 排行榜：type = hot|board|fresh，board = food|life|study */
async function rankList(params) {
  const res = await callFn('rankList', params || {});
  res.list = await decorateBriefs(res.list || []);
  return res;
}
```

同步在文件末尾的 `module.exports` 中加入 `rankList`。

> **必须走 `decorateBriefs`**：榜单和 `postList` 一样返回 `cloud://` 形式的 `cover`，不转换则图片全白；它同时会补上 `boardLabel` 供前端展示。

### 步骤 5：新建页面 `miniprogram/pages/rank/rank`

`app.json` 的 `pages` 数组追加 `"pages/rank/rank"`。**不进 tabBar** —— 当前 3 个 Tab 不再挤压，榜单是低频功能，从首页入口进入。

#### 5.1 `rank.js`

```js
// 排行榜：热度榜（长期累计）/ 新秀榜（近 7 天），板块筛选
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')

// 板块展示顺序：全部 / 美食 / 生活 / 学习
const BOARDS = [
  { key: 'all', label: '全部' },
  { key: 'food', label: '美食' },
  { key: 'life', label: '生活' },
  { key: 'study', label: '学习' }
]

Page({
  data: {
    tab: 'hot',            // hot | fresh
    board: 'all',
    boards: BOARDS,
    list: [],
    state: 'loading',      // loading | success | empty | error
    updatedText: ''
  },

  onLoad() { this.load() },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab, list: [], state: 'loading' }, () => this.load())
  },

  onBoardTap(e) {
    const board = e.currentTarget.dataset.board
    if (board === this.data.board) return
    this.setData({ board, list: [], state: 'loading' }, () => this.load())
  },

  async load() {
    // 请求序号防竞态：快速切 Tab 时只认最后一次的结果
    this.seq = (this.seq || 0) + 1
    const my = this.seq
    try {
      await guard()
      const type = this.data.tab === 'fresh'
        ? 'fresh'
        : (this.data.board === 'all' ? 'hot' : 'board')
      const res = await api.rankList({
        type,
        board: type === 'board' ? this.data.board : ''
      })
      if (my !== this.seq) return
      const list = res.list || []
      this.setData({
        list,
        state: list.length ? 'success' : 'empty',
        updatedText: res.updatedAt ? this.fmtTime(res.updatedAt) : ''
      })
    } catch (e) {
      if (my !== this.seq) return
      this.setData({ state: 'error' })
    }
  },

  fmtTime(ts) {
    const d = new Date(ts)
    const p = n => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())} 更新`
  },

  onRetry() { this.setData({ state: 'loading' }, () => this.load()) },

  onPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${id}` })
  }
})
```

> `onShow` 不重拉数据：榜单变化慢，避免每次返回都请求。切换 Tab / 板块时才重新拉取。

#### 5.2 `rank.wxml`

二级页统一用 `nav-bar` 组件（与 `pages/board/board.wxml` 一致）。

```xml
<view class="page-bg"></view>
<nav-bar title="排行榜" back="{{true}}" />

<view class="page-pad">
  <!-- 一级 Tab -->
  <view class="tabs">
    <view class="tab {{tab === 'hot' ? 'on' : ''}}" data-tab="hot" bindtap="onTabTap">热度榜</view>
    <view class="tab {{tab === 'fresh' ? 'on' : ''}}" data-tab="fresh" bindtap="onTabTap">新秀榜</view>
  </view>

  <!-- 板块筛选：仅热度榜显示 -->
  <view wx:if="{{tab === 'hot'}}" class="chips">
    <view wx:for="{{boards}}" wx:key="key"
          class="chip {{board === item.key ? 'on' : ''}}"
          data-board="{{item.key}}" bindtap="onBoardTap">{{item.label}}</view>
  </view>

  <page-state wx:if="{{state === 'loading' || state === 'error' || state === 'empty'}}"
    state="{{state}}" type="list"
    emptyText="还没有上榜内容"
    emptySub="{{tab === 'fresh' ? '最近 7 天发帖的同学还没上榜' : '去给你觉得好的分享点个赞吧'}}"
    bind:retry="onRetry"
  />

  <block wx:else>
    <view class="rank-item" wx:for="{{list}}" wx:key="id"
          data-id="{{item.id}}" bindtap="onPostTap">
      <view class="rank-no top-{{item.rank <= 3 ? item.rank : 0}}">{{item.rank}}</view>
      <image wx:if="{{item.cover}}" class="rank-cover" src="{{item.cover}}" mode="aspectFill" />
      <view wx:else class="rank-cover rank-cover-ph" />
      <view class="rank-body">
        <view class="rank-title">{{item.title || item.excerpt || '无标题'}}</view>
        <view class="rank-meta">
          <text wx:if="{{tab === 'hot'}}" class="rank-board">{{item.boardLabel}}</text>
          <text class="rank-count">赞 {{item.likeCount}}</text>
          <text class="rank-count">藏 {{item.favCount}}</text>
        </view>
      </view>
    </view>
    <view wx:if="{{updatedText}}" class="rank-updated">{{updatedText}}</view>
  </block>

  <view class="tab-page-bottom"></view>
</view>
```

#### 5.3 `rank.wxss`

```css
.tabs {
  display: flex;
  gap: 16rpx;
  padding: 24rpx 0 16rpx;
}
.tab {
  flex: 1;
  height: 72rpx;
  line-height: 72rpx;
  text-align: center;
  border-radius: 36rpx;
  font-size: var(--fs-body, 30rpx);
  color: var(--text-2);
  background: var(--bg-card, #FFFFFF);
}
.tab.on {
  background: var(--primary, #6C5CE7);
  color: #FFFFFF;
  font-weight: 600;
}

.chips {
  display: flex;
  gap: 16rpx;
  padding: 8rpx 0 16rpx;
}
.chip {
  padding: 10rpx 28rpx;
  border-radius: 28rpx;
  font-size: var(--fs-body-s, 26rpx);
  color: var(--text-2);
  background: var(--bg-card, #FFFFFF);
}
.chip.on {
  color: var(--brand-800, #5A47C9);
  background: var(--brand-100, #EFEAFF);
  font-weight: 600;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid var(--line-soft, #F0EEF8);
}
.rank-no {
  width: 56rpx;
  flex: none;
  text-align: center;
  font-size: var(--fs-h4, 34rpx);
  font-weight: 700;
  color: var(--text-3, #B4B0C8);
}
.rank-no.top-1 { color: #F5A623; }
.rank-no.top-2 { color: #9AA3B2; }
.rank-no.top-3 { color: #C8834D; }

.rank-cover {
  width: 120rpx;
  height: 120rpx;
  flex: none;
  border-radius: 16rpx;
  background: var(--brand-50, #F5F1FF);
}
.rank-cover-ph { background: var(--brand-50, #F5F1FF); }

.rank-body { flex: 1; min-width: 0; }
.rank-title {
  font-size: var(--fs-body, 30rpx);
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rank-meta {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 8rpx;
  font-size: var(--fs-caption, 24rpx);
  color: var(--text-3);
}
.rank-board { color: var(--brand-800, #5A47C9); }

.rank-updated {
  text-align: center;
  padding: 24rpx 0;
  font-size: var(--fs-caption, 24rpx);
  color: var(--text-3);
}
```

> 所有颜色与字号均用 `theme.wxss` 已定义的 CSS 变量，不写裸值（遵循 V-01/V-04 规范）。变量缺失时用兜底值。

#### 5.4 `rank.json`

```json
{
  "navigationStyle": "custom",
  "usingComponents": {
    "nav-bar": "/components/nav-bar/nav-bar",
    "page-state": "/components/page-state/page-state"
  }
}
```

### 步骤 6：首页入口

#### 6.1 `miniprogram/pages/index/index.wxml`

位置：AI 引导卡 `</view>`（约第 40 行）之后、信息流 `page-state` 之前。

```xml
<!-- 排行榜入口 -->
<view class="rank-entry card" bindtap="onRankTap">
  <view class="rank-badge">榜</view>
  <view class="rank-text">
    <view class="rank-main">排行榜 · 看看大家在推什么</view>
  </view>
  <icon name="chevron-right-primary" size="36" />
</view>
```

#### 6.2 `miniprogram/pages/index/index.js`

```js
onRankTap() { wx.navigateTo({ url: '/pages/rank/rank' }) },
```

#### 6.3 `miniprogram/pages/index/index.wxss`

复用 `ai-card` / `ai-badge` 的结构参数，仅配色与文案不同：

```css
.rank-entry {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 20rpx 32rpx;
  background: var(--bg-card, #FFFFFF);
}
.rank-badge {
  width: 80rpx; height: 80rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #FFD8A8 0%, #F5A623 100%);
  color: #FFFFFF;
  font-size: var(--fs-body-s, 26rpx);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rank-text { flex: 1; }
.rank-main {
  font-size: var(--fs-body-l, 32rpx);
  font-weight: 600;
  color: var(--text-1);
}
```

### 步骤 7：历史数据回填（一次性）

现有帖子的 `popScore` 为空，排序会乱（空值位置不确定）。新建临时云函数 `cloudfunctions/taskBackfillPop/`：整目录复制 `taskHotScore/` 后改名，`config.json` 里去掉 `triggers`（不需要定时器）。

```js
/**
 * taskBackfillPop：一次性回填 posts.popScore（跑完可删除）
 * 入参 { cursor = 0, limit = 300 }
 * 出参 { scanned, updated, nextCursor, done }
 * 用法：控制台测试，从 {"cursor": 0} 起，按返回的 nextCursor 递增，直到 done = true
 */
const { coll, _, COL } = require('./lib/db');

exports.main = async (event) => {
  const cursor = Number(event.cursor) || 0;
  const limit = Math.min(Number(event.limit) || 300, 500);

  const res = await coll(COL.posts)
    .where({ status: _.neq('deleted') })
    .field({ stats: true })
    .skip(cursor)
    .limit(limit)
    .get();

  const rows = res.data || [];
  let updated = 0;

  for (const p of rows) {
    const s = p.stats || {};
    const popScore = 3 * (s.likeCount || 0) + 4 * (s.favCount || 0);
    try {
      // eslint-disable-next-line no-await-in-loop
      await coll(COL.posts).doc(p._id).update({ data: { popScore } });
      updated += 1;
    } catch (e) {
      // 单条失败不阻断整批
    }
  }

  return { ok: true, scanned: rows.length, updated, nextCursor: cursor + rows.length, done: rows.length < limit };
};
```

**部署顺序（重要）**：先部署 `rankList` / `taskBackfillPop` 等新函数 → 建索引 → 跑回填 → 手动触发一次 `taskHotScore` → 再验证榜单页。

---

## 六、上线步骤（严格按序）

| # | 操作 | 位置 | 备注 |
|---|---|---|---|
| 1 | 部署改动后的 `interactionToggle`、`postCreate` | 云开发控制台 | 影响点赞落库，先验证单次点赞正常 |
| 2 | 部署新函数 `rankList`、`taskBackfillPop` | 云开发控制台 | `updateFunctionCode` 不重装依赖，本次无新依赖 |
| 3 | 创建 3 个索引 | 控制台 → 数据库 → posts → 索引管理 | 等状态变为"正常"再继续 |
| 4 | 跑回填 | 控制台 → 云函数 → taskBackfillPop → 测试 | 循环调用直到 `done: true` |
| 5 | 手动触发 `taskHotScore` | 控制台 → 云函数 → 测试 | 让新秀榜的 `hotScore` 有区分度 |
| 6 | 上传小程序前端 | 开发者工具 | 新增页面需重新编译 |
| 7 | 按验收清单逐项验证 | — | 见第七节 |
| 8 | 验证通过后删除 `taskBackfillPop` | 云开发控制台 | 一次性工具，不留在生产 |

> 第 5 步不能漏。`hotScore` 由定时任务 hourly 更新，部署后若不手动跑一次，所有新帖的 `hotScore` 停留在初始值（约 0.35），新秀榜排序没有区分度。

---

## 七、验收清单

| # | 检查项 | 期望结果 |
|---|---|---|
| 1 | 索引状态 | 三个索引均显示"正常"，无缺失索引告警 |
| 2 | 回填正确性 | 随机抽查 3 条老帖，`popScore === 3×likeCount + 4×favCount` |
| 3 | 点赞 | 该帖 `popScore` 立即 +3；取消点赞 -3，且不小于 0 |
| 4 | 收藏 | `popScore` 立即 +4；取消 -4，且不小于 0 |
| 5 | 热度榜 | 按分数降序；最多 50 条；`popScore=0` 的帖子不出现 |
| 6 | 板块榜 | 只出现该板块帖子；板块顺序为 全部 / 美食 / 生活 / 学习 |
| 7 | 新秀榜 | 只出现 7 天内帖子；无内容时显示空态文案 |
| 8 | 封面 | 所有条目封面正常显示（验证 `decorateBriefs` 生效） |
| 9 | 跳转 | 点击任意条目进入详情页，帖子正常加载 |
| 10 | 已删除帖 | 后台软删一条榜内帖子，刷新榜单后该条消失 |
| 11 | 频控 | 1 分钟内点赞超过 60 次，第 61 次返回 42901 |
| 12 | 空态 | 无数据 / 请求失败时不白屏，有提示与重试入口 |
| 13 | 竞态 | 快速连点 Tab 与板块 chips，列表不串数据、不闪回旧榜 |
| 14 | 首页入口 | 入口条显示正常，点击进入榜单页，返回后首页信息流位置不丢 |

---

## 八、风险与规避

| 风险 | 影响 | 规避 |
|---|---|---|
| 未建索引 | 查询超时、榜单打不开 | 上线步骤第 3 步强制门禁，索引未就绪不继续 |
| 未回填 `popScore` | 老帖排序错乱，榜单不准确 | 上线步骤第 4 步，且回填后抽查校验 |
| 未手动跑 `taskHotScore` | 新秀榜无区分度 | 上线步骤第 5 步 |
| 刷赞 | 长期榜被小号霸占 | 分钟级频控；后续可加"同设备/同 IP 多账号"识别 |
| 头部固化 | 前 10 名长期被早期爆款占据 | 长期榜的必然特征，由新秀榜对冲，产品上接受 |
| `popScore` 多点写入 | 计数漂移、越算越偏 | 只在 `interactionToggle` 事务内单点维护，禁止别处 inc |
| 榜单页加互动 | 需第五处补丁同步，破坏一致性 | MVP 明确不做，交互留在详情页 |

---

## 九、工作量

| 步骤 | 内容 | 估计 |
|---|---|---|
| 1-2 | `interactionToggle` 写 popScore + 频控；`postCreate` 初始化 | 30 min |
| 3 | `rankList` 云函数 | 1.5 h |
| 4 | `api.js` 适配 | 15 min |
| 5 | 排行榜页面（js / wxml / wxss / json） | 2 h |
| 6 | 首页入口 | 30 min |
| 7 | 回填脚本 + 索引 + 上线验证 | 45 min |
| **合计** | | **≈ 5.5 h** |

---

## 十、后续迭代（P1，不在本期）

1. **板块页嵌入 TOP3**：`pages/board/board` 顶部加"本板块 TOP3"横滑条，复用 `rankList`（`type=board`），用户在板块页有明确意图，转化更高
2. **榜单名次变化角标**：快照里存 `prevRank`，展示"↑2 / ↓1"，增强榜单的可读性
3. **浏览量埋点**：`stats.viewCount` 字段已预留但全项目无人写入，补上后可派生"点赞率"，为推荐与运营复盘提供依据
4. **飙升榜**：按"近 7 天增量 ÷ 基线"计算，需维护周基线快照
