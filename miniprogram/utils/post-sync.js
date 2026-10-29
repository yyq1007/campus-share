/**
 * 跨页同步帖子互动状态：详情页点赞/收藏后，返回列表页时把变更补到卡片上
 * 补丁记录的是绝对值（liked/likeCount/faved/favCount），重复应用无副作用；
 * 每个列表页只应用「自己上次拉取/同步之后」产生的补丁，避免旧补丁盖掉新数据
 */
function store() {
  const g = getApp().globalData
  if (!g.postPatches) g.postPatches = {}
  return g.postPatches
}

/** 记录一条帖子变更 */
function patchPost(id, patch) {
  if (!id) return
  const all = store()
  all[id] = { ...(all[id] || {}), ...patch, at: Date.now() }
}

/**
 * 取 since 之后的补丁，转换为对 list 的 setData 对象
 * @returns {{ updates: Object, removedIds: String[] }}
 */
function collectPatches(list, since, listKey = 'list') {
  const all = store()
  const updates = {}
  const removedIds = []
  ;(list || []).forEach((item, idx) => {
    const p = all[item.id]
    if (!p || p.at <= since) return
    ;['liked', 'likeCount', 'faved', 'favCount'].forEach(k => {
      if (p[k] !== undefined && p[k] !== item[k]) updates[`${listKey}[${idx}].${k}`] = p[k]
    })
    if (p.faved === false) removedIds.push(item.id)
  })
  return { updates, removedIds }
}

module.exports = { patchPost, collectPatches }
