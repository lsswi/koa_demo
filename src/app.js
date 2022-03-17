var koa = require("koa");
var app = new koa();
const a = require("./lib").Hello;

app.use(function* () {
  this.body = "Hello, world!";
});
app.listen(8888, function () {
  a.p();
  console.log(a.name);
  console.log("Server running on 8888");
});
