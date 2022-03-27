const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');

const Field = {
  /**
   * 创建字段
   * @url /node-cgi/data-dict/field/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };
    if (!checkCreateParam(params)) {
      ret.code = Ret.CodeParamError;
      ret.msg = 'params error, proto_id, name, field_type, path, field_key can not be null';
      return ret;
    }
    initCreateParam(params);

    // 先按协议+路径查重
    const checkSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableField} WHERE proto_id=:proto_id AND path=:path`;
    await DBClient.query(checkSql, { replacements: { proto_id: params.proto_id, path: params.path } })
      .then((res) => {
        if (res[0][0].cnt > 0) {
          ret.code = Ret.CodeExisted,
          ret.msg = `field path ${params.path} has existed`;
        }
      })
      .catch((err) => {
        ret.code = Ret.CodeInternalDBError;
        ret.msg = Ret.MsgInternalDBError;
        console.error(err);
      });

    if (ret.code !== Ret.CodeOK) {
      return ret;
    }

    const querySql = `INSERT INTO ${TableInfo.TableField}(proto_id, field_key, name, \`desc\`, field_type, path, remark, operator)
      VALUES(:proto_id, :field_key, :name, :desc, :field_type, :path, :remark, :operator)`;
    await DBClient.query(querySql, {
      replacements: {
        proto_id: params.proto_id,
        field_key: params.field_key,
        name: params.name,
        desc: params.desc,
        field_type: params.field_type,
        path: params.path,
        remark: params.remark,
        // operator: ctx.session.user.loginname,
        operator: 'joyyieli',
      } })
      .then((res) => {
        ret.data = {
          id: res[0],
        };
      })
      .catch((err) => {
        ret.code = Ret.CodeInternalDBError;
        ret.msg = Ret.MsgInternalDBError;
        console.error(err);
      });

    return ret;
  },

  /**
   * 删除字段
   * @url /node-cgi/data-dict/field/delete
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
    const querySql = `DELETE FROM ${TableInfo.TableField} WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids: params.ids } })
      .then((res) => {
        console.log(res);
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
   * 编辑字段
   * @url /node-cgi/data-dict/field/edit
   */
  async edit(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };
    if (!checkEditParam(params)) {
      ret.code = Ret.codeParamError;
      ret.msg = 'params error, id, proto_id, field_key, name, desc, field_type, path, remark can not be null';
      return ret;
    }

    const querySql = `UPDATE ${TableInfo.TableField}
      SET proto_id=:proto_id, field_key=:field_key, name=:name, \`desc\`=:desc, field_type=:field_type, path=:path, remark=:remark
      WHERE id=:id`;
    await DBClient.query(querySql, {
      replacements: {
        proto_id: params.proto_id,
        field_key: params.field_key,
        name: params.name,
        desc: params.desc,
        field_type: params.field_type,
        path: params.path,
        remark: params.remark,
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
   * 查询字段
   * @url /node-cgi/data-dict/field/query
   */
  async query(ctx) {
    const params = ctx.query;
    const ret = {
      code: Ret.CodeOK,
      msg: Ret.MsgOK,
    };
    if (!checkQueryParam(params)) {
      ret.code = Ret.CodeParamError;
      ret.Msg = 'params error, proto_id can not be null';
      return ret;
    }
    initQueryParam(params);

    let querySql = `SELECT * FROM ${TableInfo.TableField} LIMIT :offset,:size`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableField}`;
    if (params.query !== '') {
      querySql = `SELECT * FROM ${TableInfo.TableField} WHERE id=:query OR name LIKE :name OR operator=:query LIMIT :offset,:size`;
      countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TableField} WHERE id=:query OR name LIKE :name OR operator=:query`;
    }
    const result = Promise.all([
      DBClient.query(querySql, { replacements: { query: params.query, name: `%${params.query}%`, offset: params.page - 1, size: params.size } }),
      DBClient.query(countSql, { replacements: { query: params.query, name: `%${params.query}%` } }),
    ]);
    await result
      .then((promiseRes) => {
        const queryResult = promiseRes[0][0];
        const queryCount = promiseRes[1][0][0].cnt;
        const list = [];
        for (const field of queryResult) {
          list.push({
            id: field.id,
            proto_id: field.proto_id,
            field_key: field.field_key,
            name: field.name,
            desc: field.desc,
            field_type: field.field_type,
            path: field.path,
            remark: field.remark,
            operator: field.operator,
            created_time: formatTime(field.created_time),
            updated_time: formatTime(field.updated_time),
          });
        }
        ret.data = { list };
        ret.total = queryCount;
      })
      .catch((err) => {
        console.error(err);
        ret.code = Ret.CodeInternalDBError;
        ret.msg = Ret.MsgInternalDBError;
      });
    return ret;
  },
};

function checkCreateParam(params) {
  if (params.proto_id === undefined || params.name === undefined || params.field_type === undefined
    || params.path === undefined || params.field_key === undefined) {
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
  if (params.id === undefined || params.proto_id === undefined || params.field_key === undefined || params.name === undefined
    || params.desc === undefined || params.field_type === undefined || params.path === undefined || params.remark === undefined) {
    return false;
  }
  return true;
}

function checkQueryParam(params) {
  if (params.proto_id === undefined) {
    return false;
  }
  return true;
}

// 可空字段没传初始化一下，否则insert的时候会报错
function initCreateParam(params) {
  if (params.desc === undefined) {
    params.desc = '';
  }
  if (params.remark === undefined) {
    params.remark = '';
  }
}

function initQueryParam(params) {
  if (params.page === undefined || params.page === 0) {
    params.page = 1;
  }
  if (params.size === undefined || params.size === 0) {
    params.size = 10;
  }
}

module.exports = Field;
