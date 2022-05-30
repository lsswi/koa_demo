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
    // 先建表，同时将其作为分布式锁，如果已经建表说明另一台机器已经在跑定时任务，本机直接return
    await createAndLock();
    // 遍历智研接口所有rule_id
    await fetchRulesAndDump();
  } catch (err) {
    console.error(err);
    return;
  }
}

async function createAndLock() {
  const querySql = `
    CREATE TABLE \`daily_verification_result\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`verification_type\` smallint DEFAULT NULL,
      \`media_id\` int DEFAULT NULL,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;`;
  await DBClient.query(querySql)
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

async function fetchRulesAndDump() {
  await Promise.all([fetchAndDumpHitRules(), fetchAndDumpConflictRules()])
    .then((promiseRes) => {
      // console.log(promiseRes);
      const [hitNums, conflictNums] = promiseRes;
      console.log(hitNums);
      console.log(conflictNums);
    })
    .catch((err) => {
      console.error(err);
    });
}

// 命中的数量
async function fetchAndDumpHitRules() {
  console.log(111111111111111111111111111111111111111);
  const hitNums = new Map();
  // 先拉一次，根据回包的total_num再做分页拉
  const firstReq = formZHIYANChartReq('rh', 1);
  const firstBody = await requestZHIYANChartInfo(firstReq);
  const totalPage = Math.ceil(firstBody.data.total_num / SINGLE_PULL_NUM);
  console.log('【HIT】total num: ', firstBody.data.total_num);

  // rel_id 到 rule_id的映射，后面查DB后填充信息用
  const relID2RuleID = new Map();
  // rel_id 列表，批量查DB用
  const relIDList = [];
  for (const info of firstBody.data.chart_info) {
    const [ruleID] = info.cond.tag_set.ri.val;
    const [numObj] = info.detail_data_list;
    hitNums.set(ruleID, numObj.current);
    const ruleInfo = parseRuleID(ruleID);
    relIDList.push(ruleInfo.rel_id);
    relID2RuleID.set(ruleInfo.rel_id, ruleID);
    console.log('【HIT】rule id: ', ruleID);
    console.log('【HIT】parse result: ', parseRuleID(ruleID));
  }
  await getRelMediaInfo(relIDList);

  for (let i = 1; i < totalPage; i++) {
    const req = formZHIYANChartReq('rh', i + 1);
    const body = await requestZHIYANChartInfo(req);
    for (const info of body.data.chart_info) {
      const [ruleID] = info.cond.tag_set.ri.val;
      const [numObj] = info.detail_data_list;
      hitNums.set(ruleID, numObj.current);
      console.log('【HIT】rule id: ', ruleID);
      console.log('【HIT】parse result: ', parseRuleID(ruleID));
    }
  }

  return hitNums;
}

// 冲突的数量
async function fetchAndDumpConflictRules() {
  const conflictNums = new Map();
  // 先拉一次，根据回包的total_num再做分页拉
  const firstReq = formZHIYANChartReq('rc', 1);
  const firstBody = await requestZHIYANChartInfo(firstReq);
  const totalPage = Math.ceil(firstBody.data.total_num / SINGLE_PULL_NUM);
  console.log('【CONFLICT】total num: ', firstBody.data.total_num);

  for (const info of firstBody.data.chart_info) {
    const [ruleID] = info.cond.tag_set.ri.val;
    const [numObj] = info.detail_data_list;
    conflictNums.set(ruleID, numObj.current);
    console.log('【CONFLICT】parse result: ', parseRuleID(ruleID));
    console.log('【CONFLICT】rule id: ', ruleID);
  }

  for (let i = 1; i < totalPage; i++) {
    const req = formZHIYANChartReq('rh', i + 1);
    const body = await requestZHIYANChartInfo(req);
    for (const info of body.data.chart_info) {
      const [ruleID] = info.cond.tag_set.ri.val;
      const [numObj] = info.detail_data_list;
      conflictNums.set(ruleID, numObj.current);
      console.log('【CONFLICT】rule id: ', ruleID);
      console.log('【CONFLICT】parse result: ', parseRuleID(ruleID));
    }
  }

  return conflictNums;
}

/**
 * type 1:
 * got: rule_id, verification_type, media_id, rel_media_field_verification_id
 * want: rule_id, verification_type, media_id, field_verification_id, field_id, hit_nums, conflict_nums
 */
async function getRelMediaInfo(relIDList) {
  const querySql = `SELECT fv.id, fv.field_id, rel_m_fv.fvid FROM
    (SELECT id, field_verification_id fvid FROM ${TABLE_INFO.TABLE_REL_MEDIA_FIELD_VERIFICATION} WHERE is_deleted=0 AND id IN (${relIDList.join(',')})) rel_m_fv
  LEFT JOIN ${TABLE_INFO.TABLE_FIELD_VERIFICATION} fv ON rel_m_fv.fvid = fv.id`;
  await DBClient.query(querySql)
    .then((res) => {
      console.log(res);
    })
    .catch((err) => {
      throw err;
    });
}


/**
 * type 2:
 * got: rule_id, verification_type, media_id, rel_event_field_verification_id
 * want: rule_id, verification_type, media_id, event_id, field_verification_id, field_id, hit_nums, conflict_nums
 */
async function dumpVerificationMediaEvent(ruleInfo) {

}

/**
 * type 1:
 * got: media_id, rel_media_field_verification_id
 * want: field_
 */
// type 1: media_id, rel_media_field_verification_id
// type 2: media_id, rel_event_field_verifc
async function dumpData(ruleInfo) {
  if (ruleInfo.verification_type === VERIFICATION_TYPE.TYPE_MEDIA) {
    await dumpVerificationMedia(ruleInfo);
    return;
  }

  if (ruleInfo.verification_type === VERIFICATION_TYPE.TYPE_MEDIA_EVENT) {
    await dumpVerificationMediaEvent(ruleInfo);
    return;
  }
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
