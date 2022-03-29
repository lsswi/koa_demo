const FieldVerification = require('../../../controllers/data-dict/field-verification');

module.exports = function (ctx) {
  // GET 获取参数方式
  // const params = ctx.query;
  // POST获取参数方式
  // console.log(ctx.request.body)
  return FieldVerification.delete(ctx);
};
