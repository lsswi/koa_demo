const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');

const FieldVerification = {
  /**
   * TODO
   * 1. 合并创建和编辑
   * 2. 删除字段接口要额外删除rel表里的关系
   * 3. 删除软删
   */

  /**
   * 创建规则
   * @url /node-cgi/data-dict/field-verification/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkCreateParams(params)) {
      ret.ret = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, field_id, rule_id can not be null';
      return ret;
    }

    // 校验字段是否存在
    const checkFieldSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD} WHERE id=:id`;
    await DBClient.query(checkFieldSql, { replacements: { id: params.field_id } })
      .then((res) => {
        if (res[0][0].cnt === 0) {
          ret.ret = Ret.CODE_NOT_EXISTED;
          ret.msg = `field_id ${params.field_id} not existed`;
        }
      })
      .catch((err) => {
        console.error(err);
        ret.ret = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      });
    if (ret.ret !== Ret.CODE_OK) {
      return ret;
    }

    // 校验字段规则是否存在
    const checkRuleSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_FIELD_VERIFICATION} WHERE field_id=:field_id AND rule_id=:rule_id`;
    await DBClient.query(checkRuleSql, { replacements: { field_id: params.field_id, rule_id: params.rule_id } })
      .then((res) => {
        if (res[0][0].cnt > 0) {
          ret.ret = Ret.CODE_EXISTED;
          ret.msg = `field_id ${params.field_id} has existed rule_id ${params.rule_id}`;
        }
      })
      .catch((err) => {
        console.error(err);
        ret.ret = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      });
    if (ret.ret !== Ret.CODE_OK) {
      return ret;
    }

    const insertSql = `INSERT INTO ${TableInfo.TABLE_FIELD_VERIFICATION}(field_id, rule_id, verification_value)
      VALUES(:field_id, :rule_id, :verification_value)`;
    await DBClient.query(insertSql, {
      replacements: {
        field_id: params.field_id,
        rule_id: params.rule_id,
        verification_value: Object.prototype.hasOwnProperty.call(params, 'verification_value') ? params.verification_value : '',
      },
    })
      .then((res) => {
        ret.data = {
          id: res[0],
        };
      })
      .catch((err) => {
        console.error(err);
        ret.ret = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      });
    return ret;
  },

  /**
   * 删除规则
   * @url /node-cgi/data-dict/field-verification/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkDeleteParams(params)) {
      ret.ret = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, ids can not be null and should be an int array';
      return ret;
    }

    const ids = params.ids.filter(Number.isFinite);
    const querySql = `DELETE FROM ${TableInfo.TABLE_FIELD_VERIFICATION} WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids } })
      .then((res) => {
        console.log(res);
        ret.data = { ids };
      })
      .catch((err) => {
        console.error(err);
        ret.ret = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      });
    return ret;
  },

  /**
   * 编辑规则
   * @url /node-cgi/data-dict/field-verification/edit
   */
  async edit(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkEditParams(params)) {
      ret.ret = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, verification_id, field_id, rule_id, verification_value can not be null';
      return ret;
    }

    const querySql = `UPDATE ${TableInfo.TABLE_FIELD_VERIFICATION}
      SET rule_id=:rule_id, field_id=:field_id, verification_value=:verification_value
      WHERE id=:id`;
    await DBClient.query(querySql, {
      replacements: {
        rule_id: params.rule_id,
        field_id: params.field_id,
        verification_value: params.verification_value,
        id: params.verification_id,
      },
    })
      .then((res) => {
        console.log(res);
        ret.data = { id: params.verification_id };
      })
      .catch((err) => {
        console.error(err);
        ret.ret = Ret.CODE_INTERNAL_DB_ERROR;
        ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      });
    return ret;
  },
};

function checkCreateParams(params) {
  if (params.field_id === undefined || params.rule_id === undefined) {
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

function checkEditParams(params) {
  if (params.verification_id === undefined || params.field_id === undefined || params.rule_id === undefined || params.verification_value === undefined) {
    return false;
  }
  return true;
}

module.exports = FieldVerification;
