const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');

const Event = {
  /**
   * TODO
   * 1. 合并创建和编辑接口
   * 2. 删除软删
   */

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
      ret.msg = 'params errors, proto_id, category, original_id, name, desc, definition_val, reporting_timing, status, remark, rule_list can not be null';
      return ret;
    }

    try {
      await DBClient.transaction(async (transaction) => {
        // 更新事件源数据
        const defJsonFormat = JSON.stringify(JSON.parse(params.definition_val));
        const updateSql = `UPDATE ${TableInfo.TABLE_EVENT}
          SET proto_id=:proto_id, category=:category, original_id=:original_id, name=:name, \`desc\`=:desc, definition_val=:definition_val, md_key=MD5(:definition_val),
          reporting_timing=:reporting_timing, status=:status, remark=:remark, operator=:operator
          WHERE id=:id`;
        await DBClient.query(updateSql, {
          replacements: {
            proto_id: params.proto_id,
            category: params.category,
            original_id: params.original_id,
            name: params.name,
            desc: params.desc,
            definition_val: defJsonFormat,
            reporting_timing: params.reporting_timing,
            status: params.status,
            remark: params.remark,
            operator: 'joyyieli',
            id: params.id,
          },
        });

        // 删除事件-字段校验规则关联
        const deleteSql = `DELETE FROM ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} WHERE event_id=:id`;
        await DBClient.query(deleteSql, {
          replacements: { id: params.id },
          transaction,
        });

        // 新建事件-字段校验规则关联
        const insertValue = [];
        const insertRelSql = `INSERT INTO ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES`;
        for (const rule_id of params.rule_list.filter(Number.isFinite)) {
          insertValue.push(`(${params.id}, ${rule_id})`);
        }
        if (insertValue.length > 0) {
          await DBClient.query(insertRelSql + insertValue.join(','), { transaction });
        }
      });
    } catch (err) {
      console.error(err);
      ret.code = Ret.CODE_INTERNAL_DB_ERROR;
      ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
    }

    return ret;
  },

  /**
   * 查询事件
   * @url /node-cgi/data-dict/event/query
   */
  async query(ctx) {
    const params = ctx.query;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkQueryParams(params)) {
      ret.code = Ret.CODE_PARAM_ERROR;
      ret.msg = 'params error, proto_id can not be null';
      return ret;
    }

    // 设置参数默认值
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

    // 查询替换参数
    const replacements = { proto_id: params.proto_id };
    /**
     * SELECT * FROM data_dict_event
     *    WHERE original_id=0 AND proto_id=1 AND category=0 AND (id=6 OR name LIKE '%6%' OR operator='6' OR definition_val LIKE '%6%')
     */
    let mainQuerySql = `SELECT * FROM ${TableInfo.TABLE_EVENT} WHERE is_deleted=0 AND original_id=0 AND proto_id=:proto_id`;
    /**
     * SELECT COUNT(*) as cnt FROM data_dict_event
     *    WHERE original_id=0 AND proto_id=1 AND category=0 AND (id=6 OR name LIKE '%6%' OR operator='6' OR definition_val LIKE '%6%')
     */
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_EVENT} WHERE is_deleted=0 AND original_id=0 AND proto_id=:proto_id`;
    if (params.category !== undefined) {
      mainQuerySql += ' AND category=:category';
      countSql += ' AND category=:category';
      replacements.category = params.category;
    }
    if (params.query !== undefined && params.query !== '') {
      mainQuerySql += ` AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query OR definition_val LIKE :fuzzyQuery) LIMIT ${(page - 1) * size}, ${size}`;
      countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query OR definition_val LIKE :fuzzyQuery)';
      replacements.query = params.query;
      replacements.fuzzyQuery = `%${params.query}%`;
    }

    let total = 0;
    // 所有的event_id，main和sub的event_id集合
    const allEID = [];
    // main的event_id列表，用来查询所有sub的event_id
    const mainEIDList = [];
    // event_id -> event信息的映射
    const eventInfo = new Map();
    await Promise.all([
      DBClient.query(mainQuerySql, { replacements }),
      DBClient.query(countSql, { replacements }),
    ]).then((promiseRes) => {
      const [[mainEvents], [[queryCount]]] = promiseRes;
      total = queryCount.cnt;
      for (const mainE of mainEvents) {
        mainEIDList.push(mainE.id);
        allEID.push(mainE.id);
        eventInfo.set(mainE.id, mainE);
      }
    }).catch((err) => {
      console.error(err);
      ret.code = Ret.CODE_INTERNAL_DB_ERROR;
      ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
    });

    if (ret.code !== Ret.CODE_OK) {
      return ret;
    }

    /**
     * 查所有主event的所有子event
     * SELECT * FORM event WHERE is_deleted=0 AND original_id IN (1, 2, 3);
     */
    const subQuerySql = `SELECT * FROM ${TableInfo.TABLE_EVENT} WHERE original_id IN (:ids)`;
    const mainSubIDs = new Map();
    await DBClient.query(subQuerySql, { replacements: { ids: mainEIDList } })
      .then((res) => {
        const [subEvents] = res;
        for (const subE of subEvents) {
          allEID.push(subE.id);
          eventInfo.set(subE.id, subE);
          if (mainSubIDs.get(subE.original_id) === undefined) {
            mainSubIDs.set(subE.original_id, [subE.id]);
          } else {
            mainSubIDs.get(subE.original_id).push(subE.id);
          }
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

    /**
     * 关联查字段信息
     * SELECT t1.event_id, t1.field_verification_id, t2.rule_id, t3.name
     *    FROM (SELECT * FROM rel_event_field_verification WHERE is_deleted=0 AND event_id IN (1,2,3)) t1
     *    LEFT JOIN field_verification t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
     *    LEFT JOIN field t3 ON t2.field_id=t3.id AND t3.is_deleted=0
     */
    const fieldQuerySql = `SELECT t1.event_id, t1.field_verification_id, t2.rule_id, t2.verification_value, t3.name
      FROM (SELECT * FROM ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} WHERE is_deleted=0 AND event_id IN (${allEID})) t1
      LEFT JOIN ${TableInfo.TABLE_FIELD_VERIFICATION} t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
      LEFT JOIN ${TableInfo.TABLE_FIELD} t3 ON t2.field_id=t3.id AND t3.is_deleted=0`;

    // 构造每个返回的event数据
    const eventObj = new Map();
    await DBClient.query(fieldQuerySql)
      .then(([rules]) => {
        for (const rule of rules) {
          // rule_id为空说明verification信息被删除，name为空说明field信息被删除，一般不会有这种情况，删除的时候都处理了
          if (rule.rule_id !== null && rule.name !== null) {
            // eid没有基础数据，构造基础数据；有基础数据说明是校验规则，push到field_list里面
            if (eventObj.get(rule.event_id) === undefined) {
              const event = eventInfo.get(rule.event_id);
              const tmpObj = {
                id: rule.event_id,
                desc: event.desc,
                remark: event.remark,
                operator: event.operator,
                updated_time: formatTime(event.updated_time),
                field_list: [{
                  verification_id: rule.field_verification_id,
                  field_name: rule.name,
                  rule_id: rule.rule_id,
                  value: rule.verification_value,
                }],
              };
              // 主信息需要所有基础信息，子数据只需要一些跟主数据不同的信息，重复的信息前端复用主信息展示即可
              if (mainSubIDs.get(rule.event_id) !== undefined) {
                tmpObj.category = event.category;
                tmpObj.name =  event.name;
                tmpObj.definition_val = JSON.stringify(event.definition_val);
                tmpObj.reporting_timing = event.reporting_timing;
              }
              eventObj.set(rule.event_id, tmpObj);
            } else {
              eventObj.get(rule.event_id).field_list.push({
                verification_id: rule.field_verification_id,
                field_name: rule.name,
                rule_id: rule.rule_id,
                value: rule.verification_value,
              });
            }
          }
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

    // 没有规则的，设置一下基础信息
    for (const id of allEID) {
      if (eventObj.get(id) === undefined) {
        const event = eventInfo.get(id);
        eventObj.set(id, {
          id,
          category: event.category,
          name: event.name,
          desc: event.desc,
          definition_val: JSON.stringify(event.definition_val),
          reporting_timing: event.reporting_timing,
          remark: event.remark,
          opeartor: event.operator,
          updated_time: formatTime(event.updated_time),
        });
      }
    }

    // 构造children结构数据
    const list = [];
    for (const id of mainEIDList) {
      const subIDs = mainSubIDs.get(id);
      if (subIDs !== undefined) {
        const arr = [];
        for (const subID of subIDs) {
          arr.push(eventObj.get(subID));
        }
        eventObj.get(id).children = arr;
      }
      list.push(eventObj.get(id));
    }
    ret.data = { list, total };

    return ret;
  },
};

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.category === undefined || params.name === undefined || params.definition_val === undefined
    || params.rule_list === undefined || !Array.isArray(params.rule_list)) {
    return false;
  }
  return true;
}

function checkEditParams(params) {
  if (params.id === undefined || params.proto_id === undefined || params.category === undefined || params.original_id === undefined || params.name === undefined
    || params.desc === undefined || params.definition_val === undefined || params.reporting_timing === undefined || params.status === undefined
    || params.remark === undefined || params.rule_list === undefined || !Array.isArray(params.rule_list)) {
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

module.exports = Event;
