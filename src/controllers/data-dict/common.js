const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');

async function existProto(table, protoID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE id=:protoID`;
  await DBClient.query(querySql, { replacements: { table, protoID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_NOT_EXISTED, msg: `proto_id: ${protoID} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existOriginal(table, originalID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE id=:originalID`;
  await DBClient.query(querySql, { replacements: { table, originalID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_NOT_EXISTED, msg: `original_id: ${originalID} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existData(table, id) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE is_deleted=0 AND id=:id`;
  await DBClient.query(querySql, { replacements: { table, id } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_NOT_EXISTED, msg: `id: ${id} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existVerification(verificationIDs) {
  const existID = new Map();
  const querySql = `SELECT id FROM ${TableInfo.TABLE_FIELD_VERIFICATION} WHERE is_deleted=0 AND id IN (:verificationIDs)`;
  await DBClient.query(querySql, { replacements: { verificationIDs } })
    .then(([res]) => {
      for (const idObj of res) {
        existID.set(idObj.id, {});
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });

  const unexsitedIDs = [];
  for (const id of verificationIDs) {
    if (!existID.has(id)) {
      unexsitedIDs.push(id);
    }
  }

  if (unexsitedIDs.length > 0) {
    throw { ret: Ret.CODE_NOT_EXISTED, msg: `verification_id: ${unexsitedIDs} not exsited` };
  }
}

module.exports = {
  existProto,
  existOriginal,
  existData,
  existVerification,
};
