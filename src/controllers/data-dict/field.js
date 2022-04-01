const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');

const Field = {
  /**
   * TODO
   * 1. 查询加上is_deleted=0条件，改数据query返回的数据结构
   */

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
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id, name, field_type, path, field_key can not be null' };
    }

    try {
      if (params.id) {
        await updateField(params);
      } else {
        // 先按协议+路径查重
        await checkFieldRepetition(params);
        const id = await insertField(params);
        ret.data = { id };
      }
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return { ret: Ret.CODE_UNKNOWN, err: Ret.MSG_UNKNOWN };
    }
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
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, param ids must be an int array' };
    }

    try {
      await DBClient.transaction(async (transaction) => {
        const ids = params.ids.filter(Number.isFinite);
        // 删除字段数据源
        await DBClient.query(`UPDATE ${TableInfo.TABLE_FIELD} SET is_deleted=1 WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 查出所有关联的校验规则id
        const [idResult] = await DBClient.query(`SELECT id FROM ${TableInfo.TABLE_FIELD_VERIFICATION} WHERE field_id IN (:ids)`, {
          replacements: { ids },
        });
        const verificationIDList = [];
        for (const idObj of idResult) {
          verificationIDList.push(idObj.id);
        }

        // 删field_verification表
        await DBClient.query(`UPDATE ${TableInfo.TABLE_FIELD_VERIFICATION} SET is_deleted=1 WHERE field_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 删rel_media_field_verification表
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION} SET is_deleted=1 WHERE field_verification_id IN (:ids)`, {
          replacements: { ids: verificationIDList },
          transaction,
        });

        // 删rel_event_field_verification表
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} SET is_deleted=1 WHERE field_verification_id IN (:ids)`, {
          replacements: { ids: verificationIDList },
          transaction,
        });
      });
    } catch (err) {
      console.error(err);
      return { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
    }

    return ret;
  },

  /**
   * 查询字段
   * @url /node-cgi/data-dict/field/query
   */
  async query(ctx) {
    const params = ctx.query;
    console.log(params.query);
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkQueryParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id can not be null' };
    }
    // 设置参数默认值
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.page : 10;

    let result = [];
    let querySql = `SELECT * FROM ${TableInfo.TABLE_FIELD} WHERE proto_id=:proto_id LIMIT :offset,:size`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE proto_id=:proto_id`;
    if (params.query !== '' && params.query !== undefined) {
      querySql = `SELECT * FROM ${TableInfo.TABLE_FIELD} WHERE is_deleted=0 AND proto_id=:proto_id AND (id=:query OR name LIKE :name OR operator=:query) LIMIT :offset,:size`;
      countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE is_deleted=0 AND proto_id=:proto_id AND (id=:query OR name LIKE :name OR operator=:query)`;
      result = Promise.all([
        DBClient.query(querySql, { replacements: { proto_id: params.proto_id, query: params.query, name: `%${params.query}%`, offset: page - 1, size } }),
        DBClient.query(countSql, { replacements: { proto_id: params.proto_id, query: params.query, name: `%${params.query}%` } }),
      ]);
    } else {
      result = Promise.all([
        DBClient.query(querySql, { replacements: { proto_id: params.proto_id, offset: page - 1, size } }),
        DBClient.query(countSql, { replacements: { proto_id: params.proto_id, query: params.query } }),
      ]);
    }
    await result
      .then((promiseRes) => {
        const [[queryResult], [[queryCount]]] = promiseRes;
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
        ret.total = queryCount.cnt;
      })
      .catch((err) => {
        console.error(err);
        return { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
      });
    return ret;
  },
};

async function checkFieldRepetition(params) {
  // 先按协议+路径查重
  const checkSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE proto_id=:proto_id AND path=:path`;
  await DBClient.query(checkSql, { replacements: { proto_id: params.proto_id, path: params.path } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt > 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `field path ${params.path} has existed` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.log(err);
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
    });
}

async function insertField(params) {
  let id = 0;
  const querySql = `INSERT INTO ${TableInfo.TABLE_FIELD}(proto_id, field_key, name, \`desc\`, field_type, path, remark, operator)
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
    .then(([res]) => {
      id = res;
    }).catch((err) => {
      console.error(err);
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
    });
  return id;
}

async function updateField(params) {
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
    .catch((err) => {
      console.log(err);
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
    });
}

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.field_key === undefined || params.name === undefined || params.desc === undefined
    || params.field_type === undefined || params.path === undefined || params.remark === undefined) {
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

function checkQueryParams(params) {
  if (params.proto_id === undefined) {
    return false;
  }
  return true;
}

module.exports = Field;
