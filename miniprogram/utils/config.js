/**
 * 全局配置 —— 云环境、板块定义、限流参数
 * 部署时唯一需要核对的文件：CLOUD_ENV 必须与云开发控制台一致
 */
module.exports = {
  CLOUD_ENV: 'yyq-d6g1dv0kgf893afe8',

  /**
   * 图标统一引用（云存储优先，本地包内副本兜底）
   * 部署后由 tools/upload-assets 上传至云存储 assets/icons/
   */
  ICON_CLOUD_BASE: 'cloud://yyq-d6g1dv0kgf893afe8.assets/icons/',
  ICON_LOCAL_BASE: '/assets/icons/',

  /**
   * 标题圆体（站酷快乐体 ZCOOL KuaiLe，SIL OFL 1.1 可商用）
   * 加载方式：base64 Data URL 内嵌（utils/font-data.js，由 tools/build-font-data.js 从包内 woff2 生成）。
   * 不走云端 URL：wx.loadFontFace 要求 CORS（servicewechat.com 来源）且仅支持 https/Data URL，
   * 云存储桶未开 CORS；包内路径不被 source 支持。重建字体后需重跑 tools/build-font-data.js。
   */
  FONT_FAMILY: 'KuaiLe',

  // 板块定义（首页贴纸 / 发帖动态字段 / 详情 chips 共用）
  BOARDS: {
    life: {
      label: '生活',
      sticker: 'sticker-lamp',
      color: 'mint',
      fields: [
        { key: 'shop', label: '好物相关', placeholder: '在哪买的 / 多少钱 / 位置…' }
      ]
    },
    study: {
      label: '学习',
      sticker: 'sticker-book',
      color: 'sky',
      // 单字段：与生活/美食板块口径一致，一个框写清即可
      fields: [
        { key: 'course', label: '课程相关', placeholder: '课程名 / 老师 / 资料名…' }
      ]
    },
    food: {
      label: '美食',
      sticker: 'sticker-bowl',
      color: 'coral',
      // 单字段：与生活/学习板块口径一致
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
