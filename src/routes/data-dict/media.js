const Media = require('../../controllers/data-dict/media');

async function func(ctx, next) {
  await next();
  const { action } = ctx.params;

  let result = { ret: -10, msg: '无效action' };
  switch (action) {
    case 'create':
      result = await Media.create(ctx);
      break;
    case 'delete':
      result = await Media.delete(ctx);
      break;
    case 'query':
      result = await Media.query(ctx);
      break;
    case 'create-binding':
      result = await Media.createBinding(ctx);
      break;
    case 'delete-binding':
      result = await Media.deleteBinding(ctx);
      break;
    case 'query-binding':
      result = await Media.queryBinding(ctx);
      break;
    default:
      break;
  }
  return result;
}

module.exports = func;
