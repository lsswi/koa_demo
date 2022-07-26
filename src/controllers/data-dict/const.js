const RET = {
  CODE_PARAM_ERROR: 40001,
  CODE_EXISTED: 40002,
  CODE_NOT_EXISTED: 40003,

  OK_RET: { ret: 0, msg: 'ok' },
  INTERNAL_DB_ERROR_RET: { ret: 50000, msg: 'internal db error' },
  HTTP_RESP_INVALID: { ret: 50001, msg: 'invalid http rsp' },
  UNKNOWN_RET: { ret: 60000, msg: 'unkonw error' },
};

const TABLE_INFO = {
  TABLE_PROTOCOL: 'data_dict_protocol',
  TABLE_FIELD: 'data_dict_field',
  TABLE_EVENT: 'data_dict_event',
  TABLE_MEDIA: 'data_dict_media',
  TABLE_FIELD_VERIFICATION: 'data_dict_field_verification',
  TABLE_REL_MEDIA_EVENT: 'data_dict_rel_media_event',
  TABLE_REL_MEDIA_FIELD_VERIFICATION: 'data_dict_rel_media_field_verification',
  TABLE_REL_EVENT_FIELD_VERIFICATION: 'data_dict_rel_event_field_verification',
  TABLE_DAILY_DUMP_VERIFICATION: 'data_dict_daily_verification_result',
};

const RULE_TYPE = {
  RULE_STR_NOT_NULL: 1,
  RULE_NUM_NOT_ZERO: 2,
  RULE_MSTS: 3,
  RULE_RANGE: 4,
  RULE_ENUM: 5,
  RULE_VALUE_EQUA: 6,
  RULE_DEFAULT: 7,
};

const BIZ_URL = {
  QUERY_ZHIYAN_CHART_DATA: 'http://openapi.zhiyan.oa.com/monitor/v2/api/chart/info/query',
  ROBOT_ALERT: 'http://in.qyapi.weixin.qq.com/cgi-bin/webhook/send?key=dbcc3206-1d7a-476b-890a-6aaa4b7d2bb7',
};

const BIZ_CONST = {
  ZHIYAN_SINGLE_PULL_NUM: 200,
  DB_QUERY_SIGNLE_NUM: 1000,
  DB_INSERT_SIGNLE_NUM: 200,
};

const FIELD_TAG = {
  TAG_COMMON: 1,
  TAG_EVENT: 2,
};

module.exports = { RET, TABLE_INFO, RULE_TYPE, BIZ_URL, BIZ_CONST, FIELD_TAG };
