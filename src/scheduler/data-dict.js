const DBLib = require('../lib/mysql');
const DBClient = DBLib.getDBPool();
const moment = require('moment');
const request = require('request');
const { parseRuleID } = require('../utils/id-parser');
const { TABLE_INFO } = require('../controllers/data-dict/const');

const ZHIYAN_CHART_DATA_URL = 'http://openapi.zhiyan.oa.com/monitor/v2/api/chart/info/query';
const SINGLE_PULL_NUM = 10;
const VERIFICATION_TYPE = {
  TYPE_MEDIA: 1,
  TYPE_MEDIA_EVENT: 2,
};

async function dumpVerificationResult() {
  try {
    await DBClient.transaction(async (transaction) => {
      // 先建表，同时将其作为分布式锁，如果已经建表说明另一台机器已经在跑定时任务，本机直接return
      await createAndLock(transaction);
      // 遍历智研接口所有rule_id
      await fetchAndDumpRules(transaction);
    });
  } catch (err) {
    console.error(err);
    return;
  }
}

async function createAndLock(transaction) {
  const querySql = `
  CREATE TABLE ${`daily_verification_result_${moment().subtract(1, 'days').startOf('day').format('YYYY_MM_DD')}`} (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`rule_id\` bigint DEFAULT NULL,
    \`verification_type\` smallint DEFAULT NULL,
    \`media_id\` int DEFAULT NULL,
    \`event_id\` int DEFAULT NULL,
    \`filed_verification_id\` int DEFAULT NULL,
    \`field_id\` int DEFAULT NULL,
    \`hit_nums\` bigint DEFAULT NULL,
    \`conflict_nums\` bigint DEFAULT NULL,
    \`created_time\` datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  await DBClient.query(querySql, { transaction })
    .then((res) => {
      console.log('succ: ', res);
    })
    .catch((err) => {
      if (!err.original && err.original_code === 'ER_TABLE_EXISTS_ERROR') {
        throw 'task has ran on another machine, skip this time';
      } else {
        throw err;
      }
    });
}

async function fetchAndDumpRules(transaction) {
  // 每行信息的obj
  const insertList = [];
  await Promise.all([fetchHitInfo(transaction), fetchConflictInfo()])
    .then((promiseRes) => {
      // console.log(promiseRes);
      // hitInfo: rule_id -> {rel_id, verification_type, media_id, event_id(option), fvid, field_id, hit_nums}
      // conflictNums: rule_id -> hit_nums
      const [hitInfo, conflictNums] = promiseRes;

      // 以hitInfo为基准遍历，填充conflictNums数据
      // k为rule_id
      for (const [k, v] of hitInfo) {
        const copyObj = Object.assign({}, v);
        copyObj.rule_id = k;
        if (conflictNums.get(k)) {
          copyObj.conflict_nums = conflictNums.get(k);
        }
        insertList.push(copyObj);
      }
    })
    .catch((err) => {
      throw err;
    });
  // 此时hitInfo已具备所有信息，可以dump到DB里
  await dumpHitAndConflictInfo(insertList, transaction);
}

async function dumpHitAndConflictInfo(insertList, transaction) {
  const insertValues = [];
  const totalNums = Math.ceil(insertValues.length / SINGLE_PULL_NUM);
  for (let i = 0; i < totalNums; i++) {
    for (const obj of insertList.slice(i * SINGLE_PULL_NUM, (i + 1) * SINGLE_PULL_NUM)) {
      insertValues.push(`(${obj.rule_id}, ${obj.verification_type}, ${obj.media_id}, ${obj.event_id ? obj.event_id : 0},
        ${obj.field_verification_id}, ${obj.field_id}, ${obj.hit_nums}, ${obj.conflcit_nums ? obj.conflict_nums : 0})`);
    }
    const insertSql = `INSERT INTO ${`daily_verification_result_${moment().subtract(1, 'days').startOf('day').format('YYYY_MM_DD')}`}
    (rule_id, verification_type, media_id, event_id, field_verification_id, field_id, hit_nums, conflict_nums) VALUES ${insertValues.join(',')}`;
    await DBClient.query(insertSql, { transaction });
  }
}

// 拉取命中相关信息
// 这里返回rule_id -> {verification_type, fvid, field_id, media_id, event_id(option), hit_nums}信息
// 上层再通过rule_id整合conflict_nums信息
async function fetchHitInfo(transaction) {
  // 命中信息
  const hitInfo = new Map();
  // rel_id 到 rule_id的映射，后面查DB后填充信息用
  const relID2RuleID = new Map();
  // rel_id 列表，批量查DB用
  const relMeidaIDList = [];
  // rel_id 列表，批量查DB用
  const relMeidaEventIDList = [];
  await fetchDataFromZHIYAN(hitInfo, relMeidaIDList, relID2RuleID, relMeidaEventIDList);

  // rule_id -> {rel_id, verification_type, media_id, event_id(option), fvid, field_id}的映射
  const ruleInfo = new Map();
  // 这里能拉到 rel_id 映射的 fvid, field_id等信息
  await Promise.All([getRelMediaInfo(relMeidaIDList, transaction), getRelMediaEventInfo(relMeidaEventIDList, transaction)])
    .then((promiseRes) => {
      // rel_id -> fv_id, field_id, event_id的映射
      const [relMeidaInfo, relMediaEventInfo] = promiseRes;
      // 遍历每一项relInfo，构造rule_id -> {rel_id, verification_type, media_id, event_id(option), fvid, field_id}的映射
      for (const [k, v] of relMeidaInfo) {
        const ruleID = relID2RuleID.get(k);
        const hitObj = hitInfo.get(ruleID);
        ruleInfo.set(ruleID, {
          rel_id: k,
          varification_type: v.verification_type,
          media_id: hitObj.media_id,
          field_verification_id: v.field_verification_id,
          field_id: v.field_id,
        });
      }
      for (const [k, v] of relMediaEventInfo) {
        const ruleID = relID2RuleID.get(k);
        const hitObj = hitInfo.get(ruleID);
        ruleInfo.set(ruleID, {
          rel_id: k,
          varification_type: v.verification_type,
          media_id: hitObj.media_id,
          event_id: v.event_id,
          field_verification_id: v.field_verification_id,
          field_id: v.field_id,
        });
      }
    })
    .catch((err) => {
      throw err;
    });

  return ruleInfo;
}

async function fetchDataFromZHIYAN(hitInfo, relMeidaIDList, relID2RuleID, relMeidaEventIDList) {
  // 先拉一次，根据回包的total_num再做分页拉
  const firstReq = formZHIYANChartReq('rh', 1);
  const firstBody = await requestZHIYANChartInfo(firstReq);
  const totalPage = Math.ceil(firstBody.data.total_num / SINGLE_PULL_NUM);
  console.log('【HIT】total num: ', firstBody.data.total_num);
  for (const info of firstBody.data.chart_info) {
    const [ruleID] = info.cond.tag_set.ri.val;
    const [numObj] = info.detail_data_list;
    const ruleIDInfo = parseRuleID(ruleID);
    hitInfo.set(ruleID, {
      media_id: ruleIDInfo.media_id,
      nums: numObj.current,
    });
    if (ruleIDInfo.verification_type === VERIFICATION_TYPE.TYPE_MEDIA) {
      relMeidaIDList.push(ruleIDInfo.rel_id);
    }
    if (ruleIDInfo.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT) {
      relMeidaEventIDList.push(ruleIDInfo.rel_id);
    }
    relID2RuleID.set(ruleIDInfo.rel_id, ruleID);
  }

  for (let i = 1; i < totalPage; i++) {
    const req = formZHIYANChartReq('rh', i + 1);
    const body = await requestZHIYANChartInfo(req);
    for (const info of body.data.chart_info) {
      const [ruleID] = info.cond.tag_set.ri.val;
      const [numObj] = info.detail_data_list;
      const ruleIDInfo = parseRuleID(ruleID);
      hitInfo.set(ruleID, {
        media_id: ruleIDInfo.media_id,
        nums: numObj.current,
      });
      if (ruleIDInfo.verification_type === VERIFICATION_TYPE.TYPE_MEDIA) {
        relMeidaIDList.push(ruleIDInfo.rel_id);
      }
      if (ruleIDInfo.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT) {
        relMeidaEventIDList.push(ruleIDInfo.rel_id);
      }
      relID2RuleID.set(ruleIDInfo.rel_id, ruleID);
    }
  }
}

// 冲突的数量
// 返回一个rule_id -> nums的map即可，其他信息都在hit中查好了
async function fetchConflictInfo() {
  const conflictNums = new Map();
  // 先拉一次，根据回包的total_num再做分页拉
  const firstReq = formZHIYANChartReq('rc', 1);
  const firstBody = await requestZHIYANChartInfo(firstReq);
  const totalPage = Math.ceil(firstBody.data.total_num / SINGLE_PULL_NUM);

  for (const info of firstBody.data.chart_info) {
    const [ruleID] = info.cond.tag_set.ri.val;
    const [numObj] = info.detail_data_list;
    conflictNums.set(ruleID, numObj.current);
  }

  for (let i = 1; i < totalPage; i++) {
    const req = formZHIYANChartReq('rh', i + 1);
    const body = await requestZHIYANChartInfo(req);
    for (const info of body.data.chart_info) {
      const [ruleID] = info.cond.tag_set.ri.val;
      const [numObj] = info.detail_data_list;
      conflictNums.set(ruleID, numObj.current);
    }
  }
  return conflictNums;
}

/**
 * type 1:
 * got: rule_id, verification_type, media_id, rel_media_field_verification_id
 * want: rule_id, verification_type, media_id, field_verification_id, field_id, hit_nums, conflict_nums
 */
async function getRelMediaInfo(relIDList, transaction) {
  const relInfo = new Map();
  const querySql = `SELECT rel_m_fv.id, rel_m_fv.fvid, fv.field_id FROM
  (SELECT id, field_verification_id as fvid FROM ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION} WHERE is_deleted=0 AND id IN (${relIDList.join(',')})) rel_m_fv
  LEFT JOIN ${TABLE_INFO.TABLE_FIELD_VERIFICATION} fv ON rel_m_fv.fvid = fv.id`;
  await DBClient.query(querySql, { transaction })
    .then((res) => {
      for (const obj of res) {
        relInfo.set(obj.id, {
          field_verification_id: obj.fvid,
          field_id: obj.field_id,
          verification_type: VERIFICATION_TYPE.TYPE_MEDIA,
        });
      }
    })
    .catch((err) => {
      throw err;
    });
  // 返回一个rel_id -> {fvid, field_id}的map
  return relInfo;
}


/**
 * type 2:
 * got: rule_id, verification_type, media_id, rel_event_field_verification_id
 * want: rule_id, verification_type, media_id, event_id, field_verification_id, field_id, hit_nums, conflict_nums
 */
async function getRelMediaEventInfo(relIDList, transaction) {
  const relInfo = new Map();
  const querySql = `SELECT rel_e_fv.id, rel_e_fv.eid, rel_e_fv.fvid, fv.field_id FROM
  (SELECT id, event_id AS eid, field_verification_id AS fvid FROM ${TABLE_INFO.TABLE_REL_EVENT_FIELD_VERIFICATION} WHERE is_deleted = 0 AND id IN (${relIDList.join(',')})) rel_e_fv
  LEFT JOIN {$TABLE_INFO.TABLE_FIELD_VERIFICATION} fv ON rel_e_fv.fvid = fv.id`;
  await DBClient.query(querySql, { transaction })
    .then(([res]) => {
      for (const obj of res) {
        relInfo.set(obj.id, {
          event_id: obj.eid,
          field_verification_id: obj.fvid,
          field_id: obj.field_id,
          verification_type: VERIFICATION_TYPE.TYPE_MEDIA_EVENT,
        });
      }
    })
    .catch((err) => {
      throw err;
    });
  // 返回一个rel_id -> {event_id, fvid, field_id}的map
  return relInfo;
}

function requestZHIYANChartInfo(req) {
  return new Promise((resolve, reject) => {
    request.post(ZHIYAN_CHART_DATA_URL, req, (err, _res, body) => {
      if (err) {
        reject(err);
      }
      resolve(body);
    });
  });
}

function formZHIYANChartReq(metric, page) {
  return  {
    body: {
      app_mark: '2379_37253_rule_matcher',
      sec_lvl_name: 'rules',
      env: 'prod',
      is_english: 'yes',
      is_together: false,
      // 全部rule_id数据
      tag_set: [
        {
          key: 'ri',
          value: [],
        },
      ],
      metric_name: metric,
      // 前一天数据
      begin_time: moment().subtract(1, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss'),
      end_time: moment().subtract(1, 'days').endOf('day').format('YYYY-MM-DD HH:mm:ss'),
      gap: 1440,
      page_num: page,
      limit: SINGLE_PULL_NUM,
    },
    headers: {
      token: 'dd7611ae9089f97529f98b968b442732',
      projectname: 'xq-hawkeye-monitor',
      appname: 'rule_matcher',
      'Content-Type': 'application/json',
    },
    json: true,
  };
}

module.exports = {
  dumpVerificationResult,
};
