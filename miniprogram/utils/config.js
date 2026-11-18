/**
 * 全局配置 —— 云环境、板块定义、限流参数
 * 部署时唯一需要核对的文件：CLOUD_ENV 必须与云开发控制台一致
 */
module.exports = {
  CLOUD_ENV: 'yyq-d6g1dv0kgf893afe8',

  /**
   * 图标统一引用（云存储优先，本地包内副本兜底）
   * 实际渲染一律走包内路径（见 utils/icons.js：cloud:// fileID 不能直接用作
   * <image src>，cloudIcon() 已废弃禁止用于渲染）。云存储副本仅作兼容备份，
   * 由 tools/upload-assets.py 上传。
   */
  ICON_CLOUD_BASE: 'cloud://yyq-d6g1dv0kgf893afe8.icons/',
  ICON_LOCAL_BASE: '/assets/icons/',

  /**
   * 标题圆体（站酷快乐体 ZCOOL KuaiLe，SIL OFL 1.1 可商用）
   * 加载方式：base64 Data URL 内嵌（utils/font-data.js，由 tools/build-font-data.js 从包内 woff2 生成）。
   * 不走云端 URL：wx.loadFontFace 要求 CORS（servicewechat.com 来源）且仅支持 https/Data URL，
   * 云存储桶未开 CORS；包内路径不被 source 支持。重建字体后需重跑 tools/build-font-data.js。
   */
  FONT_FAMILY: 'KuaiLe',

  // 板块定义（首页贴纸 / 发帖动态字段 / 详情 chips 共用）
  //
  // allowLink：该板块的发帖表单是否提供「购买链接」输入框。
  // 只有生活（好物分享）需要 —— 学习/美食板块分享的是资料与店铺，不需要商品链接。
  // 前端按它决定链接卡显不显示；服务端 postCreate 不按板块区分 link，
  // 所以前端在非生活板块必须主动不带 link 上行。
  BOARDS: {
    life: {
      label: '生活',
      sticker: 'sticker-lamp',
      color: 'mint',
      allowLink: true,
      fields: [
        { key: 'shop', label: '好物相关', placeholder: '在哪买的 / 多少钱 / 位置…' }
      ]
    },
    study: {
      label: '学习',
      sticker: 'sticker-book',
      color: 'sky',
      // 单字段：与生活/美食板块口径一致，一个框写清即可
      allowLink: false,
      fields: [
        { key: 'course', label: '课程相关', placeholder: '课程名 / 老师 / 资料名…' }
      ]
    },
    food: {
      label: '美食',
      sticker: 'sticker-bowl',
      color: 'coral',
      // 单字段：与生活/学习板块口径一致
      allowLink: false,
      fields: [
        { key: 'shop', label: '店铺相关', placeholder: '店名 / 位置 / 人均…' }
      ]
    }
  },
  BOARD_KEYS: ['life', 'study', 'food'],

  // 首页分类贴纸（第 4 个“选课经验”归入学习板块，糖果色与设计稿一致）
  CATEGORY_STICKERS: [
    { key: 'life', icon: 'sticker-lamp', label: '宿舍好物', color: 'mint' },
    { key: 'food', icon: 'sticker-bowl', label: '食堂美食', color: 'coral' },
    { key: 'study', icon: 'sticker-book', label: '学习资料', color: 'sun' },
    { key: 'study2', icon: 'sticker-calendar', label: '选课经验', color: 'sky', board: 'study' }
  ],

  // 发布限制（与服务端 configs.limits 对齐，前端先做一层体验校验）
  LIMITS: {
    titleMax: 40,
    contentMin: 5,
    contentMax: 2000,
    commentMax: 300,
    askMax: 100,
    linkMax: 200,
    maxImages: 6,
    maxImageMB: 1,
    maxVideoMB: 30,
    videoSeconds: 60
  },

  // 过期阈值（天），与服务端 configs.hot.expireDays 一致
  EXPIRE_DAYS: 90,

  VERSION: 'v1.0.0'
}
