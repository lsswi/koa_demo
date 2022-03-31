const Event = require('../../controllers/data-dict/event');

async function func(ctx, next) {
  await next();
  const { action } = ctx.params;

  let result = { ret: -10, msg: '无效action' };
  switch (action) {
    case 'create':
      result = await Event.create(ctx);
      break;
    case 'delete':
      result = await Event.delete(ctx);
      break;
    case 'query':
      result = await Event.query(ctx);
      break;
    default:
      break;
  }
  return result;
}

module.exports = func;
