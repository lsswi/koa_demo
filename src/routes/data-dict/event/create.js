const Event = require('../../../controllers/data-dict/event');

module.exports = function (ctx) {
  // GET 获取参数方式
  // const params = ctx.query;
  // POST获取参数方式
  // console.log(ctx.request.body)
  return Event.create(ctx);
};
