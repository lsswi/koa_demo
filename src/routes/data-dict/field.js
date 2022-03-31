const Field = require('../../controllers/data-dict/field');

async function func(ctx, next) {
  await next();
  const { action } = ctx.params;

  let result = { ret: -10, msg: '无效action' };
  switch (action) {
    case 'create':
      result = await Field.create(ctx);
      break;
    case 'delete':
      result = await Field.delete(ctx);
      break;
    case 'query':
      result = await Field.query(ctx);
      break;
    default:
      break;
  }
  return result;
}

module.exports = func;
