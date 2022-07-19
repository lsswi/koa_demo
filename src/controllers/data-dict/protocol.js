const DBLib = require('../../lib/mysql');
const DBClient = DBLib.getDBPool();
const { Ret, TableInfo } = require('./const');
const { DateLib: { formatTime } } = require('../../utils/date');
const common = require('./common');
const moment = require('moment');

function ccc(d) {
  if (d === 2) {
    return true;
  }
  return false;
}

function bbb(d) {
  if (d === 1) {
    return true;
  }
  return false;
}

function parseRuleID(ruleID) {
  const bNum = parseInt(ruleID, 10).toString(2);
  // 二进制
  const typebNum = bNum.substring(bNum.length - 36, bNum.length - 36 + 4);
  // 十进制
  const typeDeNum = parseInt(typebNum, 2);
  return {
    rule_id: ruleID,
    verification_type: typeDeNum,
    media_id: (ruleID >> 16) & 0xffff,
    rel_id: ruleID & 0xffff,
  };
}

async function c(transaction) {
  const querySql1 = 'INSERT INTO data_dict_rel_media_event(media_id, event_id ,operator) VALUES(100, 200, \'abc\')';
  await DBClient.query(querySql1, { transaction });
}

async function d(transaction) {
  const querySql = 'SELECT 1';
  await DBClient.query(querySql, { transaction });
}

function getRet() {
  const mp1 = new Map();
  mp1.set('1', 'ddd');
  const mp2 = new Map();
  mp2.set('2', 'ccc');
  const mp3 = new Map();
  mp3.set('3', 'bbb');
  return {
    mp1,
    mp2,
    mp3,
    name: 'haha',
  };
}

function sortConflictRate(arr, tmpObj) {
  let ret = arr;
  // 没有
  if (ret.length === 0) {
    ret.push(tmpObj);
    return ret;
  }
  for (let i = 0; i < ret.length; i++) {
    if (i + 1 === ret.length) {
      if (tmpObj.rate < ret[i].rate) {
        ret = [...ret, tmpObj];
      } else {
        console.log('11111', ret);
        ret = [...ret.slice(0, i), tmpObj, ret[ret.length - 1]];
      }
      return ret;
    }
    if (tmpObj.rate > ret[i].rate) {
      ret = [...ret.slice(0, i), tmpObj, ...ret.slice(i, ret.length)];
      return ret;
    }
    if (tmpObj.rate <= ret[i].rate && tmpObj.rate >= ret[i + 1].rate) {
      ret = [...ret.slice(0, i + 1), tmpObj, ...ret.slice(i + 1, ret.length)];
      return ret;
    }
  }
}

function ddaa(arr) {
  arr.push(123);
  arr.push(111);
}

async function queryMediaFvID(mID) {
  const list = [];
  const sql = `SELECT field_verification_id FROM data_dict_rel_media_field_verification
    WHERE is_deleted=0
    AND media_id=${mID}`;
  await DBClient.query(sql)
    .then(([res]) => {
      for (const obj of res) {
        list.push(obj.field_verification_id);
      }
    })
    .catch((err) => {
      console.error(err);
      throw err;
    });
  return list;
}

const Protocol = {
  /**
   * 排序校验规则列表，把默认规则放到最前面
   */
  sortVerificationList(verificationList) {
    let defaultIndex = 0;
    for (let i = 0; i < verificationList.length; i++) {
      if (verificationList[i].rule_id === 7) {
        defaultIndex = i;
      }
    }
    const list = [];
    list.push(verificationList[defaultIndex]);
    list.push(...verificationList.slice(0, defaultIndex));
    // 不是最后一位
    if (defaultIndex + 1 !== verificationList.length) {
      list.push(...verificationList.slice(defaultIndex + 1, verificationList.length + 1));
    }
    return list;
  },

  async hello(ctx) {
    // const arr = [{ rate: 2 }, { rate: 5 }, { rate: 4 }];
    // let tmpArr = [];
    // for (const obj of arr) {
    //   tmpArr = sortConflictRate(tmpArr, obj);
    //   console.log(tmpArr);
    // }
    // console.log(arr);
    console.log(await queryMediaFvID(1));
    console.log(parseRuleID(77310526005));
  },

  /**
   * 创建协议
   * @url /node-cgi/data-dict/protocol/create
   */
  async create(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    const errMsg = common.checkCreateParams(params, ['name', 'category', 'proto_type', 'desc']);
    if (errMsg.length !== 0) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: errMsg };
    }

    try {
      if (params.id) {
        await common.existData(TableInfo.TABLE_PROTOCOL, params.id);
        // await updateProto(ctx.session.user.loginname, params);
        await updateProto('joyyieli', params);
        ret.data = { id: params.id };
      } else {
        // const id = await createProto(ctx.session.user.loginname, params);
        const id = await createProto('joyyieli', params);
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
   * @url /node-cgi/data-dict/protocol/delete
   */
  async delete(ctx) {
    const params = ctx.request.body;
    const ret = Ret.OK_RET;
    if (!checkDeleteParams(params)) {
      return { ret: Ret.CODE_PARAM_ERROR, msg: 'params error, param ids must be an int array' };
    }

    const ids = params.ids.filter(Number.isFinite);
    const querySql = `UPDATE ${TableInfo.TABLE_PROTOCOL} SET is_deleted=1 WHERE id IN (:ids)`;
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
   * @url /node-cgi/data-dict/protocol/query
   */
  async query(ctx) {
    const ret = Ret.OK_RET;
    const params = ctx.query;
    const page = Object.prototype.hasOwnProperty.call(params, 'page') ? params.page : 1;
    const size = Object.prototype.hasOwnProperty.call(params, 'size') ? params.size : 10;

    let result = [];
    let querySql = `SELECT * FROM ${TableInfo.TABLE_PROTOCOL} WHERE is_deleted=0`;
    let countSql = `SELECT COUNT(*) as cnt FROM ${TableInfo.TABLE_PROTOCOL} WHERE is_deleted=0`;

    const replacements = {};
    if (params.query !== '' && params.query !== undefined) {
      querySql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query)';
      countSql += ' AND (id=:query OR name LIKE :fuzzyQuery OR operator=:query)';
      replacements.query = params.query,
      replacements.fuzzyQuery = `%${params.query}%`;
    }
    querySql += ` LIMIT ${(page - 1) * size},${size}`;

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
        ret.data = { total: queryCount.cnt, list };
      })
      .catch((err) => {
        console.error(err);
        return Ret.INTERNAL_DB_ERROR_RET;
      });
    return ret;
  },
};

async function createProto(operator, params) {
  let id = 0;
  const querySql = `INSERT INTO ${TableInfo.TABLE_PROTOCOL}(name, proto_type, category, \`desc\`, operator)
    VALUES(:name, :protoType, :category, :desc, :operator)`;
  await DBClient.query(querySql, {
    replacements: {
      operator,
      name: params.name,
      protoType: params.proto_type,
      category: params.category.join(','),
      desc: Object.prototype.hasOwnProperty.call(params, 'desc') ? params.desc : '',
    },
  })
    .then(([res]) => id = res)
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
  return id;
}

async function updateProto(operator, params) {
  const querySql = `UPDATE ${TableInfo.TABLE_PROTOCOL} SET
    name=:name,proto_type=:proto_type,category=:category,\`desc\`=:desc,operator=:operator
    WHERE id=:id`;
  await DBClient.query(querySql, {
    replacements: {
      operator,
      name: params.name,
      proto_type: params.proto_type,
      category: params.category.join(','),
      desc: params.desc,
      id: params.id,
    },
  })
    .catch((err) => {
      console.error(err);
      throw Ret.INTERNAL_DB_ERROR_RET;
    });
}

function checkDeleteParams(params) {
  if (!Array.isArray(params.ids)) {
    return false;
  }
  return true;
}

module.exports = Protocol;
