const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');

const Protocol = {
  /**
   * 创建协议
   * @url /node-cgi/data-dict/event/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };

    if (!checkCreateParam(params)) {
      ret.code = Ret.CodeParamError;
      ret.msg = 'params error, param name, proto_type can not be null, category must be int array';
      return ret;
    }

    const querySql = `INSERT INTO ${TableInfo.TableProtocol}(name, proto_type, category, \`desc\`, operator)
      VALUES(:name, :protoType, :category, :desc, :operator)`;
    await DBClient.query(querySql, {
      replacements: {
        name: params.name,
        protoType: params.proto_type,
        category: params.category.join(','),
        desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
        // operator: ctx.session.user.loginname,
        operator: 'joyyieli',
      },
    })
      .then((res) => {
        ret.data = {
          id: res[0],
        };
      })
      .catch((err) => {
        console.error(err);
        ret.code = Ret.CodeInternalDBError;
        ret.msg = Ret.MsgInternalDBError;
      });

    return ret;
  },

  /**
   * 删除协议
   * @url /node-cgi/data-dict/event/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };
    if (!checkDeleteParam(params)) {
      ret.code = Ret.CodeParamError;
      ret.msg = 'params error, param ids must be an int array';
      return ret;
    }
    const querySql = `DELETE FROM ${TableInfo.TableProtocol} WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids: params.ids } })
      .then(() => {
        ret.data = {
          ids: params.ids,
        };
      })
      .catch((err) => {
        console.error(err);
        ret.code = Ret.CodeInternalDBError;
        ret.msg = Ret.MsgInternalDBError;
      });
    return ret;
  },

  /**
   * 编辑协议
   * @url /node-cgi/data-dict/event/edit
   */
  async edit(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };
    if (!checkEditParam(params)) {
      ret.code = Ret.CodeParamError;
      ret.msg = 'params error, param id, proto_type, name, desc, category can not be null';
      return ret;
    }

    const querySql = `UPDATE ${TableInfo.TableProtocol} SET
      name=:name,proto_type=:proto_type,category=:category,\`desc\`=:desc,operator=:operator
      WHERE id=:id`;
    await DBClient.query(querySql, {
      replacements: {
        name: params.name,
        proto_type: params.proto_type,
        category: params.category.join(','),
        desc: params.desc,
        // operator: ctx.session.user.loginname,
        operator: 'joyyieli',
        id: params.id,
      },
    })
      .then(() => {
        ret.data = {
          id: params.id,
        };
      })
      .catch((err) => {
        console.error(err);
        ret.code = Ret.CodeInternalDBError;
        ret.msg = Ret.MsgInternalDBError;
      });
    return ret;
  },

  /**
   * 查询协议
   * @url /node-cgi/data-dict/event/query
   */
  async query(ctx) {
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };
    const params = ctx.query;
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.page : 10;

    let querySql = `SELECT * FROM ${TableInfo.TableProtocol} LIMIT :offset,:size`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableProtocol}`;
    if (params.query !== '') {
      querySql = `SELECT * FROM ${TableInfo.TableProtocol} WHERE id=:query OR name LIKE :name OR operator=:query LIMIT :offset,:size`;
      countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableProtocol} WHERE id=:query OR name LIKE :name OR operator=:query`;
    }
    const result = Promise.all([
      DBClient.query(querySql, { replacements: { query: params.query, name: `%${params.query}%`, offset: page - 1, size } }),
      DBClient.query(countSql, { replacements: { query: params.query, name: `%${params.query}%` } }),
    ]);
    await result
      .then((promiseRes) => {
      // promiseALl返回两个查询的结果，sql返回的是两个元素的数组，内容基本一样，直接取第一个即可
      // 参考 https://sequelize.org/v7/manual/raw-queries.html
        const queryResult = promiseRes[0][0];
        const queryCount = promiseRes[1][0][0].cnt;
        const list = [];
        for (const proto of queryResult) {
          list.push({
            id: proto.id,
            name: proto.name,
            desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
            operator: proto.operator,
            category: proto.category.split(','),
            updated_time: formatTime(proto.updated_time),
          });
        }
        ret.data = { list };
        ret.total = queryCount;
      })
      .catch((err) => {
        ret.code = Ret.CodeInternalDBError,
        ret.mgs = Ret.MsgInternalDBError,
        console.error(err);
      });
    return ret;
  },
};

function checkCreateParam(params) {
  if (params.name === undefined || params.proto_type === undefined || !Array.isArray(params.category)) {
    return false;
  }
  return true;
}

function checkDeleteParam(params) {
  if (!Array.isArray(params.ids)) {
    return false;
  }
  return true;
}

function checkEditParam(params) {
  if (params.id === undefined || params.proto_type === undefined || params.name === undefined
    || params.desc === undefined || params.category === undefined) {
    return false;
  }
  return true;
}

module.exports = Protocol;
