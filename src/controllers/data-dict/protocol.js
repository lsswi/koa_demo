const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
const common = require('./common');

// TODO 这里能删协议吗，删了其他的全部都删除？
const Protocol = {
  /**
   * 创建协议
   * @url /node-cgi/data-dict/event/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkCreateParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, param name, proto_type can not be null, category must be int array' };
    }

    try {
      if (params.id) {
        await common.existData(TableInfo.TABLE_PROTOCOL, params.id);
        await updateProto(params);
        ret.data = { id: params.id };
      } else {
        const id = await createProto(params);
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
   * 删除协议
   * @url /node-cgi/data-dict/event/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    if (!checkDeleteParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, param ids must be an int array' };
    }

    const ids = params.ids.filter(Number.isFinite);
    const querySql = `UPDATE ${TableInfo.TABLE_PROTOCOL} SET is_deleted=0 WHERE id IN (:ids)`;
    await DBClient.query(querySql, { replacements: { ids } })
      .then(() => {
        ret.data = { ids };
      })
      .catch((err) => {
        console.error(err);
        return Ret.INTERNAL_DB_ERROR_RET;
      });
    return ret;
  },

  /**
   * 查询协议
   * @url /node-cgi/data-dict/event/query
   */
  async query(ctx) {
    const ret = {
      code: Ret.CODE_OK,
      msg: Ret.MSG_OK,
    };
    const params = ctx.query;
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.page : 10;

    let result = [];
    let querySql = `SELECT * FROM ${TableInfo.TABLE_PROTOCOL}`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_PROTOCOL}`;

    const replacements = {};
    if (params.query !== '' && params.query !== undefined) {
      querySql += ' WHERE is_deleted=0 AND id=:query OR name LIKE :fuzzyQuery OR operator=:query';
      countSql += ' WHERE is_deleted=0 AND id=:query OR name LIKE :fuzzyQuery OR operator=:query';
      replacements.query = params.query,
      replacements.fuzzyQuery = `%${params.query}%`;
    }
    querySql += ` LIMIT ${page - 1},${size}`;

    result = Promise.all([
      DBClient.query(querySql, { replacements }),
      DBClient.query(countSql, { replacements }),
    ]);
    await result
      .then((promiseRes) => {
      // promiseALl返回两个查询的结果，sql返回的是两个元素的数组，内容基本一样，直接取第一个即可
      // 参考 https://sequelize.org/v7/manual/raw-queries.html
        // const queryResult = promiseRes[0][0];
        // const queryCount = promiseRes[1][0][0].cnt;
        const [[queryResult], [[queryCount]]] = promiseRes;
        const list = [];
        for (const proto of queryResult) {
          list.push({
            id: proto.id,
            name: proto.name,
            desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
            operator: proto.operator,
            category: proto.category.split(',').map(id => parseInt(id, 10)),
            updated_time: formatTime(proto.updated_time),
          });
        }
        ret.data = { list };
        ret.total = queryCount.cnt;
      })
      .catch((err) => {
        console.error(err);
        return Ret.INTERNAL_DB_ERROR_RET;
      });
    return ret;
  },
};

async function createProto(params) {
  let id = 0;
  const querySql = `INSERT INTO ${TableInfo.TABLE_PROTOCOL}(name, proto_type, category, \`desc\`, operator)
    VALUES(:name, :protoType, :category, :desc, :operator)`;
  await DBClient.query(querySql, {
    replacements: {
      name: params.name,
      protoType: params.proto_type,
      category: params.category.join(','),
      desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
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

async function updateProto(params) {
  const querySql = `UPDATE ${TableInfo.TABLE_PROTOCOL} SET
    name=:name,proto_type=:proto_type,category=:category,\`desc\`=:desc,operator=:operator
    WHERE id=:id`;
  await DBClient.query(querySql, {
    replacements: {
      name: params.name,
      proto_type: params.proto_type,
      category: params.category.join(','),
      desc: params.desc,
      // operator: ctx.session.user.loginname,
      operator: 'joyyieli',
      id: params.id,
    },
  })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

function checkCreateParams(params) {
  if (params.name === undefined || params.category === undefined || params.proto_type === undefined || params.desc === undefined) {
    return false;
  }
  return true;
}

function checkDeleteParams(params) {
  if (!Array.isArray(params.ids)) {
    return false;
  }
  return true;
}

module.exports = Protocol;
