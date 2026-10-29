# 好物分享 · 校园微信小程序 MVP（v1.0）

单校邀请制好物分享社区：生活 / 学习 / 美食三大板块 + AI 站内问答。
**原生小程序**（WXML / WXSS / JavaScript / JSON，无 UniApp / Taro / 网页套壳）+ **CloudBase**（NoSQL / 云函数 / 云存储）。

- 设计稿：Ardot v4「软萌手账」fileId `739654946579466`（9 画板 S1–S9 与路由一一对应）
- 主文档：`docs/MVP产品开发文档-v1.0.md` —— **改契约先改文档**，第 9 章为云函数唯一事实来源
- 契约映射：`docs/契约映射-前端与环境版.md` —— 前端 ↔ 环境版函数字段对照
- 配色规范：`docs/配色规范-v4.md` + `miniprogram/theme.wxss`（令牌唯一来源）

## 项目结构

```
campus-share/
├── project.config.json                # appid 需替换为正式 AppID
├── miniprogram/                       # 小程序主包 932KB（限 2MB）
│   ├── app.js / app.json / app.wxss   # 全局壳：渐变底、自定义导航、字体预加载
│   ├── theme.wxss                     # v4 配色令牌 + 字阶 + 圆角阴影（V-01 零硬编码）
│   ├── custom-tab-bar/                # 三 Tab + 中央发布 FAB
│   ├── components/                    # icon / nav-bar / post-card / page-state
│   ├── assets/
│   │   ├── icons/     75 个 SVG 线性图标（含 PNG 栅格化副本）
│   │   ├── deco/      cat / cloud / star 页头插画
│   │   └── zcool-kuaile-subset.woff2  # 标题字体包内兜底（75KB）
│   ├── utils/
│   │   ├── api.js       ★ 统一适配层：语义化方法 ↔ 环境函数契约，含 fileId→URL 转换
│   │   ├── config.js    环境 ID / 板块 / 限流 / FONT_URL
│   │   ├── cloud.js    callFn 底层封装（仅供 api.js 使用）
│   │   ├── auth.js     needInvite 门禁态 + clearLogin
│   │   ├── format.js   timeAgo / countShort / 链接校验 / avatarIndex / clipChars
│   │   ├── media.js    压缩上传 / 批量取临时链接
│   │   ├── icons.js    图标清单
│   │   ├── agreements.js  用户协议 / 隐私政策内容
│   │   └── font-data.js   站酷快乐体子集（base64 Data URL 内嵌）
│   └── pages/          14 个页面
│       ├── index/          S1 首页（渐变页头 + 贴纸分类 + AI 引导卡 + 信息流）
│       ├── board/          S2 板块页
│       ├── post/create/    S3 发帖（图/视互斥 + 动态字段 + 链接过滤 + 草稿 + 幂等）
│       ├── post/detail/    S4 详情（轮播 + 字段卡 + 评论 + 点赞收藏 + 保存图片）
│       ├── ask/            S5 AI 问答（站内 RAG + 引用卡 + 无候选引导发帖）
│       ├── profile/        S6 我的（居中头像 + 三列统计 + 描边菜单卡 + 退出登录）
│       ├── post/comments/  S8 评论页（楼中楼 + 右对齐回复）
│       ├── search/         搜索（历史 + 热词 + token 检索）
│       ├── auth/invite/    邀请码门禁
│       ├── me/posts/       我的分享（状态筛选 + 删除）
│       ├── me/favorites/   我的收藏
│       ├── me/messages/    S9 站内消息（服务端 Tab 过滤 + 已读）
│       ├── about/          关于（社区守则）
│       ├── agreement/      用户协议 / 隐私政策
│       └── pkg-admin/admin/ S7 审核后台（分包，三 Tab）
├── cloudfunctions/        26 个云函数（lib/ 分层：db / resp / auth / present / config
│                          / msg / invite / rate / lex / tokenize / hot / embed / llm
│                          / wxapi / mediahelper）
│                          authLogin authBindInvite authDelete
│                          meOverview meUpdateProfile meList meMessageRead
│                          postList postDetail postCreate postDelete
│                          commentList commentCreate interactionToggle reportCreate
│                          askQuery aiEmbed aiStructure mediaCheck wxacodeGen
│                          adminQueue adminReview
│                          clientLog taskHotScore taskVectorize taskCleanup
├── _cloudfunctions_old_backup/        # 早期短名函数版（已废弃，禁止部署）
├── assets-font/                      # 字体源文件 + 子集化产物
├── tools/                            # 图标生成 / 字体子集化 / 色值令牌化 / 设计稿测量
└── docs/
```

## 部署结果（环境 `qqq-d7g05y68803d5476c` · 上海个人版 · 本地部署）

> ⚠️ 下方「部署结果」已切换到**自有云环境**（`qqq-d7g05y68803d5476c`，AppID `wx871271445ba93093`）。
> 原作者环境为 `yyq-d6g1dv0kgf893afe8`，切换见根目录 `switch_env.py --profile mine|author`。

| 资源 | 状态 |
|---|---|
| 集合（18 个） | users / invites / inviteCodes / posts / comments / interactions / reports / reviewQueue / messages / configs / idempotency / rateLimits / mediaAssets / sensitiveWords / auditLogs / qaLogs / qrcodes / vectors |
| 集合权限 | 全部「所有用户不可读写」（ADMINONLY），读写只经云函数 |
| 索引 | posts：`idx_status_created`、`idx_uid_cited`、`idx_board_hot` 等 9 个；reviewQueue 7 个；comments 5 个；reports 4 个；users：`idx_openid`（**唯一**）、`idx_myInviteCode`、`idx_deleteAt_status`、`idx_role`、`idx_status` |
| ⚠️ users 唯一键 | 唯一键是 **`openid`**，不是 `uid`。原代码建号只写 `openid`、查询用 `where({_id: ctx.uid})`；若建 `uid` 唯一索引，所有无 `uid` 字段的文档都视作 `null` → 第二个用户注册即撞 `E11000 dup key: { uid: null }` |
| 云函数（26 个） | 全部部署，Nodejs18.15，MODERATION_MODE=strict；`askQuery` 60s，写操作 20–30s |
| 云存储 | `icons/`（75 PNG）、`deco/`（3）、`fonts/zcool-kuaile-subset.woff2`，桶 READONLY 公有读，CDN 已验证可匿名访问 |
| 定时触发器 | 3 个：taskHotScore 每小时 / taskVectorize 每 5 分 / taskCleanup 每日 03:00 |
| 邀请码 | 站点邀请码 **`gxnu2026`**（大小写不敏感，库内大写归一 `GXNU2026`，`maxUses: 100`）；旧码 `CAMPUS2026` 已失效；configs（limits/hot/moderation/ask）、演示用户与帖子为种子数据 |

## 已验证项

**云端联调（管理端直调）**
- `commentList` / `meOverview` / `adminQueue` 冒烟：冷启动 379–547ms，代码加载无错误，统一返回 40100「请重新进入小程序」（MCP 无 OPENID，预期鉴权行为）
- `clientLog` 完整执行业务逻辑返回 `code:0`（`dropped:true` 为无 userInfo 的熔断降级），证明 DB 写入链路正常
- `taskVectorize` 实调返回 `{ok, scanned:4, todo:0, done:0, fails:0}` —— 新版返回格式，确认部署的为新代码
- 26 个云函数全部 `Active`，逐个用 `fn detail` 核实过状态与关键修复标记

**静态校验**
- 429 个 JS 全部通过 `node --check`
- 14 个页面 WXML 事件绑定 100% 有对应 handler（曾发现 `posts.wxml` 缺 `onMore`，已补）
- require 相对路径全部可解析
- 19 个 `api.*` 调用点与 `api.js` 19 个导出方法一一对应
- V-01 零硬编码色值（60 处已令牌化到 theme.wxss；又收敛 23 处 rgba 半透明色为 `--*-aNN` 令牌，theme.wxss 为唯一色值来源）
- V-04 字阶合规：12 档 `--fs-*` 令牌（22/24/26/28/30/32/34/36/40/44/48/72rpx）
- `tools/static-check.js` 常驻校验器（8 类：wx:else 编译约束 / 标签配对 / 事件方法定义 / V-01 色值 / V-04 字阶 / JSON 与 usingComponents / 图标资源 / app.json 路由），末次运行 20 WXML + 22 WXSS + 22 JSON **0 问题**
- **57 项单元测试全过**（限流 fail-closed / 分批更新 250 条 / 评论匿名化与 avatarIdx / 前后端口径一致 / 事务重试 / 邀请码门禁顺序 / 向量化标记配套 / app.json 与 wx:key）
- 修掉 `messages.wxml` 编译错误：`wx:else` 与 `wx:if` 之间隔了 msg-tabs 区块，改为显式 `wx:if="{{state === 'success'}}"`；`page-state` 属性 `actionText` → `btnText`；角标文字色 `#FFFFFF` → `var(--text-on-brand)`
- 修掉控制台一片红（10-25）：① 图标 500——`icon` 组件原来把 `cloud://` fileID 直塞 `<image src>`（fileID 必须经 `getTempFileURL` 转 https 才能渲染），改为**包内路径直出**（75 个图标 PNG 已全量打包，<100KB）；② 字体 CORS——`loadTitleFace` 云端优先改为**包内 woff2 优先**（75KB，零网络零 CORS），云端降级兜底；③ `app.json` 删除无效的 `permission["scope.writePhotosAlbum"]` 声明（微信 2025-10 起该 scope 不再需要代码声明，改由后台隐私指引配置）

## 本轮修复的 24 个 Bug

清单见 `Bug清单.md`。要点：

| 类别 | 条目 | 修法 |
|---|---|---|
| **致命** | B1 隐私弹窗 `this` 绑定错 | `success` 改箭头函数 |
| | B2 内容审核可绕过 | 送审图由服务端从 fileId 推导，不信客户端的 checkFileId |
| | B3 头像 24h 后被删光 | 头像注册 `inUse:true` → refCount=1；删除前 `isStillReferenced()` 二次校验 |
| **功能不可用** | B4 状态角标不显示 | `p.manageable` → `this.data.manageable` + observer |
| | B5 media 为空整页崩 | `(post.media \|\| []).forEach` |
| | B6 「我的分享」翻不到匹配帖 | 过滤后为空但服务端还有数据时自动继续翻页 |
| | B7 收藏页空态按钮点了没反应 | 属性名 `actionText` → `btnText` + 补 `bind:action` |
| **安全/一致性** | B8 评论泄露 authorUid | 25 份 `present.js` 统一，commentItem 不下发 uid；avatarIdx 按**楼层**派生（按作者派生会重建作者画像） |
| | B9 限流 fail-open | 异常路径改 fail-closed：计数补不上就拒绝（`degraded:true` + 日志） |
| | B10 批量更新超 100 条失效 | 新增公共 `batchUpdate`（扫 id → 每 100 个一组更新）；修 adminReview / taskCleanup / postDelete 三处 |
| | B11 评论事务无重试 | 事务体抽成独立函数 + `MAX_RETRY=2` 退避重试 |
| | B12 向量化只扫最新 100 条 | `postCreate` 写 `embedded:false`、`aiEmbed` 成功后置 `true`，查询直接命中 + createdAt 游标推进 |
| | B13 热度/过期标记硬上限 | 扫描上限提到 5000 条；过期标记改分批 |
| | B14 兜底文案丢失 | 用本地 `this.doneText(x)` 而非恒 undefined 的 `x.doneText` |
| **逻辑/体验** | B17 分类未读数硬编码 0 | `meMessageRead` 返回分类 counts |
| | B18 邀请码绕过 | 重排顺序：校验 → 乐观锁扣减 → **才建号**；建号失败归还名额 |
| | B19 评论 id/floor 无兜底 | 拿不到 commentId 就提示并重拉列表，不塞 undefined（否则 wx:key 重复） |
| | B20 加载更多失败文案矛盾 | 文案改「点击重试」+ 提示条可点 |
| | B21 needInvite 时闪 error | firstLoad catch 加 `if (e.silent) return` |
| | B22 标题超限数据不一致 | 截断 + 提示，新增 `clipChars`（Array.from 口径，不劈 emoji） |
| | B23 冗余组件注册 | 移除 `user-avatar` / `status-tag` / `comment-item`（零引用，目录已删） |
| | B24 wx:key 不稳定 | media 加本地唯一 id `lid`；agreement/detail 两处实际稳定，保留 index |
| 已修（早前） | B15 B16 | 预览混视频 / 切 tab 竞态 |

**新增 4 个 lib 副本同步脚本**（25 份副本改一处必须同步其余，否则行为不一致）：
`tools/sync-rate.py`、`tools/sync-db.py`、`tools/sync-present.py`、`tools/sync-mediahelper.py`

## 上线前待办

1. **正式 AppID**：`project.config.json` 当前为 `wx871271445ba93093`（自有账号的测试 appid），正式发布需替换；微信后台开通云开发并配置合法域名（含存储 CDN 域名 `*.tcb.qcloud.la`）
2. **真机回归**：体验版逐屏过 S1–S9，重点验证邀请码门禁、图/视互斥上传、750 宽送审图、草稿恢复、保存相册授权、楼中楼回复、审核台三 Tab
3. **敏感词全量词库**：当前为演示子集，需替换完整词库并同步 `configs.moderation`；词库绝不下发前端
4. **视频人工复审**：视频帖已送 reviewQueue，需审核员人工看片流程（S7 已支持）
5. **AI 检索升级**：MVP 用 2-gram token 检索，量大后切 `taskVectorize` 向量检索（`embedded` 标记已就位）
6. **隐私合规**：代码侧的《用户协议》《隐私政策》页与 `onNeedPrivacyAuthorization` 钩子已实现，**后台「隐私保护指引」表单仍需手动填写**；另需开通内容安全能力（msgSecCheck/imgSecCheck）、提交审核
7. **频控兜底**：`authLogin` 已接入冷启动限流（5 次 / 10 分钟）
8. **管理员首位**：`users` 里目前只有 4 个演示用户（role=user），真实账号登录后为 admin —— 换环境后**第一个登录的人就是管理员**

## 设计还原要点（v4 软萌手账）

- 主色 `#6C5CE7`，淡紫底文字 `#5A47C9`，渐变底 `#F5F1FF → #EAF4FF`
- 板块色：生活薄荷 `#4ECDC4`、学习天蓝 `#5AA9FF`、美食珊瑚 `#FF7A8A`
- 白卡 48rpx 圆角、无描边、紫晕阴影；按钮胶囊
- 标题字体站酷快乐体（ZCOOL KuaiLe，OFL 1.1 可商用）：子集化 woff2 75KB **转 base64 Data URL 内嵌**（`utils/font-data.js`，由 `tools/build-font-data.js` 生成）——`wx.loadFontFace` 的 source 仅支持 https/Data URL（包内路径不被支持），云存储 CDN 无 CORS 均不可用；Data URL 零网络零 CORS，失败降级系统 600 字重
- 全站匿名化：接口不下发 `authorUid`，评论身份为「匿名 #N」+ 糖果色头像轮换（前后端同口径 `avatarIndex(uid)`）
