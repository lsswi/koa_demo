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
      ret.code = Ret.CODE_PARAM_ERROR,
      ret.msg = 'params error, proto_id can not be null';
      return ret;
    }
    // 设置参数默认值
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

    /**
     * SELECT t2.*, t1.id as sub_id, t1.desc as sub_desc, t1.updated_time as sub_time FROM (
		 *   SELECT * FROM data_dict_event
		 *     WHERE proto_id=1 AND category=0 AND (id=6 OR name LIKE '%6%' OR operator='6' OR definition_val LIKE '%6%')
		 *     LIMIT 0, 3
	   * ) t2
	   * LEFT JOIN data_dict_event t1 ON t1.original_id=t2.id order by t2.id;
     */
    let querySql = `SELECT * FROM ${TableInfo.TABLE_EVENT} WHERE original_id=0 AND proto_id=:proto_id`;
    /**
     * SELECT COUNT(*) as cnt FROM data_dict_event
     *   WHERE original_id=0 AND proto_id=1 AND category=0 AND (id=6 OR name LIKE '%6%' OR operator='6' OR definition_val LIKE '%6%')
     */
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_EVENT} WHERE original_id=0 AND proto_id=:proto_id`;

    let result = [];
    const replacements = {
      proto_id: params.proto_id,
    };

    if (params.category !== undefined) {
      querySql += ' AND category=:category';
      countSql += ' AND category=:category';
      replacements.category = params.category;
    }

    if (params.query !== undefined && params.query !== '') {
      querySql += ` AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query OR definition_val LIKE :fuzzyQuery) LIMIT ${(page - 1) * size}, ${size}`;
      countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query OR definition_val LIKE :fuzzyQuery)';
      replacements.query = params.query;
      replacements.fuzzyQuery = `%${params.query}%`;
    }

    const fatherSql = `SELECT t2.*, t1.id as sub_id, t1.desc as sub_desc, t1.updated_time as sub_time, t1.operator as sub_operator
      FROM(${querySql}) t2
      LEFT JOIN ${TableInfo.TABLE_EVENT} t1 ON t1.original_id=t2.id ORDER BY t2.id`;
    result = Promise.all([
      DBClient.query(fatherSql, { replacements }),
      DBClient.query(countSql, { replacements }),
    ]);

    await result.then((promiseRes) => {
      const [[queryResult], [[queryCount]]] = promiseRes;
      // 构造original_id=0数据+sub数据的数组内容
      // 因为是left join，所以每个id第一条数据如果是undefined，说明只有本身一条数据；如果第一条不为undefined数据，说明至少有包含自身的2条或以上数据
      const list = [];
      const idMap = new Map();
      for (const event of queryResult) {
        if (idMap.get(event.id) === undefined) {
          const tmpObj = {
            id: event.id,
            proto_id: event.proto_id,
            category: event.category,
            name: event.name,
            desc: event.desc,
            definition_val: event.definition_val,
            reporting_timing: event.reporting_timing,
            operator: event.operator,
            updated_time: formatTime(event.updated_time),
            sub: [],
          };
          if (event.sub_id !== null) {
            tmpObj.sub.push({
              id: event.sub_id,
              desc: event.sub_desc,
              operator: event.sub_operator,
              updated_time: formatTime(event.sub_time),
            });
          }
          idMap.set(event.id, tmpObj);
        } else {
          idMap.get(event.id).sub.push({
            id: event.sub_id,
            desc: event.sub_desc,
            operator: event.sub_operator,
            updated_time: formatTime(event.sub_time),
          });
        }
      }

      // 按查询出来的顺序塞进返回的数组里，去重一下
      const idSet = new Set();
      for (const event of queryResult) {
        if (!idSet.has(event.id)) {
          list.push(idMap.get(event.id));
          idSet.add(event.id);
        }
      }
      ret.data = { list, total: queryCount.cnt };
      console.log(list);
    }).catch((err) => {
      console.error(err);
      ret.code = Ret.CODE_INTERNAL_DB_ERROR;
      ret.msg = Ret.MSG_INTERNAL_DB_ERROR;
    });

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
