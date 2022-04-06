const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
const common = require('./common');

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
    const ret = Ret.OK_RET;
    if (!checkCreateParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id, name, field_type, path, field_key can not be null' };
    }

    try {
      await common.existProto(TableInfo.TABLE_PROTOCOL, params.proto_id);
      if (params.id) {
        await common.existData(TableInfo.TABLE_FIELD, params.id);
        await updateField(params);
      } else {
        // 先按协议+路径查重
        await checkFieldRepetition(params);
        const id = await createField(params);
        ret.data = { id };
      }
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return Ret.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 删除字段
   * @url /node-cgi/data-dict/field/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
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
      return Ret.INTERNAL_DB_ERROR_RET;
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
    const ret = Ret.OK_RET;
    if (!checkQueryParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id can not be null' };
    }

    const { total, verificationList } = await queryFields(params);
    const verificationObj = formVerificationObj(verificationList);
    console.log(verificationObj);
    const list = [];
    const isPush = new Map();
    for (const v of verificationList) {
      if (!isPush.has(v.field_id)) {
        list.push(verificationObj.get(v.field_id));
        isPush.set(v.field_id, true);
      }
    }
    ret.data = { list, total };

    return ret;
  },
};

function formVerificationObj(verificationList) {
  const verificationObj = new Map();
  for (const v of verificationList) {
    if (!verificationObj.has(v.field_id)) {
      const tmpObj = {
        id: v.field_id,
        field_key: v.field_key,
        name: v.name,
        desc: v.desc,
        field_type: v.field_type,
        path: v.path,
        remark: v.remark,
        operator: v.field_operator,
        updated_time: formatTime(v.field_time),
      };
      if (v.verification_id !== null) {
        tmpObj.verification_list = [{
          id: v.verification_id,
          rule_id: v.rule_id,
          value: v.verification_value,
          operator: v.verification_operator,
          updated_time: v.verification_time,
        }];
      }
      verificationObj.set(v.field_id, tmpObj);
    } else {
      verificationObj.get(v.field_id).verification_list.push({
        id: v.verification_id,
        rule_id: v.rule_id,
        value: v.verification_value,
        operator: v.verification_operator,
        updated_time: formatTime(v.verification_time),
      });
    }
  }
  return verificationObj;
}

async function queryFields(params) {
  // 设置参数默认值
  const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
  const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

  const replacements = { proto_id: params.proto_id };
  /**
   * SELECT t1.id, t1.field_key, t1.name, t1.desc, t1.field_type, t1.path, t1.remark, t1.operator, t1.updated_time as field_time, t2.rule_id,
   *  t2.operator as verification_operator, t2.updated_time as verification_time
   * FROM (SELECT * FROM data_dict_field WHERE is_deleted=0 AND proto_id=1 AND (id='joyyieli' OR name LIKE '%joyyieli%' OR operator='joyyieli') LIMIT 0, 10) t1
	 * LEFT JOIN data_dict_field_verification t2 ON t1.id=t2.field_id AND t2.is_deleted=0 ORDER BY t1.id;
   */
  let subQuerySql = `SELECT * FROM ${TableInfo.TABLE_FIELD} WHERE is_deleted=0 AND proto_id=:proto_id`;
  let countSql = `SELECT COUNT(*) FROM ${TableInfo.TABLE_FIELD} WHERE is_deleted=0 AND proto_id=:proto_id`;
  if (params.query !== undefined && params.query !== '') {
    subQuerySql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query)';
    countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query)';
    replacements.query = params.query;
    replacements.fuzzyQuery = `%${params.query}%`;
  }
  subQuerySql += ` LIMIT ${(page - 1) * size}, ${size}`;

  const querySql = `SELECT t1.id as field_id, t1.field_key, t1.name, t1.desc, t1.field_type, t1.path, t1.remark, t1.operator as field_operator, t1.updated_time as field_time,
      t2.id as verification_id, t2.verification_value, t2.rule_id, t2.operator as verification_operator, t2.updated_time as verification_time
    FROM (${subQuerySql}) t1
    LEFT JOIN ${TableInfo.TABLE_FIELD_VERIFICATION} t2 ON t1.id=t2.field_id AND t2.is_deleted=0
    ORDER BY t1.id`;

  let total = 0;
  let verificationList = [];
  await Promise.all([
    DBClient.query(querySql, { replacements }),
    DBClient.query(countSql, { replacements }),
  ])
    .then((promiseRes) => {
      const [[verifications], [[queryCount]]] = promiseRes;
      total = queryCount.cnt;
      verificationList = verifications;
      console.log(queryCount.cnt);
      // total = queryCount.cnt;
      for (const v of verifications) {
        console.log(v);
      }
    })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });

  return { total, verificationList };
}

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
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function createField(params) {
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
      throw Ret.INTERNAL_DB_ERROR_RET;
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
      throw Ret.INTERNAL_DB_ERROR_RET;
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
