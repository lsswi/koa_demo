const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { RET, TABLE_INFO, FIELD_TAG } = require('./const');
const common = require('./common');
const moment = require('moment');
const { VERIFICATION_TYPE } = require('../../scheduler/data-dict');
const { rainbow, opts } = require('./rainbow');
const lodash = require('lodash');

// event的开关状态
const STATUS = {
  OFF: 0,
  ON: 1,
};

// 请求必要参数
const REQUEST_PARAMS = {
  CREATE: ['protocol_id', 'category', 'name', 'desc', 'definition_val', 'reporting_timing', 'remark', 'verification_list', 'status'],
  QUERY: ['protocol_id'],
};

const Event = {
  /**
   * 创建/编辑事件
   * @url /node-cgi/data-dict/event/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.CREATE);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }

    try {
      // 前置协议存在检查检查
      await common.existProto(TABLE_INFO.TABLE_PROTOCOL, params.protocol_id);
      if (params.verification_list.length > 0) {
        await common.existVerification(params.verification_list);
      }
      // 传了id，update数据
      if (params.id) {
        await common.existData(TABLE_INFO.TABLE_EVENT, params.id);
        await updateEvent(ctx.session.user.loginname, params);
        ret.data = { id: params.id };
      } else {
        // 重复定义检查
        await checkEventRepetition(params);
        const id = await createEvent(ctx.session.user.loginname, params);
        ret.data = { id };
      }
    } catch (err) {
      if (err.ret) return err;
      console.log(err);
      return RET.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 删除事件
   * @url /node-cgi/data-dict/event/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    if (!params.ids) {
      return { ret: RET.CODE_PARAM_ERROR, msg: 'params error, ids can not be null' };
    }

    try {
      const ids = params.ids.filter(id => Number.isFinite(id) && id !== 0);
      await DBClient.transaction(async (transaction) => {
        // 删除事件源数据
        await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_EVENT} SET is_deleted=1 WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
        // 删除事件-规则关联数据
        await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_REL_EVENT_FIELD_VERIFICATION} SET is_deleted=1 WHERE event_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
        // 删除事件-流量关联数据
        await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_REL_MEDIA_EVENT} SET is_deleted=1 WHERE event_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
      });
      ret.data = { ids };
    } catch (err) {
      console.error(err);
      return RET.INTERNAL_DB_ERROR_RET;
    }
    return ret;
  },

  /**
   * 查询事件
   * @url /node-cgi/data-dict/event/query
   */
  async query(ctx) {
    const params = ctx.query;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.QUERY);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }

    try {
      // total：总数
      // eIDList：所有event_id列表，包含main和sub的
      // eventInfo: event_id -> event信息的映射
      const { total, eIDList, eventInfo } = await queryEvents(params);
      if (eIDList.length === 0) {
        ret.data = { total, list: [] };
        return ret;
      }
      // 构造最终返回结构
      const eventObj = await this.formRetEventInfo(eventInfo, eIDList);
      const list = [];
      for (const id of eIDList) {
        list.push(eventObj.get(id));
      }
      ret.data = { list, total };
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return RET.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 改变事件状态
   * @url /node-cgi/data-dict/event/change-status
   */
  async changeStatus(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    if (!checkChangeStatusParams(params)) {
      return { ret: RET.CODE_PARAM_ERROR, msg: 'params error, event_id, status can not be null, status should be 0 or 1' };
    }
    try {
      await common.existData(TABLE_INFO.TABLE_EVENT, params.event_id);
      await changeStatus(params.event_id, params.status);
      ret.data = { id: params.event_id };
    } catch (err) {
      if (err.ret) return err;
      console.log(err);
      return RET.UNKNOWN_RET;
    }
    return ret;
  },

  // 这里只用来event单独的查询
  async formRetEventInfo(eventInfo, eIDList) {
    const { eventObj } = await this.queryEventField(eventInfo, eIDList);
    for (const [eID, info] of eventInfo) {
      if (!eventObj.has(eID)) {
        eventObj.set(eID, {
          id: eID,
          desc: info.desc,
          category: info.category,
          name: info.name,
          definition_val: info.definition_val,
          reporting_timing: info.reporting_timing,
          remark: info.remark,
          operator: info.operator,
          status: info.status,
        });
      }
    }
    // 没有规则的，设置一下基础信息
    for (const eID of eIDList) {
      if (!eventObj.has(eID)) {
        const event = eventInfo.get(eID);
        eventObj.set(eID, {
          id: eID,
          category: event.category,
          name: event.name,
          desc: event.desc,
          definition_val: event.definition_val,
          reporting_timing: event.reporting_timing,
          remark: event.remark,
          operator: event.operator,
          updated_time: moment(event.updated_time).format('YYYY-MM-DD HH:mm:ss'),
        });
      } else {  // 有规则的设置一下event通过率和event x field_verification_id 通过率
        // await formConflictRate(eventObj, eID, conflictInfo, fvHitSum, eIDPassRate);
      }
    }
    return eventObj;
  },

  async queryEventField(eventInfo, eIDList) {
    // 返回的event内容，eid -> {id, desc, name ...}
    const eventObj = new Map();
    // event_id 的 fvid数组
    const eIDFieldVerificationIDs = new Map();
    if (eIDList.length === 0) {
      return { eventObj, eIDFieldVerificationIDs };
    }
    /**
     * 关联查字段信息
     * SELECT t1.event_id, t1.field_verification_id, t2.rule_id, t3.name
     *    FROM (SELECT * FROM rel_event_field_verification WHERE is_deleted=0 AND event_id IN (1,2,3)) t1
     *    LEFT JOIN field_verification t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
     *    LEFT JOIN field t3 ON t2.field_id=t3.id WHERE t3.is_deleted=0 AND t3.is_deleted=0
     */
    const fieldQuerySql = `SELECT t1.event_id, t1.field_verification_id, t2.rule_id, t2.verification_value, t3.name, t3.id as field_id, t3.field_key
        FROM (
          SELECT * FROM ${TABLE_INFO.TABLE_REL_EVENT_FIELD_VERIFICATION}
            WHERE is_deleted=0 AND event_id IN (${eIDList})
        ) t1
        LEFT JOIN ${TABLE_INFO.TABLE_FIELD_VERIFICATION} t2
          ON t1.field_verification_id=t2.id AND t2.is_deleted=0
        LEFT JOIN ${TABLE_INFO.TABLE_FIELD} t3
          ON t2.field_id=t3.id AND t3.is_deleted=0 ORDER BY t1.event_id`;
    await DBClient.query(fieldQuerySql)
      .then(([rules]) => {
        for (const rule of rules) {
          // rule_id为空说明verification信息被删除，name为空说明field信息被删除，一般不会有这种情况，删除的时候都处理了
          if (rule.rule_id !== null && rule.name !== null) {
            /**
             * 这里首先获取所有event关联的规则数据，然后再对字段规则left join，最后再left join字段基础信息。
             * 所以对于一个event_id，有可能有多条数据。
             * 对于第一条数据构造完整的结构（基础信息+该条校验规则），对于接下来重复的event_id就只需push校验规则即可。
             */
            if (!eventObj.has(rule.event_id)) {
              eIDFieldVerificationIDs.set(rule.event_id, [rule.field_verification_id]);
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
                updated_time: moment(event.updated_time).format('YYYY-MM-DD HH:mm:ss'),
                field_list: [{
                  verification_id: rule.field_verification_id,
                  field_name: rule.name,
                  field_name_en: rule.field_key,
                  field_id: rule.field_id,
                  rule_id: rule.rule_id,
                  value: rule.verification_value,
                  field_tag: FIELD_TAG.TAG_EVENT,
                }],
              };
              eventObj.set(rule.event_id, tmpObj);
            } else {
              eIDFieldVerificationIDs.get(rule.event_id).push(rule.field_verification_id);
              eventObj.get(rule.event_id).field_list.push({
                verification_id: rule.field_verification_id,
                field_name: rule.name,
                field_id: rule.field_id,
                rule_id: rule.rule_id,
                value: rule.verification_value,
                field_tag: FIELD_TAG.TAG_EVENT,
              });
            }
          }
        }
      })
      .catch((err) => {
        console.error(err);
        throw RET.INTERNAL_DB_ERROR_RET;
      });
    return { eventObj, eIDFieldVerificationIDs };
  },

  /**
   * 获取事件校验命中，冲突数
   * @param {*} eIDFieldVerificationIDs eID -> []fvID
   * @param {*} mID media_id
   * @param {*} ruleTypeList []ruleTypeList
   * @returns conflictInfo: eid_fvid -> {rule:1, null:1, type: 1}, fvHitSum: eid -> fvid通过率的分母hit, eIDPassRate: eid -> 整体通过率
   */
  async getEventVerificationNums(eIDFieldVerificationIDs, mID, ruleTypeList) {
    // type=8 总，type=2 规则冲突，type=4 未上报，type=6 类型错误
    const queryList = [];
    const dataTime = moment().subtract(1, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
    for (const [k, v] of eIDFieldVerificationIDs) {
      // k: eid, v: fvid list
      let sqlHit = `SELECT media_id, event_id, hit_nums, verification_type
      FROM ${TABLE_INFO.TABLE_DAILY_DUMP_VERIFICATION}
      WHERE data_time>='${dataTime}'
      AND event_id=${k}
      AND is_deleted=0
      AND verification_type=${VERIFICATION_TYPE.TYPE_MEDIA_EVENT_HIT}`;

      let sqlConflict = `SELECT media_id, event_id, field_verification_id, conflict_nums, rule_id, verification_type
      FROM ${TABLE_INFO.TABLE_DAILY_DUMP_VERIFICATION}
      WHERE data_time>='${dataTime}'
      AND event_id=${k}
      AND field_verification_id IN (${v.join(',')})
      AND is_deleted=0
      AND verification_type IN (${ruleTypeList.join(',')})`;

      if (mID) {
        sqlHit += ` AND media_id=${mID}`;
        sqlConflict += ` AND media_id=${mID}`;
      }
      queryList.push(DBClient.query(sqlHit));
      if (v.length) {
        queryList.push(DBClient.query(sqlConflict));
      }
    }

    // eid_fvid维度 ，conflict的加和 -> {rule:1, null:1, type:1}
    const conflictInfo = new Map();
    // eid维度，hit的加和 -> hit_sum，meida x event 所有fv的hit都一样，所以计算某个fvid的时候用 所有fvid的加和 / 所有hit的加和
    const fvHitSum = new Map();
    // eid 所有hit的加和，因为media x event 所有fv的hit都一样，所以总的应该是每个 (media x event)  * (event fvid 数量) * hit_nums
    const eIDHitSum = new Map();
    // eid维度，所有conflict的加合
    const eIDConflictSum = new Map();
    await Promise.all(queryList)
      .then((res) => {
        for (const [objList] of res) {
          for (const obj of objList) {
            if (obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_HIT) {
              // eid维度，hit的加和
              fvHitSum.set(obj.event_id, fvHitSum.has(obj.event_id) ? fvHitSum.get(obj.event_id) + obj.hit_nums : obj.hit_nums);
              // 加合event_id维度的校验总量 fvid个数 x hit_num，对于同一个eid，有n个eid x mid，就有sum = fvid.length * n
              let tmpSum = eIDHitSum.get(obj.event_id) ? eIDHitSum.get(obj.event_id) : 0;
              tmpSum += eIDFieldVerificationIDs.get(obj.event_id).length * obj.hit_nums;
              eIDHitSum.set(obj.event_id, tmpSum);
              continue;
            }

            // eid_fvid 维度，fvid具体的conflict加和
            const conflictObj = conflictInfo.get(`${obj.event_id}_${obj.field_verification_id}`) ? conflictInfo.get(`${obj.event_id}_${obj.field_verification_id}`) : {};
            // eid维度，整体conflict的加和
            let eIDConflictSumNums = eIDConflictSum.get(obj.event_id) ? eIDConflictSum.get(obj.event_id) : 0;
            if (obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_RULE_CONFLICT
              || obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_COMMON_RULE_CONFLICT) {
              let tmpNum = conflictObj.conflict_rule ? conflictObj.conflict_rule : 0;
              tmpNum += obj.conflict_nums;
              conflictObj.conflict_rule = tmpNum;
              conflictObj.conflict_rule_ri = obj.rule_id;
              eIDConflictSumNums += obj.conflict_nums;
            }
            if (obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_NULL_CONFLICT
              || obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_COMMON_NULL_CONFLICT) {
              let tmpNum = conflictObj.conflict_null ? conflictObj.conflict_null : 0;
              tmpNum += obj.conflict_nums;
              conflictObj.conflict_null = tmpNum;
              conflictObj.conflict_null_ri = obj.rule_id;
              eIDConflictSumNums += obj.conflict_nums;
            }
            if (obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_TYPE_CONFLICT
              || obj.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT_COMMON_TYPE_CONFLICT) {
              let tmpNum = conflictObj.conflict_type ? conflictObj.conflict_type : 0;
              tmpNum += obj.conflict_nums;
              conflictObj.conflict_type = tmpNum;
              conflictObj.conflict_type_ri = obj.rule_id;
              eIDConflictSumNums += obj.conflict_nums;
            }
            conflictInfo.set(`${obj.event_id}_${obj.field_verification_id}`, conflictObj);
            eIDConflictSum.set(obj.event_id, eIDConflictSumNums);
          }
        }
      })
      .catch((err) => {
        console.error(err);
        throw RET.INTERNAL_DB_ERROR_RET;
      });

    const eIDPassRate = new Map();
    for (const [k, v] of eIDHitSum) {
      // k: eID, v: hit_sum
      const conflictNum = eIDConflictSum.get(k) ? eIDConflictSum.get(k) : 0;
      eIDPassRate.set(k, parseFloat(((v - conflictNum) / v).toFixed(4)));
    }
    return { conflictInfo, fvHitSum, eIDPassRate };
  },
};

function queryEventPassRate(mediaID) {
  const eventRate = new Map();
  const eventFieldVerificationRate = new Map();

}

async function queryMediaFieldInfo(mID) {
  const ret = [];
  if (!mID) return ret;
  const fieldQuerySql = `SELECT t1.field_verification_id, t2.rule_id, t2.verification_value, t3.name, t3.id as field_id, t3.field_key
    FROM (
      SELECT * FROM ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION} WHERE is_deleted=0 AND media_id = ${mID}
    ) t1
    LEFT JOIN ${TABLE_INFO.TABLE_FIELD_VERIFICATION} t2
      ON t1.field_verification_id=t2.id AND t2.is_deleted=0
    LEFT JOIN ${TABLE_INFO.TABLE_FIELD} t3
      ON t2.field_id=t3.id AND t3.is_deleted=0 ORDER BY t1.media_id`;
  await DBClient.query(fieldQuerySql)
    .then(([res]) => {
      for (const obj of res) {
        ret.push({
          verification_id: obj.field_verification_id,
          field_name: obj.name,
          field_name_en: obj.field_key,
          field_id: obj.field_id,
          rule_id: obj.rule_id,
          value: obj.verification_value,
          field_tag: FIELD_TAG.TAG_COMMON,
        });
      }
    })
    .catch((err) => {
      console.error(err);
      throw err;
    });
  return ret;
}

async function formConflictRate(eventObj, eID, conflictInfo, fvHitSum, eIDPassRate) {
  const obj = eventObj.get(eID);
  // 先设置一下event整体通过率
  const passRate = eIDPassRate.get(eID);
  obj.pass_rate = passRate;
  const passRateConfRaw = await rainbow.get('pass_rate_info', opts);
  const passRateConf = JSON.parse(passRateConfRaw);
  const fvHitSumNums = fvHitSum.get(eID);
  // 整体通过率为1，所有校验的通过率都为1
  for (const fieldObj of obj.field_list) {
    if (!fvHitSumNums) continue;
    if (!fieldObj.healthy_degree) fieldObj.healthy_degree = { fail_reason: [] };
    if (passRate === 1) {
      fieldObj.healthy_degree.pass_rate = 1;
      continue;
    }

    const conflictObj = conflictInfo.get(`${eID}_${fieldObj.verification_id}`);
    let succRate = 1;
    if (conflictObj && conflictObj.conflict_rule) {
      const rate = parseFloat((conflictObj.conflict_rule / fvHitSumNums).toFixed(4));
      succRate -= rate;
      const tmpObj = { rate, name: passRateConf.conflict_rule_rate.name, desc: passRateConf.conflict_rule_rate.desc };
      if (rate > 0) tmpObj.hawk_url = common.formHawkRuleIDQueryUrl(conflictObj.conflict_rule_ri);
      fieldObj.healthy_degree.fail_reason = common.sortConflictRate(fieldObj.healthy_degree.fail_reason, tmpObj);
    }
    if (conflictObj && conflictObj.conflict_null) {
      const rate = parseFloat((conflictObj.conflict_null / fvHitSumNums).toFixed(4));
      succRate -= rate;
      const tmpObj = { rate, name: passRateConf.conflict_null_rate.name, desc: passRateConf.conflict_null_rate.desc };
      if (rate > 0) tmpObj.hawk_url = common.formHawkRuleIDQueryUrl(conflictObj.conflict_null_ri);
      fieldObj.healthy_degree.fail_reason = common.sortConflictRate(fieldObj.healthy_degree.fail_reason, tmpObj);
    }
    if (conflictObj && conflictObj.conflict_type) {
      const rate = parseFloat((conflictObj.conflict_type / fvHitSumNums).toFixed(4));
      succRate -= rate;
      const tmpObj = { rate, name: passRateConf.conflict_type_rate.name, desc: passRateConf.conflict_type_rate.desc };
      if (rate > 0) tmpObj.hawk_url = common.formHawkRuleIDQueryUrl(conflictObj.conflict_type_ri);
      fieldObj.healthy_degree.fail_reason = common.sortConflictRate(fieldObj.healthy_degree.fail_reason, tmpObj);
    }
    fieldObj.healthy_degree.pass_rate = parseFloat(succRate.toFixed(4));
  }
}

async function createEvent(operator, params) {
  let id = 0;
  try {
    await DBClient.transaction(async (transaction) => {
      // 创建事件源数据
      const insertEventSql = `INSERT INTO ${TABLE_INFO.TABLE_EVENT}
        (proto_id, category, name, \`desc\`, definition_val, md_key, reporting_timing, status, remark, operator)
        VALUES(:proto_id, :category, :name, :desc, :definition_val, MD5(:definition_val), :reporting_timing, :status, :remark, :operator)`;
      const [eventID] = await DBClient.query(insertEventSql, {
        replacements: {
          operator,
          proto_id: params.protocol_id,
          category: params.category,
          name: params.name,
          desc: params.desc,
          definition_val: JSON.stringify(params.definition_val),
          reporting_timing: params.reporting_timing,
          status: params.status,
          remark: params.remark,
        },
        transaction,
      });
      id = eventID;

      // 创建事件和字段规则的关联
      const insertValue = [];
      const insertRelSql = `INSERT INTO ${TABLE_INFO.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES`;
      for (const rule_id of params.verification_list.filter(Number.isFinite)) {
        insertValue.push(`(${eventID}, ${rule_id})`);
      }
      if (insertValue.length > 0) {
        await DBClient.query(insertRelSql + insertValue.join(','), { transaction });
      }
    });
  } catch (err) {
    console.error(err);
    throw RET.INTERNAL_DB_ERROR_RET;
  }
  return id;
}

// 定义+描述做唯一区分
async function checkEventRepetition(params) {
  const defJsonFormat = JSON.stringify(params.definition_val);
  const checkSql = `SELECT COUNT(*) as cnt FROM ${TABLE_INFO.TABLE_EVENT} WHERE is_deleted=0 AND md_key=MD5(:def_val) AND \`desc\`=:desc`;
  await DBClient.query(checkSql, { replacements: { def_val: defJsonFormat, desc: params.desc } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt > 0) {
        throw { ret: RET.CODE_EXISTED, msg: `事件定义: ${defJsonFormat} 已存在` };
      }
    })
    .catch((err) => {
      if (err.ret) throw err;
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
}

async function updateEvent(operator, params) {
  try {
    await DBClient.transaction(async (transaction) => {
      // 如果是父数据，更新父数据且更新子数据基本信息
      const defJsonFormat = JSON.stringify(params.definition_val);
      const updateSql = `UPDATE ${TABLE_INFO.TABLE_EVENT}
          SET category=:category, name=:name, \`desc\`=:desc, definition_val=:definition_val, md_key=MD5(:definition_val),
            reporting_timing=:reporting_timing, status=:status, remark=:remark, operator=:operator
          WHERE id=:id`;
      await DBClient.query(updateSql, {
        replacements: {
          operator,
          category: params.category,
          name: params.name,
          desc: params.desc,
          definition_val: defJsonFormat,
          reporting_timing: params.reporting_timing,
          status: params.status,
          remark: params.remark,
          id: params.id,
        },
        transaction,
      });

      // 构造插入values语句
      const insertValue = [];
      for (const rule_id of params.verification_list.filter(Number.isFinite)) {
        insertValue.push(`(${params.id}, ${rule_id})`);
      }

      // 先全量假删，保留记录
      const deleteSql = `UPDATE ${TABLE_INFO.TABLE_REL_EVENT_FIELD_VERIFICATION} SET is_deleted=1 WHERE event_id=:event_id`;
      await DBClient.query(deleteSql, { replacements: { event_id: params.id }, transaction });

      // 后全量插
      if (insertValue.length > 0) {
        const insertSql = `INSERT INTO ${TABLE_INFO.TABLE_REL_EVENT_FIELD_VERIFICATION}(event_id, field_verification_id) VALUES${insertValue.join(',')}`;
        await DBClient.query(insertSql, { transaction });
      }
    });
  } catch (err) {
    console.error(err);
    throw RET.INTERNAL_DB_ERROR_RET;
  }
}

async function queryEvents(params) {
  // 设置参数默认值
  const { page = 1, size = 10 } = params;

  // 查询替换参数
  const replacements = { proto_id: params.protocol_id };
  let mainQuerySql = `SELECT * FROM ${TABLE_INFO.TABLE_EVENT} WHERE is_deleted=0 AND proto_id=${params.protocol_id}`;
  /**
   * SELECT COUNT(*) as cnt FROM data_dict_event
   *    WHERE proto_id=1 AND category=0 AND (id=6 OR name LIKE '%6%' OR definition_val LIKE :fuzzyQuery)
   */
  let countSql = `SELECT COUNT(*) as cnt FROM ${TABLE_INFO.TABLE_EVENT} WHERE is_deleted=0 AND proto_id=:proto_id`;
  if (params.category) {
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
  mainQuerySql += ` ORDER BY updated_time DESC LIMIT ${(page - 1) * size}, ${size}`;

  let total = 0;
  // event_id集合
  const eIDList = [];
  // event_id -> event信息的映射
  const eventInfo = new Map();
  await Promise.all([
    DBClient.query(mainQuerySql, { replacements }),
    DBClient.query(countSql, { replacements }),
  ])
    .then((promiseRes) => {
      const [[events], [[queryCount]]] = promiseRes;
      for (const e of events) {
        eIDList.push(e.id);
        eventInfo.set(e.id, e);
      }
      total = queryCount.cnt;
    })
    .catch((err) => {
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });

  return { total, eIDList, eventInfo };
}

async function changeStatus(id, status) {
  await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_EVENT} SET status=:status WHERE id=:id`, { replacements: { status, id } })
    .catch((err) => {
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
}

function checkChangeStatusParams(params) {
  if (params.event_id === undefined || params.status === undefined || (params.status !== STATUS.OFF && params.status !== STATUS.ON)) {
    return false;
  }
  return true;
}

module.exports = Event;
