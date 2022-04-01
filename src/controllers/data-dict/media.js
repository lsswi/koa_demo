const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
const common = require('./common');

async function createMedia(params) {
  let id = 0;
  const querySql = `INSERT INTO ${TableInfo.TABLE_MEDIA}(proto_id, original_id, name, \`desc\`, version, definition_val, md_key, remark, operator)
    VALUES(:proto_id, :original_id, :name, :desc, :version, :definition_val, MD5(:definition_val), :remark, :operator)`;
  await DBClient.query(querySql, {
    replacements: {
      proto_id: params.proto_id,
      original_id: params.original_id,
      name: params.name,
      desc: params.desc,
      version: params.version,
      definition_val: JSON.stringify(JSON.parse(params.definition_val)),
      remark: params.remark,
      // operator: ctx.session.user.loginname,
      operator: 'joyyieli',
    },
  })
    .then(([res]) => id = res)
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
  return id;
}

async function updateMedia(params) {
  const querySql = `UPDATE ${TableInfo.TABLE_MEDIA}
    SET proto_id=:proto_id,original_id=:original_id,name=:name,\`desc\`=:desc,version=:version,definition_val=:definition_val,
      md_key=MD5(:definition_val),remark=:remark, operator=:operator
      WHERE id=:id`;
  await DBClient.query(querySql, { replacements: {
    proto_id: params.proto_id,
    original_id: params.original_id,
    name: params.name,
    desc: params.desc,
    version: params.version,
    definition_val: params.definition_val,
    remark: params.remark,
    // operator: ctx.session.user.loginname,
    operator: 'joyyieli',
    id: params.id,
  } })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function checkMediaRepetition(params) {
  const defJsonFormat = JSON.stringify(JSON.parse(params.definition_val));
  const checkSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_MEDIA} WHERE md_key=MD5(:def_val)`;
  await DBClient.query(checkSql, { replacements: { def_val: defJsonFormat } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt > 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `event definition: ${defJsonFormat} has existed` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

async function existEvent(eventIDs) {
  const existID = new Map();
  const querySql = `SELECT id FROM ${TableInfo.TABLE_EVENT} WHERE id IN (:eventIDs)`;
  await DBClient.query(querySql, { replacements: { eventIDs } })
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
  console.log(existID);

  const unexsitedIDs = [];
  for (const id of eventIDs) {
    if (existID.get(id) === undefined) {
      unexsitedIDs.push(id);
    }
  }

  if (unexsitedIDs.length > 0) {
    throw { ret: Ret.CODE_NOT_EXISTED, msg: `event_id: ${unexsitedIDs} not exsited` };
  }
}

async function bindMediaEvent(params) {
  const insertValue = [];
  console.log(params.event_ids.filter(Number.isFinite));
  for (const id of params.event_ids.filter(Number.isFinite)) {
    insertValue.push(`(${params.media_id}, ${id})`);
  }
  console.log(insertValue);
  const querySql = `INSERT IGNORE INTO ${TableInfo.TABLE_REL_MEDIA_EVENT}(media_id, event_id) VALUES${insertValue.join(',')}`;
  if (insertValue.length > 0) {
    await DBClient.query(querySql)
      .catch((err) => {
        console.error(err);
        throw Ret.INTERNAL_DB_ERROR_RET;
      });
  }
}

const Media = {
  /**
   * 创建/编辑流量
   * @url /node-cgi/data-dict/media/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkCreateParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id, original_id, name, desc, version, definition_val, remark can not be null' };
    }

    try {
      await common.existProto(TableInfo.TABLE_MEDIA, params.proto_id);
      if (params.id) {
        await common.existData(TableInfo.TABLE_MEDIA, params.id);
        await updateMedia(params);
        ret.data = { id: params.id };
      } else {
        // original_id=0为创建初始版本，检测一下重复
        if (params.original_id === 0) {
          await checkMediaRepetition(params);
        } else {
          await common.existOriginal(TableInfo.TABLE_MEDIA, params.original_id);
        }
        const id = await createMedia(params);
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
   * 删除流量
   * @url /node-cgi/data-dict/media/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkDeleteParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, ids can not be null' };
    }

    try {
      await DBClient.transaction(async (transaction) => {
        // 删除数据源
        const ids = params.ids.filter(Number.isFinite);
        await DBClient.query(`UPDATE ${TableInfo.TABLE_MEDIA} SET is_deleted=1 WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 删除流量-规则绑定
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION} SET is_deleted=1 WHERE media_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 删除流量-事件绑定
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_MEDIA_EVENT} SET is_deleted=1 WHERE media_id IN (:ids)`, {
          replacements: { ids },
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
   * 查询流量
   * @url /node-cgi/data-dict/media/query
   */
  async query(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
  },

  /**
   * 创建流量与事件绑定
   * @url /node-cgi/data-dict/media/create-binding
   */
  async createBinding(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!(checkCreateBindingParams(params))) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, media_id, event_ids can not be null' };
    }

    try {
      await common.existData(TableInfo.TABLE_MEDIA, params.media_id);
      await existEvent(params.event_ids);
      await bindMediaEvent(params);
      ret.data = { ids: params.event_ids };
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return Ret.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 删除流量与事件绑定
   * @url /node-cgi/data-dict/media/delete-binding
   */
  async deleteBinding(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkQueryBindingParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, media_id, event_ids can not be null' };
    }

    const querySql = `UPDATE ${TableInfo.TABLE_REL_MEDIA_EVENT} SET is_deleted=1
      WHERE media_id=${params.media_id} AND event_id IN (${params.eventIDs.filter(Number.isFinite)})`;
    await DBClient.query(querySql)
      .then(() => {
        ret.data = { ids: params.ids };
      })
      .catch((err) => {
        console.error(err);
        return Ret.INTERNAL_DB_ERROR_RET;
      });
    return ret;
  },

  /**
   * 查询流量与事件绑定
   * @url /node-cgi/data-dict/media/query-binding
   */
  async queryBinding(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
  },
};


function checkCreateParams(params) {
  if (params.proto_id === undefined || params.original_id === undefined || params.name === undefined || params.desc === undefined
    || params.version === undefined || params.definition_val === undefined || params.remark === undefined) {
    return false;
  }
  return true;
}

function checkDeleteParams(params) {
  if (params.ids === undefined) {
    return false;
  }
  return true;
}

function checkCreateBindingParams(params) {
  if (params.media_id === undefined || params.event_ids === undefined) {
    return false;
  }
  return true;
}

function checkQueryBindingParams(params) {
  if (params.media_id === undefined || params.event_ids === undefined) {
    return false;
  }
  return true;
}

module.exports = Media;
