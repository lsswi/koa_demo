const RET = {
  CODE_PARAM_ERROR: 40001,
  CODE_EXISTED: 40002,
  CODE_NOT_EXISTED: 40003,

  OK_RET: { ret: 0, msg: 'ok' },
  INTERNAL_DB_ERROR_RET: { ret: 50000, msg: 'internal db error' },
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
};

module.exports = { RET, TABLE_INFO };
