const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { RET, TABLE_INFO } = require('./const');
const moment = require('moment');

const STR_FORMAT = {
  PARAM_ERROR: '参数错误, 缺少参数 ',
};

// 校验必要参数
function checkRequiredParams(params, paramList) {
  const lackField = [];
  for (const k of paramList) {
    if (params[k] === undefined) {
      lackField.push(k);
    }
  }
  if (lackField.length > 0) {
    return `${STR_FORMAT.PARAM_ERROR}${lackField.join(', ')}`;
  }
  return '';
}

// 校验协议是否存在
async function existProto(table, protoID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE id=:protoID`;
  await DBClient.query(querySql, { replacements: { protoID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: RET.CODE_NOT_EXISTED, msg: `proto_id: ${protoID} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
}

// 校验父数据是否存在
async function existOriginal(table, originalID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE id=:originalID`;
  await DBClient.query(querySql, { replacements: { originalID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: RET.CODE_NOT_EXISTED, msg: `original_id: ${originalID} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
}

// 校验数据是否存在
async function existData(table, id) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE is_deleted=0 AND id=:id`;
  await DBClient.query(querySql, { replacements: { id } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: RET.CODE_NOT_EXISTED, msg: `id: ${id} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
}

// 校验字段规则是否存在
async function existVerification(verificationIDs) {
  const existID = new Map();
  const querySql = `SELECT id FROM ${TABLE_INFO.TABLE_FIELD_VERIFICATION} WHERE is_deleted=0 AND id IN (:verificationIDs)`;
  await DBClient.query(querySql, { replacements: { verificationIDs } })
    .then(([res]) => {
      for (const idObj of res) {
        existID.set(idObj.id, {});
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });

  const unexsitedIDs = [];
  for (const id of verificationIDs) {
    if (!existID.has(id)) {
      unexsitedIDs.push(id);
    }
  }

  if (unexsitedIDs.length > 0) {
    throw { ret: RET.CODE_NOT_EXISTED, msg: `verification_id: ${unexsitedIDs} not exsited` };
  }
}

// 构造校验引擎ruleID鹰眼查询链接
function formHawkRuleIDQueryUrl(ruleID) {
  const date = moment().subtract(1, 'days').startOf('day').format('YYYY-MM-DD');
  return encodeURI(`https://new.jiqimao.woa.com/?date=${date}&adv_search_query=
  [{"field":"matcher_result","key_name":"field_match_result","condition":"1","value_type":"2","value":"${ruleID}"}]#/tool/hawkeye-v2/query`);
}

function sortConflictRate(arr, tmpObj) {
  let ret = arr;
  if (ret.length === 0) {
    ret.push(tmpObj);
    return ret;
  }
  for (let i = 0; i < ret.length; i++) {
    if (i + 1 === ret.length) {
      if (tmpObj.rate < ret[i].rate) {
        ret = [...ret, tmpObj];
      } else {
        ret = [...ret.slice(0, i), tmpObj, ret[ret.length - 1]];
      }
      return ret;
    }
    if (tmpObj.rate > ret[i].rate) {
      ret = [...ret.slice(0, i), tmpObj, ...ret.slice(i, ret.length)];
      return ret;
    }
    if (tmpObj.rate <= ret[i].rate && tmpObj.rate >= ret[i + 1].rate) {
      ret = [...ret.slice(0, i + 1), tmpObj, ...ret.slice(i + 1, ret.length)];
      return ret;
    }
  }
}

module.exports = {
  checkRequiredParams,
  existProto,
  existOriginal,
  existData,
  existVerification,
  formHawkRuleIDQueryUrl,
  sortConflictRate,
};
