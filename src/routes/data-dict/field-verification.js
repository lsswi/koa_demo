const FieldVerification = require('../../controllers/data-dict/field-verification');

async function func(ctx, next) {
  await next();
  const { action } = ctx.params;

  let result = { ret: -10, msg: '无效action' };
  switch (action) {
    case 'create':
      result = await FieldVerification.create(ctx);
      break;
    case 'delete':
      result = await FieldVerification.delete(ctx);
      break;
    default:
      break;
  }
  return result;
}

module.exports = func;
