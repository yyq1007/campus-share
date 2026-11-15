/** 统一响应包络（9.1）+ 错误码表（附录 A） */
const ERR_MSG = {
  40001: '参数有误',
  40002: '字数超限',
  40003: '内容不合规',
  40010: '内容里有不合规表述',
  40100: '请重新进入小程序',
  40101: '请先输入邀请码',
  40301: '没有权限执行该操作',
  40302: '账号已被封禁',
  40303: '你暂时不能发布内容',
  40304: '邀请码已停用',
  40401: '内容不存在或已删除',
  40402: '内容不存在或已删除',
  40901: '已经提交过了',
  40902: '你已经操作过了',
  40903: '这个邀请码已经被使用了',
  40904: '该内容已被处理',
  42901: '操作太频繁，稍后再试',
  42902: '今天的使用次数用完了',
  50000: '请求超时',
  50001: '服务异常',
  50002: '审核接口异常',
  50003: 'AI 异常',
  50004: '存储异常',
  50005: '小程序码生成失败',
};

function traceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ok(data) {
  return { code: 0, msg: 'ok', data: data === undefined ? {} : data, traceId: traceId() };
}

function fail(code, msg, data) {
  return { code, msg: msg || ERR_MSG[code] || '请求失败', data: data || {}, traceId: traceId() };
}

module.exports = { ok, fail, ERR_MSG, traceId };
