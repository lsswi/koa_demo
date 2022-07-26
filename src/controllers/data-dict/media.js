const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { RET, TABLE_INFO } = require('./const');
const common = require('./common');
const moment = require('moment');
const Event = require('./event');
const { VERIFICATION_TYPE } = require('../../scheduler/data-dict');
const { rainbow, opts } = require('./rainbow');

const REQUEST_PARAMS = {
  CREATE: ['protocol_id', 'name', 'desc', 'version', 'version_field_id', 'definition_val', 'verification_list', 'copy_id'],
  DELETE: ['ids'],
  QUERY: ['protocol_id'],
  CREATE_BINDING: ['media_id', 'event_ids'],
  DELETE_BINDING: ['ids'],
  QUERY_BINDING: ['media_id'],
};

const Media = {
  /**
   * 创建/编辑流量
   * @url /node-cgi/data-dict/media/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.CREATE);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }

    try {
      await common.existProto(TABLE_INFO.TABLE_PROTOCOL, params.protocol_id);
      if (params.verification_list.length > 0) {
        await common.existVerification(params.verification_list);
      }
      if (params.id) {
        await common.existData(TABLE_INFO.TABLE_MEDIA, params.id);
        await updateMedia(ctx.session.user.loginname, params);
        ret.data = { id: params.id };
      } else {
        await checkMediaRepetition(params);
        const id = await createMedia(ctx.session.user.loginname, params);
        ret.data = { id };
      }
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return RET.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 删除流量
   * @url /node-cgi/data-dict/media/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.DELETE);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }

    try {
      const ids = params.ids.filter(id => Number.isFinite(id) && id !== 0);
      await DBClient.transaction(async (transaction) => {
        // 删除数据源
        await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_MEDIA} SET is_deleted=1 WHERE id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
        // 删除流量-规则绑定
        await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION} SET is_deleted=1 WHERE media_id IN (:ids)`, {
          replacements: { ids },
          transaction,
        });
        // 删除流量-事件绑定
        await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_REL_MEDIA_EVENT} SET is_deleted=1 WHERE media_id IN (:ids)`, {
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
   * 查询流量
   * @url /node-cgi/data-dict/media/query
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
      // mIDList：media_id列表
      // mediaInfo: media_id -> media信息的映射
      const { total, mIDList, mediaInfo } = await queryMedia(params);
      if (mIDList.length === 0) {
        ret.data = { total, list: [] };
        return ret;
      }

      const mediaObj = await queryMediaField(mediaInfo, mIDList);
      const { mediaRate, meidaEventRate, mediaFieldVerificationRate } = await queryPassRateInfo(mIDList);
      // 没有规则的，设置一下基础信息
      for (const mID of mIDList) {
        if (!mediaObj.has(mID)) {
          const media = mediaInfo.get(mID);
          const tmpObj = {
            id: mID,
            name: media.name,
            desc: media.desc,
            version: media.version,
            version_field_id: media.version_field_id,
            definition_val: media.definition_val,
            reporting_timing: media.reporting_timing,
            operator: media.operator,
            updated_time: moment(media.updated_time).format('YYYY-MM-DD HH:mm:ss'),
          };
          if (mediaRate.has(mID)) tmpObj.pass_rate = mediaRate.get(mID);
          if (meidaEventRate.has(mID)) tmpObj.event_pass_rate = meidaEventRate.get(mID);
          mediaObj.set(mID, tmpObj);
        } else {  // 有规则的设置一下media通过率和media x field_verification_id 通过率
          setMediaPassRate(mID, mediaObj, mediaRate, meidaEventRate, mediaFieldVerificationRate);
        }
      }
      // 构造最终返回的结构
      const list = [];
      for (const id of mIDList) {
        list.push(mediaObj.get(id));
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
   * 创建流量与事件绑定
   * @url /node-cgi/data-dict/media/create-binding
   */
  async createBinding(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.CREATE_BINDING);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }

    try {
      await common.existData(TABLE_INFO.TABLE_MEDIA, params.media_id);
      await existEvent(params.event_ids);
      await DBClient.transaction(async (transaction) => {
        const existedEID = [];
        await DBClient.query(`SELECT event_id FROM ${TABLE_INFO.TABLE_REL_MEDIA_EVENT} WHERE is_deleted=0 AND media_id=:media_id`, {
          replacements: { media_id: params.media_id },
          transaction,
        })
          .then(([res]) => {
            for (const e of res) {
              existedEID.push(e.event_id);
            }
          });

        const deletedList = [];
        const insertList = [];
        for (const id of params.event_ids) {
          if (existedEID.indexOf(id) === -1) {
            insertList.push(id);
          }
        }
        for (const id of existedEID) {
          if (params.event_ids.indexOf(id) === -1) {
            deletedList.push(id);
          }
        }
        if (deletedList.length > 0) {
          await DBClient.query(`UPDATE ${TABLE_INFO.TABLE_REL_MEDIA_EVENT} SET is_deleted=1 WHERE media_id=:media_id AND event_id IN (${deletedList.join(',')})`, {
            replacements: { media_id: params.media_id },
            transaction,
          });
        }

        const insertValue = [];
        for (const id of insertList) {
          insertValue.push(`(${params.media_id}, ${id}, '${ctx.session.user.loginname}')`);
        }
        if (insertValue.length > 0) {
          const querySql = `INSERT INTO ${TABLE_INFO.TABLE_REL_MEDIA_EVENT}(media_id, event_id, operator) VALUES${insertValue.join(',')}`;
          if (insertValue.length > 0) {
            await DBClient.query(querySql, { transaction });
          }
        }
      });
      ret.data = { ids: params.event_ids };
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return RET.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 删除流量与事件绑定
   * @url /node-cgi/data-dict/media/delete-binding
   */
  async deleteBinding(ctx) {
    const params = ctx.request.body;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.DELETE_BINDING);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }

    const ids = params.ids.filter(Number.isFinite);
    const querySql = `UPDATE ${TABLE_INFO.TABLE_REL_MEDIA_EVENT} SET is_deleted=1 WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids } })
      .then(() => {
        ret.data = { ids: params.ids };
      })
      .catch((err) => {
        console.error(err);
        return RET.INTERNAL_DB_ERROR_RET;
      });
    return ret;
  },

  /**
   * 查询流量与事件绑定
   * @url /node-cgi/data-dict/media/query-binding
   */
  async queryBinding(ctx) {
    const params = ctx.query;
    const ret = RET.OK_RET;
    const errMsg = common.checkRequiredParams(params, REQUEST_PARAMS.QUERY_BINDING);
    if (errMsg.length > 0) {
      return { ret: RET.CODE_PARAM_ERROR, msg: errMsg };
    }
    const { page = 1, size = 10 } = params;

    try {
      // total：总数
      // eIDList：所有event_id列表，包含main和sub的
      // eventInfo: event_id -> event信息的映射
      const { total, eIDList, eventInfo } = await queryBindingEvent(params, page, size);
      await formEventFieldList(eventInfo, eIDList, params.media_id);
      const eventObj = await Event.formRetEventInfo(eventInfo, eIDList, params.media_id);
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
};

function setMediaPassRate(mID, mediaObj, mediaRate, meidaEventRate, mediaFieldVerificationRate) {
  const obj = mediaObj.get(mID);
  if (mediaRate.has(mID)) obj.pass_rate = mediaRate.get(mID);
  if (meidaEventRate.has(mID)) obj.event_pass_rate = meidaEventRate.get(mID);
  for (const fieldObj of obj.field_list) {
    if (!mediaFieldVerificationRate.has(`${mID}_${fieldObj.verification_id}`)) continue;
    fieldObj.healthy_degree = { fail_reason: [] };
    const rateInfo = mediaFieldVerificationRate.get(`${mID}_${fieldObj.verification_id}`);
    if (rateInfo.conflict_rule) {
      fieldObj.healthy_degree.fail_reason = common.sortConflictRate(fieldObj.healthy_degree.fail_reason, {
        rate: rateInfo.conflict_rule.rate,
        name: 'rule',
        desc: 'desc',
        hawk_url: common.formHawkRuleIDQueryUrl(rateInfo.conflict_rule.rule_id),
      });
    }
    if (rateInfo.conflict_null) {
      fieldObj.healthy_degree.fail_reason = common.sortConflictRate(fieldObj.healthy_degree.fail_reason, {
        rate: rateInfo.conflict_null.rate,
        name: 'null',
        desc: 'desc',
        hawk_url: common.formHawkRuleIDQueryUrl(rateInfo.conflict_null.rule_id),
      });
    }
    if (rateInfo.conflict_type) {
      fieldObj.healthy_degree.fail_reason = common.sortConflictRate(fieldObj.healthy_degree.fail_reason, {
        rate: rateInfo.conflict_type.rate,
        name: 'type',
        desc: 'desc',
        hawk_url: common.formHawkRuleIDQueryUrl(rateInfo.conflict_type.rule_id),
      });
    }
    fieldObj.healthy_degree.pass_rate = rateInfo.succ_rate;
  }
}

async function queryPassRateInfo(mediaIDList) {
  const mediaRate = new Map();
  const meidaEventRate = new Map();
  const mediaFieldVerificationRate = new Map();
  if (!mediaIDList.length) {
    return { mediaRate, meidaEventRate, mediaFieldVerificationRate };
  }
  const sql = `SELECT * FROM data_dict_daily_pass_rate WHERE media_id IN (${mediaIDList.join(',')}) AND data_type IN (1,2,3) AND is_deleted=0`;
  await DBClient.query(sql)
    .then(([res]) => {
      for (const obj of res) {
        switch (obj.data_type) {
          case 1:
            mediaRate.set(obj.media_id, obj.pass_rate.succ_rate);
            break;
          case 2:
            meidaEventRate.set(obj.media_id, obj.pass_rate.succ_rate);
            break;
          case 3:
            mediaFieldVerificationRate.set(`${obj.media_id}_${obj.fvid}`, obj.pass_rate);
        }
      }
    })
    .catch((err) => {
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
  return { mediaRate, meidaEventRate, mediaFieldVerificationRate };
}

async function queryBindingEvent(params, page, size) {
  const replacements = { media_id: params.media_id };
  const subQuerySql = `SELECT * FROM ${TABLE_INFO.TABLE_REL_MEDIA_EVENT} WHERE is_deleted=0 AND media_id=:media_id`;
  let countSql = `SELECT COUNT(*) as cnt FROM (${subQuerySql}) t1 LEFT JOIN ${TABLE_INFO.TABLE_EVENT} t2 ON t1.event_id=t2.id WHERE t2.is_deleted=0`;
  let querySql = `SELECT t1.id as rel_id, t2.id, t2.name, t2.desc, t2.category, t2.reporting_timing, t2.definition_val, t2.remark, t2.status, t2.updated_time,
      t1.operator, t1.updated_time as rel_updated_time FROM (${subQuerySql}) t1
    LEFT JOIN ${TABLE_INFO.TABLE_EVENT} t2
      ON t1.event_id=t2.id WHERE t2.is_deleted=0`;
  if (params.category) {
    querySql += ' AND category=:category';
    countSql += ' AND category=:category';
    replacements.category = params.category;
  }
  if (params.query !== undefined && params.query !== '') {
    querySql += ' AND (t2.name LIKE :fuzzyQuery OR t2.id=:query OR t2.definition_val LIKE :fuzzyQuery OR t1.operator LIKE :fuzzyQuery)';
    countSql += ' AND (t2.name LIKE :fuzzyQuery OR t2.id=:query OR t2.definition_val LIKE :fuzzyQuery OR t1.operator LIKE :fuzzyQuery)';
    replacements.query = params.query;
    replacements.fuzzyQuery = `%${params.query}%`;
  }
  querySql += ` LIMIT ${(page - 1) * size}, ${size}`;

  const eventInfo = new Map();
  const eIDList = [];
  let total = 0;
  await Promise.all([
    await DBClient.query(querySql, { replacements }),
    await DBClient.query(countSql, { replacements }),
  ])
    .then((promiseRes) => {
      const [[events], [[queryCount]]] = promiseRes;
      for (const e of events) {
        eventInfo.set(e.id, e);
        eIDList.push(e.id);
      }
      total = queryCount.cnt;
    })
    .catch((err) => {
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });

  return { total, eIDList, eventInfo };
}

// 这里绑定事件补充media字段
async function formEventFieldList(eventInfo, eIDList, mediaID) {
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
  // 把media的字段也加上
  const mediaFieldInfo = await queryMediaFieldInfo(mediaID);
  for (const [, event] of eventObj) {
    const tmpCommon = lodash.cloneDeep(mediaFieldInfo);
    let tmpList = [];
    if (event.field_list) {
      tmpList = [...tmpCommon, ...event.field_list];
    } else {
      tmpList = [...tmpCommon];
    }
    event.field_list = tmpList;
  }
}

async function createMedia(operator, params) {
  let id = 0;
  try {
    await DBClient.transaction(async (transaction) => {
      // 创建流量源数据
      const querySql = `INSERT INTO ${TABLE_INFO.TABLE_MEDIA}(proto_id, name, \`desc\`, version, version_field_id, definition_val, md_key, operator)
        VALUES(:proto_id, :name, :desc, :version, :vfid, :definition_val, MD5(:definition_val), :operator)`;
      const [mediaID] = await DBClient.query(querySql, {
        replacements: {
          operator,
          proto_id: params.protocol_id,
          name: params.name,
          desc: params.desc,
          version: params.version,
          vfid: params.version_field_id,
          definition_val: JSON.stringify(params.definition_val),
        },
      });
      id = mediaID;

      // 创建流量和字段规则的关联
      const insertValue = [];
      const insertRelSql = `INSERT INTO ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION}(media_id, field_verification_id) VALUES`;
      for (const rule_id of params.verification_list.filter(Number.isFinite)) {
        insertValue.push(`(${mediaID}, ${rule_id})`);
      }
      if (insertValue.length > 0) {
        await DBClient.query(insertRelSql + insertValue.join(','), { transaction });
      }

      // 如果是创建版本要复制一下父media绑定的event
      if (params.copy_id !== 0) {
        const querySql = 'SELECT event_id FROM data_dict_rel_media_event WHERE is_deleted=0 AND media_id=:id';
        const [res] = await DBClient.query(querySql, { replacements: { id: params.copy_id }, transaction });
        const insertValue = [];
        for (const obj of res) {
          insertValue.push(`(${id}, ${obj.event_id}, '${operator}')`);
        }
        if (insertValue.length > 0) {
          const insertSql = `INSERT INTO ${TABLE_INFO.TABLE_REL_MEDIA_EVENT}(media_id, event_id, operator) VALUES${insertValue.join(',')}`;
          await DBClient.query(insertSql, { transaction });
        }
      }
    });
  } catch (err) {
    console.error(err);
    throw RET.INTERNAL_DB_ERROR_RET;
  }
  return id;
}

async function updateMedia(operator, params) {
  try {
    await DBClient.transaction(async (transaction) => {
      const updateSql = `UPDATE ${TABLE_INFO.TABLE_MEDIA}
          SET proto_id=:proto_id,name=:name,\`desc\`=:desc,version=:version,version_field_id=:vfid,definition_val=:definition_val,
            md_key=MD5(:definition_val),operator=:operator
          WHERE id=:id`;
      await DBClient.query(updateSql, {
        replacements: {
          operator,
          proto_id: params.protocol_id,
          name: params.name,
          desc: params.desc,
          version: params.version,
          vfid: params.version_field_id,
          definition_val: JSON.stringify(params.definition_val),
          id: params.id,
        },
        transaction,
      });

      // 构造插入values语句
      const insertValue = [];
      for (const rule_id of params.verification_list.filter(Number.isFinite)) {
        insertValue.push(`(${params.id}, ${rule_id})`);
      }

      const deleteSql = `UPDATE ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION} SET is_deleted=1 WHERE media_id=:media_id`;
      await DBClient.query(deleteSql, { replacements: { media_id: params.id }, transaction });

      if (insertValue.length > 0) {
        // 后全量插入
        const insertSql = `INSERT INTO ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION}(media_id, field_verification_id) VALUES${insertValue.join(',')}`;
        await DBClient.query(insertSql, { transaction });
      }
    });
  } catch (err) {
    console.error(err);
    throw RET.INTERNAL_DB_ERROR_RET;
  }
}

// 定义+版本做唯一区分
async function checkMediaRepetition(params) {
  const defJsonFormat = JSON.stringify(params.definition_val);
  const checkSql = `SELECT COUNT(*) as cnt FROM ${TABLE_INFO.TABLE_MEDIA} WHERE is_deleted =0 AND md_key=MD5(:def_val) AND version=:version`;
  await DBClient.query(checkSql, { replacements: { def_val: defJsonFormat, version: params.version } })
    .then(([res]) => {
      const [queryCount] = res;
      if (queryCount.cnt > 0) {
        throw { ret: RET.CODE_EXISTED, msg: `流量定义 ${defJsonFormat} 已存在` };
      }
    })
    .catch((err) => {
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });
}

async function existEvent(eventIDs) {
  if (eventIDs.length === 0) {
    return;
  }
  const existID = new Map();
  const querySql = `SELECT id FROM ${TABLE_INFO.TABLE_EVENT} WHERE id IN (:eventIDs)`;
  await DBClient.query(querySql, { replacements: { eventIDs } })
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
  for (const id of eventIDs) {
    if (!existID.has(id)) {
      unexsitedIDs.push(id);
    }
  }

  if (unexsitedIDs.length > 0) {
    throw { ret: RET.CODE_NOT_EXISTED, msg: `event_id: ${unexsitedIDs} not exsited` };
  }
}

async function queryMedia(params) {
  // 设置参数默认值
  const { page = 1, size = 10 } = params;

  // 查询替换参数
  const replacements = { proto_id: params.protocol_id };
  let mainQuerySql = `SELECT * FROM ${TABLE_INFO.TABLE_MEDIA} WHERE is_deleted=0 AND proto_id=:proto_id`;
  let countSql = `SELECT COUNT(*) as cnt FROM ${TABLE_INFO.TABLE_MEDIA} WHERE is_deleted=0 AND proto_id=:proto_id`;
  if (params.query !== undefined && params.query !== '') {
    mainQuerySql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator LIKE :fuzzyQuery)';
    countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator LIKE :fuzzyQuery)';
    replacements.query = params.query;
    replacements.fuzzyQuery = `%${params.query}%`;
  }
  mainQuerySql += ` ORDER BY updated_time DESC LIMIT ${(page - 1) * size}, ${size}`;

  let total = 0;
  // 所有media_id
  const mIDList = [];
  // media_id -> media信息的映射
  const mediaInfo = new Map();
  await Promise.all([
    DBClient.query(mainQuerySql, { replacements }),
    DBClient.query(countSql, { replacements }),
  ])
    .then((promiseRes) => {
      const [[mainMedia], [[queryCount]]] = promiseRes;
      total = queryCount.cnt;
      for (const mainE of mainMedia) {
        mIDList.push(mainE.id);
        mediaInfo.set(mainE.id, mainE);
      }
    })
    .catch((err) => {
      console.error(err);
      throw RET.INTERNAL_DB_ERROR_RET;
    });

  if (mIDList.length === 0) {
    return { total, mIDList };
  }

  return { total, mIDList, mediaInfo };
}

async function queryMediaField(mediaInfo, mIDList) {
  const mediaObj = new Map();
  if (mIDList.length === 0) {
    return mediaObj;
  }
  /**
   * 关联查字段信息
   * SELECT t1.media_id, t1.field_verification_id, t2.rule_id, t3.name
   *    FROM (SELECT * FROM rel_media_field_verification WHERE is_deleted=0 AND media_id IN (1,2,3)) t1
   *    LEFT JOIN field_verification t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
   *    LEFT JOIN field t3 ON t2.field_id=t3.id AND t3.is_deleted=0
   */
  const fieldQuerySql = `SELECT t1.media_id, t1.field_verification_id, t2.rule_id, t2.verification_value, t3.name, t3.id as field_id, t3.field_key
    FROM (
      SELECT * FROM ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION} WHERE is_deleted=0 AND media_id IN (${mIDList})
    ) t1
      LEFT JOIN ${TABLE_INFO.TABLE_FIELD_VERIFICATION} t2
        ON t1.field_verification_id=t2.id AND t2.is_deleted=0
      LEFT JOIN ${TABLE_INFO.TABLE_FIELD} t3
        ON t2.field_id=t3.id AND t3.is_deleted=0 ORDER BY t1.media_id`;
  // 构造每个返回的media数据
  await DBClient.query(fieldQuerySql)
    .then(([rules]) => {
      for (const rule of rules) {
        // rule_id为空说明verification信息被删除，name为空说明field信息被删除，一般不会有这种情况，删除的时候都处理了
        if (rule.rule_id !== null && rule.name !== null) {
          /**
           * 这里首先获取所有media关联的规则数据，然后再对字段规则left join，最后再left join字段基础信息。
           * 所以对于一个event_id，有可能有多条数据。
           * 所以对于第一条数据构造完整的结构（基础信息+该条校验规则），对于有重复的event_id就只需push校验规则即可。
           */
          if (!mediaObj.has(rule.media_id)) {
            const media = mediaInfo.get(rule.media_id);
            const tmpObj = {
              id: rule.media_id,
              name: media.name,
              desc: media.desc,
              version: media.version,
              version_field_id: media.version_field_id,
              definition_val: media.definition_val,
              operator: media.operator,
              updated_time: moment(media.updated_time).format('YYYY-MM-DD HH:mm:ss'),
              field_list: [{
                verification_id: rule.field_verification_id,
                field_id: rule.field_id,
                field_name: rule.name,
                field_name_en: rule.field_key,
                rule_id: rule.rule_id,
                value: rule.verification_value,
              }],
            };
            mediaObj.set(rule.media_id, tmpObj);
          } else {
            mediaObj.get(rule.media_id).field_list.push({
              verification_id: rule.field_verification_id,
              field_id: rule.field_id,
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
      throw RET.INTERNAL_DB_ERROR_RET;
    });
  return mediaObj;
}

module.exports = Media;
