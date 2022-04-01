const Protocol = require('../../controllers/data-dict/protocol');

async function func(ctx, next) {
  await next();
  const { action } = ctx.params;

  let result = { ret: -10, msg: '无效action' };
  switch (action) {
    case 'create':
      result = await Protocol.create(ctx);
      break;
    case 'delete':
      result = await Protocol.delete(ctx);
      break;
    case 'query':
      result = await Protocol.query(ctx);
      break;
    default:
      break;
  }
  return result;
}

module.exports = func;
