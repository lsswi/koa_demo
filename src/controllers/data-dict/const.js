const Ret = {
  CODE_OK: 0,
  CODE_PARAM_ERROR: 40001,
  CODE_EXISTED: 40002,
  CODE_NOT_EXISTED: 40003,
  CODE_INTERNAL_DB_ERROR: 50000,

  MSG_OK: 'ok',
  MSG_INTERNAL_DB_ERROR: 'internal db error',
};

const TableInfo = {
  TABLE_PROTOCOL: 'data_dict_protocol',
  TABLE_FIELD: 'data_dict_field',
  TABLE_EVENT: 'data_dict_event',
  TABLE_MEDIA: 'data_dict_media',
  TABLE_FIELD_VERIFICATION: 'data_dict_field_verification',
};

module.exports = { Ret, TableInfo };
