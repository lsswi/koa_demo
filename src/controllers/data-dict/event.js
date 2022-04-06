const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
const common = require('./common');

const Event = {
  /**
   * 创建/编辑事件
   * @url /node-cgi/data-dict/event/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    if (!checkCreateParams(params)) {
      return {
        ret: Ret.CODE_PARAM_ERROR,
        msg: 'params error, proto_id, original_id, category, name, desc, definition_val, reporting_timing, remark, verification_list can not be null',
      };
    }

    try {
      await common.existProto(TableInfo.TABLE_PROTOCOL, params.proto_id);
      await common.existVerification(params.verification_list);
      // original_id !=0 检查一下主数据是否存在
      if (params.original_id !== 0) {
        await common.existOriginal(TableInfo.TABLE_MEDIA, params.original_id);
      }
      // 传了id，update数据
      if (params.id) {
        await common.existData(TableInfo.TABLE_EVENT, params.id);
        // await updateEvent(ctx.session.user.loginname, params);
        await updateEvent('joyyieli', params);
        ret.data = { id: params.id };
      } else {
        // original_id=0为创建初始版本，检测一下重复
        if (params.original_id === 0) {
          await checkEventRepetition(params);
        }
        // const id = await createEvent(ctx.session.user.loginname, params);
        const id = await createEvent('joyyieli', params);
        ret.data = { id };
      }
    } catch (err) {
      if (err.ret) return err;
      console.log(err);
      return Ret.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 删除事件
   * @url /node-cgi/data-dict/event/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    if (params.ids === undefined) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, ids can not be null' };
    }

    try {
      const ids = params.ids.filter(Number.isFinite);
      await DBClient.transaction(async (transaction) => {
        // 删除事件源数据
        await DBClient.query(`UPDATE ${TableInfo.TABLE_EVENT} SET is_deleted=1 WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 删除事件-规则关联数据
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} SET is_deleted=1 WHERE event_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });

        // 删除事件-流量关联数据
        await DBClient.query(`UPDATE ${TableInfo.TABLE_REL_MEDIA_EVENT} SET is_deleted=1 WHERE event_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
      });
      ret.data = { ids };
    } catch (err) {
      console.error(err);
      return Ret.INTERNAL_DB_ERROR_RET;
    }
    return ret;
  },

  /**
   * 查询事件
   * @url /node-cgi/data-dict/event/query
   */
  async query(ctx) {
    const params = ctx.query;
    const ret = Ret.OK_RET;
    if (!checkQueryParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id can not be null' };
    }

    try {
      // total：总数
      // allEID：所有event_id列表，包含main和sub的
      // mainEIDList：main的event_id列表，用来查询
      // eventInfo: event_id -> event信息的映射
      // mainSubIDs: main的event_id对应的subID列表的映射
      const { total, allEID, mainEIDList, eventInfo, mainSubIDs } = await queryEvents(params);
      if (allEID.length === 0) {
        ret.data = { total, list: [] };
        return ret;
      }
      const eventObj = await queryEventField(eventInfo, allEID, params.proto_id);

      // 没有规则的，设置一下基础信息
      for (const id of allEID) {
        if (!eventObj.has(id)) {
          const event = eventInfo.get(id);
          eventObj.set(id, {
            id,
            category: event.category,
            name: event.name,
            desc: event.desc,
            definition_val: event.definition_val,
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
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return Ret.UNKNOWN_RET;
    }
    return ret;
  },
};

async function createEvent(operator, params) {
  let id = 0;
  try {
    await DBClient.transaction(async (transaction) => {
      // 创建事件源数据
      const insertEventSql = `INSERT INTO ${TableInfo.TABLE_EVENT}
        (proto_id, category, original_id, name, \`desc\`, definition_val, md_key, reporting_timing, status, remark, operator)
        VALUES(:proto_id, :category, :original_id, :name, :desc, :definition_val, MD5(:definition_val), :reporting_timing, :status, :remark, :operator)`;
      const [eventID] = await DBClient.query(insertEventSql, {
        replacements: {
          operator,
          proto_id: params.proto_id,
          category: params.category,
          original_id: params.original_id,
          name: params.name,
          desc: params.desc,
          definition_val: JSON.stringify(JSON.parse(params.definition_val)),
          reporting_timing: params.reporting_timing,
          status: params.status,
          remark: params.remark,
        },
        transaction,
      });
      id = eventID;

      // 创建事件和字段规则的关联
      const insertValue = [];
      const insertRelSql = `INSERT INTO ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES`;
      for (const rule_id of params.verification_list.filter(Number.isFinite)) {
        insertValue.push(`(${eventID}, ${rule_id})`);
      }
      if (insertValue.length > 0) {
        await DBClient.query(insertRelSql + insertValue.join(','), { transaction });
      }
    });
  } catch (err) {
    console.error(err);
    throw Ret.INTERNAL_DB_ERROR_RET;
  }
  return id;
}

async function checkEventRepetition(params) {
  const defJsonFormat = JSON.stringify(JSON.parse(params.definition_val));
  const checkSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_EVENT} WHERE md_key=MD5(:def_val)`;
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

async function updateEvent(operator, params) {
  try {
    await DBClient.transaction(async (transaction) => {
      // 1. 更新事件源数据
      const defJsonFormat = JSON.stringify(JSON.parse(params.definition_val));
      const updateSql = `UPDATE ${TableInfo.TABLE_EVENT}
        SET proto_id=:proto_id, category=:category, original_id=:original_id, name=:name, \`desc\`=:desc, definition_val=:definition_val, md_key=MD5(:definition_val),
        reporting_timing=:reporting_timing, status=:status, remark=:remark, operator=:operator
        WHERE id=:id`;
      await DBClient.query(updateSql, {
        replacements: {
          operator,
          proto_id: params.proto_id,
          category: params.category,
          original_id: params.original_id,
          name: params.name,
          desc: params.desc,
          definition_val: defJsonFormat,
          reporting_timing: params.reporting_timing,
          status: params.status,
          remark: params.remark,
          id: params.id,
        },
      });

      // 构造插入values语句
      const insertValue = [];
      for (const rule_id of params.verification_list.filter(Number.isFinite)) {
        insertValue.push(`(${params.id}, ${rule_id})`);
      }

      if (insertValue.length > 0) {
        // 2. 全量 ON DUPLICATE KEY UPDATE 插入rel_event_field_verification表，实现没有的新增
        const insertSql = `INSERT INTO ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES${insertValue.join(',')}
          ON DUPLICATE KEY UPDATE is_deleted=0;`;
        await DBClient.query(insertSql, { transaction });

        // 3. 软删除，event_id所有规则里vid不在传过来的vid的删除
        const deleteSql = `UPDATE ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} SET is_deleted=1 WHERE event_id=:eventID AND field_verification_id NOT IN (:ids)`;
        await DBClient.query(deleteSql, {
          replacements: { eventID: params.id, ids: params.verification_list.filter(Number.isFinite) },
          transaction,
        });
      }
    });
  } catch (err) {
    console.error(err);
    throw Ret.INTERNAL_DB_ERROR_RET;
  }
}

async function queryEventField(eventInfo, allEID) {
  /**
   * 关联查字段信息
   * SELECT t1.event_id, t1.field_verification_id, t2.rule_id, t3.name
   *    FROM (SELECT * FROM rel_event_field_verification WHERE is_deleted=0 AND event_id IN (1,2,3)) t1
   *    LEFT JOIN field_verification t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
   *    LEFT JOIN field t3 ON t2.field_id=t3.id WHERE t3.is_deleted=0 AND t3.is_deleted=0
   */
  const fieldQuerySql = `SELECT t1.event_id, t1.field_verification_id, t2.rule_id, t2.verification_value, t3.name
      FROM (SELECT * FROM ${TableInfo.TABLE_REL_EVENT_FIELD_VERIFICATION} WHERE is_deleted=0 AND event_id IN (${allEID})) t1
      LEFT JOIN ${TableInfo.TABLE_FIELD_VERIFICATION} t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
      LEFT JOIN ${TableInfo.TABLE_FIELD} t3 ON t2.field_id=t3.id AND t3.is_deleted=0 ORDER BY t1.event_id`;

  // 构造每个返回的event数据
  const eventObj = new Map();
  await DBClient.query(fieldQuerySql)
    .then(([rules]) => {
      for (const rule of rules) {
        // rule_id为空说明verification信息被删除，name为空说明field信息被删除，一般不会有这种情况，删除的时候都处理了
        if (rule.rule_id !== null && rule.name !== null) {
          // eid没有基础数据，构造基础数据；有基础数据说明是校验规则，push到field_list里面
          if (!eventObj.has(rule.event_id)) {
            const event = eventInfo.get(rule.event_id);
            const tmpObj = {
              id: rule.event_id,
              desc: event.desc,
              category: event.category,
              name: event.name,
              definition_val: event.definition_val,
              reporting_timing: event.reporting_timing,
              remark: event.remark,
              operator: event.operator,
              status: event.status,
              updated_time: formatTime(event.updated_time),
              field_list: [{
                verification_id: rule.field_verification_id,
                field_name: rule.name,
                rule_id: rule.rule_id,
                value: rule.verification_value,
              }],
            };
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
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
  return eventObj;
}

async function queryEvents(params) {
  // 设置参数默认值
  const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
  const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

  // 查询替换参数
  const replacements = { proto_id: params.proto_id };
  let mainQuerySql = `SELECT * FROM ${TableInfo.TABLE_EVENT} WHERE is_deleted=0 AND original_id=0 AND proto_id=${params.proto_id}`;
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
    mainQuerySql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query OR definition_val LIKE :fuzzyQuery)';
    countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query OR definition_val LIKE :fuzzyQuery)';
    replacements.query = params.query;
    replacements.fuzzyQuery = `%${params.query}%`;
  }
  mainQuerySql += ` LIMIT ${(page - 1) * size}, ${size}`;

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
  ])
    .then((promiseRes) => {
      const [[mainEvents], [[queryCount]]] = promiseRes;
      total = queryCount.cnt;
      for (const mainE of mainEvents) {
        mainEIDList.push(mainE.id);
        allEID.push(mainE.id);
        eventInfo.set(mainE.id, mainE);
      }
    })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });

  if (allEID.length === 0) {
    return { total, allEID };
  }

  /**
   * 查所有主event的所有子event
   * SELECT * FORM event WHERE is_deleted=0 AND original_id IN (1, 2, 3);
   */
  const subQuerySql = `SELECT * FROM ${TableInfo.TABLE_EVENT} WHERE is_deleted=0 AND original_id IN (:ids)`;
  const mainSubIDs = new Map();
  await DBClient.query(subQuerySql, { replacements: { ids: mainEIDList } })
    .then((res) => {
      const [subEvents] = res;
      for (const subE of subEvents) {
        allEID.push(subE.id);
        eventInfo.set(subE.id, subE);
        if (!mainSubIDs.has(subE.original_id)) {
          mainSubIDs.set(subE.original_id, [subE.id]);
        } else {
          mainSubIDs.get(subE.original_id).push(subE.id);
        }
      }
    })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });

  return { total, allEID, mainEIDList, eventInfo, mainSubIDs };
}

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.original_id === undefined || params.category === undefined || params.name === undefined
    || params.desc === undefined || params.definition_val === undefined || params.reporting_timing === undefined
    || params.remark === undefined || params.verification_list === undefined || params.status === undefined) {
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
