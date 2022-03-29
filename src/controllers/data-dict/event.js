const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');

const Event = {
  /**
   * 创建事件
   * @url /node-cgi/data-dict/event/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkCreateParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, proto_id, category_id, name, definition_val can not be null, rule_list should be int array';
      return ret;
    }

    // 先检查是否有重复的定义，只有original_id=0的时候才检查，original_id != 0 是原始数据的子版本，允许定义重复
    params.original_id = Object.prototype.hasOwnProperty.call(params, 'original_id') ? params.original_id : 0;
    console.log(params.definition_val);
    const defJsonFormat = JSON.stringify(JSON.parse(params.definition_val));
    if (params.original_id === 0) {
      const checkSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_EVENT} WHERE md_key=MD5(:def_val)`;
      await DBClient.query(checkSql, { replacements: { def_val: defJsonFormat } })
        .then((res) => {
          console.log(res);
          if (res[0][0].cnt > 0) {
            ret.code = Ret.CODE_EXISTED;
            ret.msg = `event definition: ${defJsonFormat} has existed`;
          }
        })
        .catch((err) => {
          console.error(err);
          ret.code = Ret.CODE_INTERNAL_DB_ERROR;
          ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
        });
      if (ret.code !== Ret.CODE_OK) {
        return ret;
      }
    }

    try {
      await DBClient.transaction(async (transaction) => {
        // 创建事件源数据
        const insertEventSql = `INSERT INTO ${TableInfo.TABLE_EVENT}
          (proto_id, category, original_id, name, \`desc\`, definition_val, md_key, reporting_timing, status, remark, operator)
          VALUES(:proto_id, :category, :original_id, :name, :desc, :definition_val, MD5(:definition_val), :reporting_timing, :status, :remark, :operator)`;
        const [eventID] = await DBClient.query(insertEventSql, {
          replacements: {
            proto_id: params.proto_id,
            category: params.category,
            original_id: params.original_id,
            name: params.name,
            desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
            definition_val: defJsonFormat,
            reporting_timing: Object.prototype.hasOwnProperty.call(params, 'reporting_timing') ? params.reporting_timing : '',
            status: Object.prototype.hasOwnProperty.call(params, 'status') ? params.status : 1,
            remark: Object.prototype.hasOwnProperty.call(params, 'remark') ? params.remark : '',
            operator: 'joyyieli',
          },
          transaction,
        });

        // 创建事件和字段规则的关联
        const insertValue = [];
        const insertRelSql = `INSERT INTO ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES`;
        for (const rule_id of params.rule_list.filter(Number.isFinite)) {
          insertValue.push(`(${eventID}, ${rule_id})`);
        }
        if (insertValue.length > 0) {
          await DBClient.query(insertRelSql + insertValue.join(','), { transaction });
        }
        ret.data = { id: eventID };
      });
    } catch (err) {
      console.error(err);
      ret.code = Ret.CODE_INTERNAL_DB_ERROR;
      ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
    }
    return ret;
  },

  /**
   * 删除事件
   * @url /node-cgi/data-dict/event/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: 0,
      msg: 'ok',
    };

    try {
      await DBClient.transaction(async (transaction) => {
        const ids = params.ids.filter(Number.isFinite);
        // 删除事件源数据
        await DBClient.query(`DELETE FROM ${TableInfo.TABLE_EVENT} WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 删除事件-规则关联数据
        await DBClient.query(`DELETE FROM ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} WHERE event_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
      });
    } catch (err) {
      console.log(err);
      ret.code = Ret.CODE_INTERNAL_DB_ERROR;
      ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
    }
    return ret;
  },

  /**
   * 编辑事件
   * @url /node-cgi/data-dict/event/edit
   */
  async edit(ctx) {
    // 先删除全部再新增
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkEditParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params errors, '
    };
  },

  /**
   * 查询事件
   * @url /node-cgi/data-dict/event/query
   */
  async query() {},
};

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.category === undefined || params.name === undefined || params.definition_val === undefined
    || params.rule_list === undefined || !Array.isArray(params.rule_list)) {
    return false;
  }
  return true;
}

function checkEditParams(params) {
  if (params.proto_id === undefined || params.category === undefined || params.original === undefined || params.name === undefined
    || params.desc === undefined || params.definition_val === undefined || params.reporting_timing === undefined || params.status === undefined
    || params.remark === undefined || params.rule_list === undefined || !Array.isArray(params.rule_list)) {
    return false;
  }
  return true;
}

module.exports = Event;
