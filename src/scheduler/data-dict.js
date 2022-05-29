const DBLib = require('../lib/mysql');
const DBClient = DBLib.getDBPool();
const moment = require('moment');
const request = require('request');
const { parseRuleID } = require('../utils/id-parser');

const ZHIYAN_CHART_DATA_URL = 'http://openapi.zhiyan.oa.com/monitor/v2/api/chart/info/query';
const SINGLE_PULL_NUM = 10;

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
  // const curNums = 0;
  // 拉命中数据
  // 先拉一次，根据回包的total_num再做分页拉
  const firstReq = formZHIYANChartReq('rh', 1);
  const firstBody = await requestZHIYANChartInfo(firstReq);
  const totalPage = Math.ceil(firstBody.data.total_num / SINGLE_PULL_NUM);
  console.log(firstBody.data.total_num);
  console.log(totalPage);

  for (const info of firstBody.data.chart_info) {
    const [ruleID] = info.cond.tag_set.ri.val;
    console.log(ruleID);
    console.log(parseRuleID(ruleID));
  }

  for (let i = 1; i < totalPage; i++) {
    const req = formZHIYANChartReq('rh', i + 1);
    const body = await requestZHIYANChartInfo(req);
    for (const info of body.data.chart_info) {
      const [ruleID] = info.cond.tag_set.ri.val;
      const [numObj] = info.detail_data_list;
      console.log('rule_id: ', ruleID);
      console.log('num: ', numObj.current);
      console.log(parseRuleID(ruleID));
    }
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
