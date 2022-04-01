const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
const common = require('./common');

const Media = {
  /**
   * 创建/编辑流量
   * @url /node-cgi/data-dict/media/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    if (!checkCreateParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id, original_id, name, desc, version, definition_val, remark can not be null' };
    }

    try {
      await common.existProto(TableInfo.TABLE_PROTOCOL, params.proto_id);
      await common.existVerification(params.rule_list);
      // original_id !=0 检查一下主数据是否存在
      if (params.original_id !== 0) {
        await common.existOriginal(TableInfo.TABLE_MEDIA, params.original_id);
      }
      if (params.id) {
        await common.existData(TableInfo.TABLE_MEDIA, params.id);
        await updateMedia(params);
        ret.data = { id: params.id };
      } else {
        // original_id=0为创建初始版本，检测一下重复
        if (params.original_id === 0) {
          await checkMediaRepetition(params);
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
    const ret = Ret.OK_RET;
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
    const params = ctx.query;
    const ret = Ret.OK_RET;
    if (!checkQueryParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, proto_id can not be null' };
    }

    try {
      // total：总数
      // allMID：所有media_id列表，包含main和sub的
      // mainMIDList：main的media_id列表，用来查询
      // mediaInfo: media_id -> media信息的映射
      // mainSubIDs: main的media_id对应的subID列表的映射
      const { total, allMID, mainMIDList, mediaInfo, mainSubIDs } = await queryMedia(params);
      const mediaObj = await queryMediaField(mediaInfo, allMID);

      // 没有规则的，设置一下基础信息
      for (const id of allMID) {
        if (mediaObj.get(id) === undefined) {
          const event = mediaInfo.get(id);
          mediaObj.set(id, {
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
      for (const id of mainMIDList) {
        const subIDs = mainSubIDs.get(id);
        if (subIDs !== undefined) {
          const arr = [];
          for (const subID of subIDs) {
            arr.push(mediaObj.get(subID));
          }
          mediaObj.get(id).children = arr;
        }
        list.push(mediaObj.get(id));
      }
      ret.data = { list, total };
    } catch (err) {
      if (err.ret) return err;
      console.error(err);
      return Ret.UNKNOWN_RET;
    }
    return ret;
  },

  /**
   * 创建流量与事件绑定
   * @url /node-cgi/data-dict/media/create-binding
   */
  async createBinding(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
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
    const ret = Ret.OK_RET;
    if (!checkDeleteBindingParams(params)) {
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
    const params = ctx.query;
    const ret = Ret.OK_RET;
    if (!checkQueryBindingParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, media_id can not be null' };
    }
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

    const replacements = { media_id: params.media_id };
    const subQuerySql = `SELECT * FROM ${TableInfo.TABLE_REL_MEDIA_EVENT} WHERE is_deleted=0 AND media_id=:media_id`;

    let countSql = `SELECT COUNT(*) as cnt FROM (${subQuerySql}) t1 LEFT JOIN ${TableInfo.TABLE_EVENT} t2 ON t1.event_id=t2.id WHERE t2.is_deleted=0`;
    let querySql = `SELECT t2.id, t2.name, t2.category, t2.definition_val, t2.operator, t2.updated_time FROM (${subQuerySql}) t1
      LEFT JOIN ${TableInfo.TABLE_EVENT} t2 ON t1.event_id=t2.id WHERE t2.is_deleted=0`;

    if (params.category !== undefined) {
      querySql += ' AND category=:category';
      countSql += ' AND category=:category';
      replacements.category = params.category;
    }

    if (params.query !== undefined && params.query !== '') {
      querySql += ' AND (t2.name LIKE :fuzzyQuery OR t2.id=:query OR t2.definition_val LIKE :fuzzyQuery)';
      countSql += ' AND (t2.name LIKE :fuzzyQuery OR t2.id=:query OR t2.definition_val LIKE :fuzzyQuery)';
      replacements.query = params.query;
      replacements.fuzzyQuery = `%${params.query}%`;
    }
    querySql += ` LIMIT ${(page - 1) * size}, ${size}`;

    await Promise.all([
      await DBClient.query(querySql, { replacements }),
      await DBClient.query(countSql, { replacements }),
    ])
      .then((promiseRes) => {
        const [[events], [[queryCount]]] = promiseRes;
        const list = [];
        for (const e of events) {
          list.push({
            id: e.id,
            name: e.name,
            category: e.category,
            definition_val: e.definition_val,
            operator: e.operator,
            updated_time: formatTime(e.updated_time),
          });
        }
        ret.data = { list, total: queryCount.cnt };
      })
      .catch((err) => {
        console.error(err);
        throw Ret.INTERNAL_DB_ERROR_RET;
      });
    return ret;
  },
};

function checkCreateParams(params) {
  if (params.proto_id === undefined || params.original_id === undefined || params.name === undefined || params.desc === undefined
    || params.version === undefined || params.definition_val === undefined || params.remark === undefined || params.rule_list === undefined) {
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

function checkDeleteBindingParams(params) {
  if (params.media_id === undefined || params.event_ids === undefined) {
    return false;
  }
  return true;
}

function checkQueryBindingParams(params) {
  if (params.media_id === undefined) {
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

async function createMedia(params) {
  let id = 0;
  try {
    await DBClient.transaction(async (transaction) => {
      // 创建流量源数据
      const querySql = `INSERT INTO ${TableInfo.TABLE_MEDIA}(proto_id, original_id, name, \`desc\`, version, definition_val, md_key, remark, operator)
        VALUES(:proto_id, :original_id, :name, :desc, :version, :definition_val, MD5(:definition_val), :remark, :operator)`;
      const [mediaID] = await DBClient.query(querySql, {
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
      });
      id = mediaID;

      // 创建流量和字段规则的关联
      const insertValue = [];
      const insertRelSql = `INSERT INTO ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION}(media_id, field_verification_id) VALUES`;
      for (const rule_id of params.rule_list.filter(Number.isFinite)) {
        insertValue.push(`(${mediaID}, ${rule_id})`);
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

async function updateMedia(params) {
  try {
    await DBClient.transaction(async (transaction) => {
      // 1. 更新流量源数据
      const querySql = `UPDATE ${TableInfo.TABLE_MEDIA}
        SET proto_id=:proto_id,original_id=:original_id,name=:name,\`desc\`=:desc,version=:version,definition_val=:definition_val,
        md_key=MD5(:definition_val),remark=:remark, operator=:operator
        WHERE id=:id`;
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
          id: params.id,
        },
      });

      // 构造插入values语句
      const insertValue = [];
      for (const rule_id of params.rule_list.filter(Number.isFinite)) {
        insertValue.push(`(${params.id}, ${rule_id})`);
      }

      if (insertValue.length > 0) {
        // 2. 全量ignore插入rel_media_field_verification表，实现没有的新增
        const insertSql = `INSERT IGNORE INTO ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION}(media_id, field_verification_id) VALUES${insertValue.join(',')}`;
        await DBClient.query(insertSql, { transaction });

        // 3. 软删除，media_id所有规则里vid不在传过来的vid的删除
        const deleteSql = `UPDATE ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION} SET is_deleted=1 WHERE media_id=:mediaID AND field_verification_id NOT IN (:ids)`;
        await DBClient.query(deleteSql, {
          replacements: { mediaID: params.id, ids: params.rule_list.filter(Number.isFinite) },
          transaction,
        });
      }
    });
  } catch (err) {
    console.error(err);
    throw Ret.INTERNAL_DB_ERROR_RET;
  }

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

async function queryMedia(params) {
  // 设置参数默认值
  const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
  const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

  // 查询替换参数
  const replacements = { proto_id: params.proto_id };
  let mainQuerySql = `SELECT * FROM ${TableInfo.TABLE_MEDIA} WHERE is_deleted=0 AND original_id=0 AND proto_id=:proto_id LIMIT ${(page - 1) * size}, ${size}`;
  /**
   * SELECT COUNT(*) as cnt FROM data_dict_media
   *    WHERE original_id=0 AND proto_id=1 AND category=0 AND (id=6 OR name LIKE '%6%' OR operator='6')
   */
  let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_MEDIA} WHERE is_deleted=0 AND original_id=0 AND proto_id=:proto_id`;
  if (params.category !== undefined) {
    mainQuerySql += ' AND category=:category';
    countSql += ' AND category=:category';
    replacements.category = params.category;
  }
  if (params.query !== undefined && params.query !== '') {
    mainQuerySql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query)';
    countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query)';
    replacements.query = params.query;
    replacements.fuzzyQuery = `%${params.query}%`;
  }

  let total = 0;
  // 所有的media_id，main和sub的media_id集合
  const allMID = [];
  // main的media_id列表，用来查询所有sub的media_id
  const mainMIDList = [];
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
        mainMIDList.push(mainE.id);
        allMID.push(mainE.id);
        mediaInfo.set(mainE.id, mainE);
      }
    })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });

  /**
   * 查所有主media的所有子media
   * SELECT * FORM media WHERE is_deleted=0 AND original_id IN (1, 2, 3);
   */
  const subQuerySql = `SELECT * FROM ${TableInfo.TABLE_MEDIA} WHERE original_id IN (:ids)`;
  const mainSubIDs = new Map();
  await DBClient.query(subQuerySql, { replacements: { ids: mainMIDList } })
    .then((res) => {
      const [subMedia] = res;
      for (const subM of subMedia) {
        allMID.push(subM.id);
        mediaInfo.set(subM.id, subM);
        if (mainSubIDs.get(subM.original_id) === undefined) {
          mainSubIDs.set(subM.original_id, [subM.id]);
        } else {
          mainSubIDs.get(subM.original_id).push(subM.id);
        }
      }
    })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });

  return { total, allMID, mainMIDList, mediaInfo, mainSubIDs };
}

async function queryMediaField(mediaInfo, allMID) {
/**
   * 关联查字段信息
   * SELECT t1.media_id, t1.field_verification_id, t2.rule_id, t3.name
   *    FROM (SELECT * FROM rel_media_field_verification WHERE is_deleted=0 AND media_id IN (1,2,3)) t1
   *    LEFT JOIN field_verification t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
   *    LEFT JOIN field t3 ON t2.field_id=t3.id AND t3.is_deleted=0
   */
  const fieldQuerySql = `SELECT t1.media_id, t1.field_verification_id, t2.rule_id, t2.verification_value, t3.name
    FROM (SELECT * FROM ${TableInfo.TABLE_REL_MEDIA_FIELD_VERIFICATION} WHERE is_deleted=0 AND media_id IN (${allMID})) t1
    LEFT JOIN ${TableInfo.TABLE_FIELD_VERIFICATION} t2 ON t1.field_verification_id=t2.id AND t2.is_deleted=0
    LEFT JOIN ${TableInfo.TABLE_FIELD} t3 ON t2.field_id=t3.id AND t3.is_deleted=0`;

  // 构造每个返回的media数据
  const mediaObj = new Map();
  await DBClient.query(fieldQuerySql)
    .then(([rules]) => {
      for (const rule of rules) {
        // rule_id为空说明verification信息被删除，name为空说明field信息被删除，一般不会有这种情况，删除的时候都处理了
        if (rule.rule_id !== null && rule.name !== null) {
          // mid没有基础数据，构造基础数据；有基础数据说明是校验规则，push到field_list里面
          if (mediaObj.get(rule.media_id) === undefined) {
            const media = mediaInfo.get(rule.media_id);
            const tmpObj = {
              id: rule.media_id,
              name: media.name,
              desc: media.desc,
              version: media.version,
              definition_val: media.definition_val,
              remark: media.remark,
              operator: media.operator,
              updated_time: formatTime(media.updated_time),
              field_list: [{
                verification_id: rule.field_verification_id,
                field_name: rule.name,
                rule_id: rule.rule_id,
                value: rule.verification_value,
              }],
            };
            mediaObj.set(rule.media_id, tmpObj);
          } else {
            mediaObj.get(rule.media_id).field_list.push({
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
  return mediaObj;
}

module.exports = Media;
