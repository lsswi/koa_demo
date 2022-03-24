const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { DateLib: { formatTime } } = require('../../utils/date');

const TableInfo = {
  TableProtocol: 'data_dict_protocol',
};
const RetCode = {
  OK: 0,
  ParamError: 40001,
  InternalDBError: 50000,
};
const RetMsg = {
  OK: 'ok',
  InternalDBError: 'internal db error',
};

const Protocol = {
  /**
   * 创建协议
   * @url /node-cgi/data-dict/event/create
   */
  async Create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: RetCode.OK,
      msg: RetMsg.OK,
    };
    if (!checkCreateParam(params)) {
      ret.code = RetCode.ParamError;
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
        desc: params.desc,
        // operator: ctx.session.user.loginname,
        operator: 'joyyieli',
      },
    }).then((res) => {
      ret.data = {
        id: res[0],
      };
    }).catch((err) => {
      console.log(err);
      ret.code = RetCode.InternalDBError;
      ret.msg = RetMsg.InternalDBError;
    });

    return ret;
  },

  /**
   * 删除协议
   * @url /node-cgi/data-dict/event/delete
   */
  async Delete(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: RetCode.OK,
      msg: RetMsg.OK,
    };
    if (!checkDeleteParam(params)) {
      ret.code = RetCode.ParamError;
      ret.msg = 'params error, param ids must be an int array';
      return ret;
    }
    const querySql = `DELETE FROM ${TableInfo.TableProtocol} WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids: params.ids } }).then(() => {
      ret.data = {
        ids: params.ids,
      };
    }).catch((err) => {
      console.log(err);
      ret.code = RetCode.InternalDBError;
      ret.msg = RetMsg.InternalDBError;
    });
    return ret;
  },

  /**
   * 编辑协议
   * @url /node-cgi/data-dict/event/edit
   */
  async Edit(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: RetCode.OK,
      msg: RetMsg.OK,
    };
    if (!checkEditParam(params)) {
      ret.code = RetCode.ParamedError;
      ret.msg = 'params error, param id, proto_type, name, desc, category can not be null';
      return ret;
    }
    const querySql = `UPDATE ${TableInfo.TableProtocol} SET
    name=:name,proto_type=:proto_type,category=:category,\`desc\`=:desc,operator=:operator WHERE id=:id`;
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
    }).then(() => {
      ret.data = {
        id: params.id,
      };
    }).catch((err) => {
      console.log(err);
      ret.code = RetCode.InternalDBError;
      ret.msg = RetMsg.InternalDBError;
    });
    return ret;
  },

  /**
   * 查询协议
   * @url /node-cgi/data-dict/event/query
   */
  async Query(ctx) {
    const ret = {
      code: RetCode.OK,
      msg: RetMsg.OK,
    };
    const params = ctx.query;
    initQueryParam(params);
    let querySql = `SELECT * FROM ${TableInfo.TableProtocol} LIMIT :offset,:size`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableProtocol}`;
    if (params.query !== '') {
      querySql = `SELECT * FROM ${TableInfo.TableProtocol} WHERE id=:query OR name LIKE :name OR operator=:query LIMIT :offset,:size`;
      countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableProtocol} WHERE id=:query OR name LIKE :name OR operator=:query`;
    }
    const result = Promise.all([
      DBClient.query(querySql, { replacements: { query: params.query, name: `%${params.query}%`, offset: params.page - 1, size: params.size } }),
      DBClient.query(countSql, { replacements: { query: params.query, name: `%${params.query}%` } }),
    ]);
    await result.then((values) => {
      const queryResult = values[0][0];
      const queryCount = values[1][0][0].cnt;
      const list = [];
      for (const proto of queryResult) {
        list.push({
          id: proto.id,
          name: proto.name,
          desc: proto.desc,
          operator: proto.operator,
          category: proto.category.split(','),
          updated_time: formatTime(proto.updated_time),
        });
      }
      ret.data = { list };
      ret.total = queryCount;
    }).catch((err) => {
      ret.code = RetCode.InternalDBError,
      ret.mgs = RetMsg.InternalDBError,
      console.log(err);
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

function initQueryParam(params) {
  if (params.page === undefined || params.page === 0) {
    params.page = 1;
  }
  if (params.size === undefined || params.size === 0) {
    params.size = 10;
  }
}

module.exports = Protocol;
