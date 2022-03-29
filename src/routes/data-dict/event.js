const Event = require('../../controllers/data-dict/event');

async function func(ctx, next) {
  await next();
  const { action } = ctx.params;

  let result = { ret: -10, msg: '无效action' };
  switch (action) {
    case 'create':
      result = await Event.create(ctx);
      break;
    case 'edit':
      result = await Event.edit(ctx);
      break;
    case 'delete':
      result = await Event.delete(ctx);
      break;
    case 'query':
      result = await Event.query(ctx);
      break;
    // TODO 欠一个根据事件ID获取详情信息+绑定字段规则接口（编辑用）
    default:
      break;
  }
  return result;
}

module.exports = func;
