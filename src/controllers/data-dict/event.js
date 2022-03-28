const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
// const { Sequelize } = require('sequelize');

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

    const t = await DBClient.transaction();
    try {
      let event_id = 0;
      // 创建事件源数据
      const insertEventSql = `INSERT INTO ${TableInfo.TABLE_EVENT}(proto_id, category_id, original_id, name, \`desc\`, definition_val, report_timing, status, remark, rule_list)
        VALUES(:proto_id, :category_id, :original_id, :name, :desc, :definition_val, :report_timing, :status, :remark, :rule_list)`;
      await DBClient.query(insertEventSql, {
        replacements: {
          proto_id: params.proto_id,
          category_id: params.category_id,
          original_id: Object.prototype.hasOwnProperty.call(params, 'original_id') ? params.original_id : 0,
          name: params.name,
          desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
          definition_val: params.definition_val,
          report_timing: Object.prototype.hasOwnProperty.call(params, 'report_timing') ? params.report_timing : '',
          status: Object.prototype.hasownProperty.call(params, 'status') ? params.status : 1,
          remark: Object.prototype.hasOwnProperty.call(params, 'remark') ? params.remark : '',
          rule_list: params.rule_list.join(','),
        },
        transaction: { t },
      })
        .then((res) => {
          [event_id] = res;
        });

      // 创建事件和字段规则的关联
      const insertValue = [];
      let insertRelSql = `INSERT INTO ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES`;
      // INSERT INTO data_dict_event_field_verification(event_id, field_verification_id) VALUES(),()
      for (const rule_id of params.rule_list) {
        if (!Number.isFinite(rule_id)) {
          continue;
        }
        insertValue.push(`(${event_id}, ${rule_id})`);
      }
      if (insertValue.length > 0) {
        insertRelSql += insertValue.join(',');
        await DBClient.query(insertRelSql, { transaction: { t } });
      }
      await t.commit();
      ret.data = {
        id: event_id,
      };
    } catch (err) {
      console.error(err);
      ret.code = Ret.CODE_INTERNAL_DB_ERROR;
      ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
      await t.rollback();
    }
    return ret;
  },

  /**
   * 删除事件
   * @url /node-cgi/data-dict/event/delete
   */
  async delete(ctx) {
    const ret = {
      code: 0,
      msg: 'ok',
    };

    // 事务demo
    try {
      await DBClient.transaction(async (transaction) => {
        const res = await DBClient.query(
          'INSERT INTO data_dict_rel_event_field_verification(event_id, field_verification_id) VALUES(100, 100)',
          { transaction },
        );

        console.log('hahahahahahahahahah');
        console.log(res);

        const rt = await DBClient.query(
          'INSERT INTO data_dict_rel_event_field_verification(event_id, field_verification_id) VALUES(11, 12)',
          { transaction },
        );

        console.log('hhhhhhhhhhhhhhhhh');
        console.log(rt);
      });
    } catch (e) {
      console.log('---------------------');
      // console.log(e);
    }

    return ret;
  },

  /**
   * 编辑事件
   * @url /node-cgi/data-dict/event/edit
   */
  edit() {},

  /**
   * 查询事件
   * @url /node-cgi/data-dict/event/query
   */
  query() {},
};

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.category_id === undefined || params.name === undefined || params.definition_val === undefined
    || params.rule_list === undefined || !Array.isArray(params.rule_list)) {
    return false;
  }
  return true;
}

module.exports = Event;
