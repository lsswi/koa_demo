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
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkCreateParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, proto_id, name, field_type, path, field_key can not be null';
      return ret;
    }

    // 先按协议+路径查重
    const checkSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE proto_id=:proto_id AND path=:path`;
    await DBClient.query(checkSql, { replacements: { proto_id: params.proto_id, path: params.path } })
      .then((res) => {
        if (res[0][0].cnt > 0) {
          ret.code = Ret.CODE_EXISTED,
          ret.msg = `field path ${params.path} has existed`;
        }
      })
      .catch((err) => {
        ret.code = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
        console.error(err);
      });

    if (ret.code !== Ret.CODE_OK) {
      return ret;
    }

    const querySql = `INSERT INTO ${TableInfo.TABLE_FIELD}(proto_id, field_key, name, \`desc\`, field_type, path, remark, operator)
      VALUES(:proto_id, :field_key, :name, :desc, :field_type, :path, :remark, :operator)`;
    await DBClient.query(querySql, {
      replacements: {
        proto_id: params.proto_id,
        field_key: params.field_key,
        name: params.name,
        desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
        field_type: params.field_type,
        path: params.path,
        remark: Object.prototype.hasOwnProperty.call(params, 'remark') ? params.remark : '',
        // operator: ctx.session.user.loginname,
        operator: 'joyyieli',
      } })
      .then((res) => {
        ret.data = {
          id: res[0],
        };
      })
      .catch((err) => {
        ret.code = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
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
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkDeleteParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, param ids must be an int array';
      return ret;
    }

    const ids = params.ids.filter(Number.isFinite);
    const querySql = `DELETE FROM ${TableInfo.TABLE_FIELD} WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids } })
      .then((res) => {
        console.log(res);
        ret.data = { ids };
      })
      .catch((err) => {
        console.error(err);
        ret.code = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
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
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkEditParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, id, proto_id, field_key, name, desc, field_type, path, remark can not be null';
      return ret;
    }

    const querySql = `UPDATE ${TableInfo.TABLE_FIELD}
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
        ret.code = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
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
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkQueryParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, proto_id can not be null';
      return ret;
    }
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.page : 10;

    let querySql = `SELECT * FROM ${TableInfo.TABLE_FIELD} LIMIT :offset,:size`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD}`;
    if (params.query !== '') {
      querySql = `SELECT * FROM ${TableInfo.TABLE_FIELD} WHERE id=:query OR name LIKE :name OR operator=:query LIMIT :offset,:size`;
      countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE id=:query OR name LIKE :name OR operator=:query`;
    }
    const result = Promise.all([
      DBClient.query(querySql, { replacements: { query: params.query, name: `%${params.query}%`, offset: page - 1, size } }),
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
        ret.code = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      });
    return ret;
  },
};

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.name === undefined || params.field_type === undefined
    || params.path === undefined || params.field_key === undefined) {
    return false;
  }
  return true;
}

function checkDeleteParams(params) {
  if (!Array.isArray(params.ids)) {
    return false;
  }
  return true;
}

function checkEditParams(params) {
  if (params.id === undefined || params.proto_id === undefined || params.field_key === undefined || params.name === undefined
    || params.desc === undefined || params.field_type === undefined || params.path === undefined || params.remark === undefined) {
    return false;
  }
  return true;
}

function checkQueryParams(params) {
  if (params.proto_id === undefined) {
    return false;
  }
  return true;
}

module.exports = Field;
