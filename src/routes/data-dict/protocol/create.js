const Protocol = require("../../../controllers/data-dict/protocol");
const b = require("koa-body");

module.exports = function (ctx, next) {
  // GET 获取参数方式
  // const params = ctx.query;
  // POST获取参数方式
  // console.log(ctx.request.body)
  const params = ctx.request.body;
  return Protocol.Create(params);
};
