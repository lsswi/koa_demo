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
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
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
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
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
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
    });
}

async function existMedia(mediaID) {
  const querySql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_MEDIA} WHERE id=:mediaID`;
  await DBClient.query(querySql, { replacements: { mediaID } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount === 0) {
        throw { ret: Ret.CODE_EXISTED, msg: `media_id: ${mediaID} does not exist` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
    });
}

async function existEvent(eventIDs) {

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
      return { ret: Ret.CODE_UNKNOWN, msg: Ret.MSG_UNKNOWN };
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

    const ids = params.ids.filter(Number.isFinite);
    const querySql = `UPDATE ${TableInfo.TABLE_MEDIA} SET is_deleted=1 WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids } })
      .then(() => {
        ret.data = { ids };
      })
      .catch((err) => {
        console.error(err);
        return { ret: Ret.CODE_INTERNAL_DB_ERROR, msg: Ret.MSG_INTERNAL_DB_ERROR };
      });

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
      await existMedia(params.media_id);
      await existEvent(params.event_ids);
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return Ret.UNKNOWN_RET;
    }
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

module.exports = Media;
