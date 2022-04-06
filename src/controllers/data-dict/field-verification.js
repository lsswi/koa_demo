const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const common = require('./common');

const FieldVerification = {
  /**
   * 创建规则
   * @url /node-cgi/data-dict/field-verification/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    if (!checkCreateParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, field_id, rule_id, verification_value can not be null' };
    }

    try {
      await existField(params.field_id);
      // 传了id，update
      if (params.id) {
        await common.existData(TableInfo.TABLE_FIELD_VERIFICATION, params.id);
        // await updateVerification(ctx.session.user.loginname, params);
        await updateVerification('joyyieli', params);
        ret.data = { id: params.id };
      } else {
        await existVerificationRepetition(params);
        // const id = await createVerification(ctx.session.user.loginname, params);
        const id = await createVerification('joyyieli', params);
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
   * 删除规则
   * @url /node-cgi/data-dict/field-verification/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    if (!checkDeleteParams(params)) {
      ret.ret = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, ids can not be null and should be an int array';
      return ret;
    }

    try {
      const ids = params.ids.filter(Number.isFinite);
      await DBClient.transaction(async (transaction) => {
        // 删除规则源数据
        await DBClient.query(`UPDATE ${TableInfo.TABLE_FIELD_VERIFICATION} SET is_deleted=1 WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction });

        // 删除规则流量关联
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION} SET is_deleted=1 WHERE field_verification_id IN (:ids)`, {
          replacements: { ids },
          transaction });

        // 删除规则事件关联
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} SET is_deleted=1 WHERE field_verification_id IN (:ids)`, {
          replacements: { ids },
          transaction });
      });
      ret.data = { ids };
    } catch (err) {
      console.error(err);
      return Ret.INTERNAL_DB_ERROR_RET;
    }
    return ret;
  },
};

async function existField(fieldID) {
// 校验字段是否存在
  const checkFieldSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE id=:id`;
  await DBClient.query(checkFieldSql, { replacements: { id: fieldID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_NOT_EXISTED, msg: `field_id ${fieldID} not existed` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.log(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existVerificationRepetition(params) {
  // 校验字段规则是否存在
  const checkRuleSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD_VERIFICATION} WHERE field_id=:field_id AND rule_id=:rule_id AND verification_value=:verification_value`;
  await DBClient.query(checkRuleSql, { replacements: {
    field_id: params.field_id,
    rule_id: params.rule_id,
    verification_value: params.verification_value,
  },
  })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt > 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `field_id ${params.field_id} has existed rule_id ${params.rule_id} and value: ${params.verification_value}` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function createVerification(operator, params) {
  let id = 0;
  const insertSql = `INSERT INTO ${TableInfo.TABLE_FIELD_VERIFICATION}(field_id, rule_id, verification_value, operator)
    VALUES(:field_id, :rule_id, :verification_value, :operator)`;
  await DBClient.query(insertSql, {
    replacements: {
      operator,
      field_id: params.field_id,
      rule_id: params.rule_id,
      verification_value: params.verification_value,
    },
  })
    .then(([res]) => id = res)
    .catch((err) => {
      console.log(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
  return id;
}

async function updateVerification(operator, params) {
  const querySql = `UPDATE ${TableInfo.TABLE_FIELD_VERIFICATION}
    SET rule_id=:rule_id, field_id=:field_id, verification_value=:verification_value, operator=:operator
    WHERE id=:id`;
  await DBClient.query(querySql, {
    replacements: {
      operator,
      rule_id: params.rule_id,
      field_id: params.field_id,
      verification_value: params.verification_value,
      id: params.id,
    },
  })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

function checkCreateParams(params) {
  if (params.field_id === undefined || params.rule_id === undefined || params.verification_value === undefined) {
    return false;
  }
  return true;
}

function checkDeleteParams(params) {
  if (params.ids === undefined || Array.isArray(params.id)) {
    return false;
  }
  return true;
}

module.exports = FieldVerification;
