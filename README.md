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
│   │                                  #   / user-avatar / status-tag / comment-item
│   ├── assets/
│   │   ├── icons/     75 个 SVG 线性图标（含 PNG 栅格化副本）
│   │   ├── deco/      cat / cloud / star 页头插画
│   │   └── zcool-kuaile-subset.woff2  # 标题字体包内兜底（75KB）
│   ├── utils/
│   │   ├── api.js       ★ 统一适配层：语义化方法 ↔ 环境函数契约，含 fileId→URL 转换
│   │   ├── config.js    环境 ID / 板块 / 限流 / FONT_URL
│   │   ├── cloud.js    callFn 底层封装（仅供 api.js 使用）
│   │   ├── auth.js     needInvite 门禁态 + clearLogin
│   │   ├── format.js   timeAgo / countShort / 链接校验 / avatarIndex
│   │   ├── media.js    压缩上传 / 批量取临时链接
│   │   └── icons.js    图标清单
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

## 部署结果（环境 `yyq-d6g1dv0kgf893afe8` · 上海个人版）

| 资源 | 状态 |
|---|---|
| 集合（18 个） | users / invites / inviteCodes / posts / comments / interactions / reports / reviewQueue / messages / configs / idempotency / rateLimits / mediaAssets / sensitiveWords / auditLogs / qaLogs / qrcodes / vectors |
| 集合权限 | 全部「所有用户不可读写」（ADMINONLY），读写只经云函数 |
| 索引 | posts：`idx_status_created`、`idx_uid_cited`、`idx_board_hot` 等 9 个；reviewQueue 7 个；comments 5 个；reports 4 个；users 3 个（含 `uid` 唯一） |
| 云函数（26 个） | 全部部署，Nodejs18.15；`askQuery` 60s，写操作 20–30s |
| 云存储 | `assets/icons/`（75 PNG）、`assets/deco/`（3）、`assets/fonts/zcool-kuaile-subset.woff2`，桶 READONLY 公有读，CDN 已验证可匿名访问 |
| 本轮改动 | `commentList` / `commentCreate` 重新部署（18:04）：评论出参脱敏 `authorUid` → 服务端计算 `isMine`，`commentCreate` 补 `replyToFloor`；`authBindInvite` 重新部署（19:59）：绑定模型从 `inviteCodes`（一人一码）修正为线上实际的 `invites` 集合（一码多人用，`usedCount/maxUses` 乐观锁），长度上限 8 → 16 位 |
| 邀请码 | 站点邀请码 **`gxnu2026`**（大小写不敏感，库内大写归一 `GXNU2026`，`maxUses: 100`，已重置计数）；旧码 `CAMPUS2026` 已失效；configs（limits/hot/moderation/ask）、演示用户与帖子为种子数据 |

## 已验证项

**云端联调（管理端直调）**
- `commentList` / `meOverview` / `adminQueue` 冒烟：冷启动 379–547ms，代码加载无错误，统一返回 40100「请重新进入小程序」（MCP 无 OPENID，预期鉴权行为）
- `clientLog` 完整执行业务逻辑返回 `code:0`（`dropped:true` 为无 userInfo 的熔断降级），证明 DB 写入链路正常
- 线上 `commentCreate` 代码哈希与本地一致，出参含 `replyToFloor` + `isMine`
- `present.js` 仅 commentList / commentCreate 两处有意改动，其余 24 个函数与线上逐字节一致

**静态校验**
- 3025 行 JS 全部通过 `node --check`
- 14 个页面 WXML 事件绑定 100% 有对应 handler（曾发现 `posts.wxml` 缺 `onMore`，已补）
- require 相对路径全部可解析
- 19 个 `api.*` 调用点与 `api.js` 19 个导出方法一一对应
- V-01 零硬编码色值（60 处已令牌化到 theme.wxss；本轮又收敛 23 处 rgba 半透明色为 `--*-aNN` 令牌，theme.wxss 为唯一色值来源）
- V-04 字阶合规：12 档 `--fs-*` 令牌（22/24/26/28/30/32/34/36/40/44/48/72rpx）
- `tools/static-check.js` 常驻校验器（8 类：wx:else 编译约束 / 标签配对 / 事件方法定义 / V-01 色值 / V-04 字阶 / JSON 与 usingComponents / 图标资源 / app.json 路由），末次运行 23 WXML + 25 WXSS + 25 JSON **0 问题**
- 修掉 `messages.wxml` 编译错误：`wx:else` 与 `wx:if` 之间隔了 msg-tabs 区块，改为显式 `wx:if="{{state === 'success'}}"`；`page-state` 属性 `actionText` → `btnText`；角标文字色 `#FFFFFF` → `var(--text-on-brand)`
- 修掉控制台一片红（10-25）：① 图标 500——`icon` 组件原来把 `cloud://` fileID 直塞 `<image src>`（fileID 必须经 `getTempFileURL` 转 https 才能渲染），改为**包内路径直出**（75 个图标 PNG 已全量打包，<100KB）；② 字体 CORS——`loadTitleFace` 云端优先改为**包内 woff2 优先**（75KB，零网络零 CORS），云端降级兜底；③ `app.json` 删除无效的 `permission["scope.writePhotosAlbum"]` 声明（微信 2025-10 起该 scope 不再需要代码声明，改由后台隐私指引配置）

## 上线前待办

1. **正式 AppID**：`project.config.json` 当前为测试 appid，需替换；微信后台开通云开发并配置合法域名（含存储 CDN 域名 `*.tcb.qcloud.la`）
2. **真机回归**：体验版逐屏过 S1–S9，重点验证邀请码门禁、图/视互斥上传、750 宽送审图、草稿恢复、保存相册授权、楼中楼回复、审核台三 Tab
3. **敏感词全量词库**：当前为演示子集，需替换完整词库并同步 `configs.moderation`；词库绝不下发前端
4. **视频人工复审**：视频帖已送 reviewQueue，需审核员人工看片流程（S7 已支持）
5. **AI 检索升级**：MVP 用 2-gram token 检索，量大后切 `taskVectorize` 向量检索（vectors 集合已有 12 条演示向量）
6. **隐私合规**：补充《用户协议》《隐私政策》页并配置到「关于」；准备小程序类目审核材料
7. **频控兜底**：`authLogin` 成功后建议在 `users.lastSeenAt` 加冷启动限流（防刷）

## 设计还原要点（v4 软萌手账）

- 主色 `#6C5CE7`，淡紫底文字 `#5A47C9`，渐变底 `#F5F1FF → #EAF4FF`
- 板块色：生活薄荷 `#4ECDC4`、学习天蓝 `#5AA9FF`、美食珊瑚 `#FF7A8A`
- 白卡 48rpx 圆角、无描边、紫晕阴影；按钮胶囊
- 标题字体站酷快乐体（ZCOOL KuaiLe，OFL 1.1 可商用）：子集化 woff2 75KB **转 base64 Data URL 内嵌**（`utils/font-data.js`，由 `tools/build-font-data.js` 生成）——`wx.loadFontFace` 的 source 仅支持 https/Data URL（包内路径不被支持），云存储 CDN 无 CORS 均不可用；Data URL 零网络零 CORS，失败降级系统 600 字重
- 全站匿名化：接口不下发 `authorUid`，评论身份为「匿名 #N」+ 糖果色头像轮换（前后端同口径 `avatarIndex(uid)`）
