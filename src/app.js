const Koa = require('koa');
const router = require('./router');
const app = new Koa();
const koaBody = require('koa-body');
const schedule = require('node-schedule');
const { dumpVerificationResult } = require('./scheduler/data-dict');

// const { Hello, DB, address } = require('./lib');
// const hello = require('./lib/hello');

schedule.scheduleJob('*/20 * * * * *', dumpVerificationResult);

app.use(koaBody()).use(router.routes()).use(router.allowedMethods());

app.listen(8888, () => {
  console.log('Server running on 8888');
});
