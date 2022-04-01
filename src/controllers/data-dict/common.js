const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret } = require('./const');

async function existProto(table, protoID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE proto_id=:protoID`;
  await DBClient.query(querySql, { replacements: { table, protoID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `proto_id: ${protoID} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existOriginal(table, originalID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE original_id=:originalID`;
  await DBClient.query(querySql, { replacements: { table, originalID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `original_id: ${originalID} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existData(table, id) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${table} WHERE id=:id`;
  await DBClient.query(querySql, { replacements: { table, id } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt === 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `id: ${id} is not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

module.exports = {
  existProto,
  existOriginal,
  existData,
};
