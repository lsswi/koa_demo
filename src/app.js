const Koa = require('koa');
const router = require('./router');
const app = new Koa();
const koaBody = require('koa-body');

// const { Hello, DB, address } = require('./lib');
// const hello = require('./lib/hello');

app.use(koaBody()).use(router.routes()).use(router.allowedMethods());

app.listen(8888, () => {
  console.log('Server running on 8888');
});
