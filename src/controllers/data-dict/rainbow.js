const { Rainbow } = require('@tencent/rainbow-node-sdk');
// const { RAINBOW } = require('../../../keys-config');

// const rainbow = new Rainbow({
//   connectStr: 'http://api.rainbow.oa.com:8080',
//   isUsingLocalCache: true,
//   isUsingFileCache: true,
// });

// const opts = {
//   appID: 'c2a6d8ca-50b4-4227-9ddf-f9b055875813',
//   envName: process.env.NODE_ENV.toLowerCase() === 'development' || process.env.NODE_ENV.toLowerCase() === 'test' ? 'TEST' : 'Default',
//   group: 'data_dict',
//   userID: RAINBOW.userID,
//   secretKey: RAINBOW.secretKey,
// };

// async function initDataDictRainbow() {
//   await rainbow.addWatcher(opts, async () => {});
// }

// async function getCommonConf() {
//   const conf = await rainbow.get('const_conf', opts);
//   const constConf = JSON.parse(conf);
//   return constConf.common;
// }

// async function getProtoConf(protoID) {
//   const conf = await rainbow.get('const_conf', opts);
//   const constConf = JSON.parse(conf);
//   for (const protoObj of constConf.protocol_based) {
//     if (protoObj.protocol_id === parseInt(protoID, 10)) {
//       return protoObj;
//     }
//   }
// }

// module.exports = {
//   initDataDictRainbow,
//   getCommonConf,
//   getProtoConf,
//   rainbow,
//   opts,
// };
