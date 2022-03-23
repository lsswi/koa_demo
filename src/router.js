/**
 * 自动require routes 目录下的js/json文件，并且按 [目录名] 注册到 router上
 *
 * 如 routes/category/cgi.js 将会注册 为接口：/node-cgi/category/cgi/:action*
 *   routes/demo.js 注册为接口： /node-cgi/demo/:action*
 *
 * action是url中的可选参数
 *
 * 1. 不支持文件名带空格, 2. 不包括routes/common目录
 */
const Router = require('@koa/router');
const requireDirectory = require('require-directory');
const { isFunction, isPlainObject } = require('lodash');

const PREFIX = '/node-cgi';
const router = new Router();

function backTrack(obj, flatObj, prefixList = []) {
  Object.keys(obj).forEach((key) => {
    if (isFunction(obj[key])) {
      const name = prefixList.concat([key]).join('/');
      flatObj[name] = obj[key];
    }

    if (isPlainObject(obj[key])) {
      backTrack(obj[key], flatObj, prefixList.concat(key));
    }
  });
}

function flattenDeep(obj) {
  const flatObj = {};
  backTrack(obj, flatObj);
  return flatObj;
}

class RouterManager {
  /**
   * 自动 require 指定routes文件目录，支持递归嵌套
   * @returns {Object}  拍平的对象 e.g. { demo: [AsyncFunction], cgiName: [AsyncFunction], 'dir/subDir/cgiName': [AsyncFunction] }
   */
  static getRoutes() {
    const apiDirectory = './routes';
    const routes = requireDirectory(module, apiDirectory, {
      exclude(path) {
        if (/\/common\//.test(path)) {
          return true;
        }
      },
    });

    return flattenDeep(routes);
  }
  /**
   * 启动路由注册
   * @param {*} router
   * @param {*} routes
   */
  static initLoadRouters(router, routes) {
    Object.keys(routes).forEach((cgiName) => {
      const routePath = `${PREFIX}/${cgiName}/:action*`;
      console.log(routePath);
      router
        .get(routePath, async (ctx, next) => {
          const result = await routes[cgiName](ctx, next);

          if (ctx.query.callback) {
            ctx.body = `${ctx.query.callback}(${JSON.stringify(result)})`;
          } else {
            ctx.body = result;
          }
        })
        .post(routePath, async (ctx, next) => {
          const result = await routes[cgiName](ctx, next);
          ctx.body = result;
        });
    });
  }
}

const routes = RouterManager.getRoutes();
RouterManager.initLoadRouters(router, routes);

module.exports = router;
