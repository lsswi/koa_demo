const Ret = {
  CodeOK: 0,
  CodeParamError: 40001,
  CodeExisted: 40002,
  CodeInternalDBError: 50000,

  MsgOK: 'ok',
  MsgInternalDBError: 'internal db error',
};

const TableInfo = {
  TableProtocol: 'data_dict_protocol',
  TableField: 'data_dict_field',
  TableEvent: 'data_dict_event',
  TableMedia: 'data_dict_media',
  TableFieldVerification: 'data_dict_field_verification',
};

module.exports = { Ret, TableInfo };
