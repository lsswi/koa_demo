const DBLib = require("../../lib/mysql");
const DBClient = DBLib.getDBPool();

const TableInfo = {
  TableProtocol: "data_dict_protocol",
};

const Protocol = {
  /**
   * 创建协议
   * @url /node-cgi/data-dict/event/create
   * @param params {Object} 请求参数
   * @return string
   */
  Create(params) {
    const querySql = `INSERT INTO ${TableInfo.TableProtocol}(name, proto_type, desc, operator) VALUES(:name, :protoType, :desc, 'joyyieli')`;
    console.log(querySql);
    console.log(params.name);
    console.log(params.proto_type);
    console.log(params.desc);
    DBClient.query(querySql, {
      replacements: { name: "abcd", val: str, key: mdKey },
    });
    return "ok";
  },

  /**
   * 删除协议
   * @url /node-cgi/data-dict/event/delete
   */
  Delete() {},

  /**
   * 编辑协议
   * @url /node-cgi/data-dict/event/edit
   */
  Edit() {},

  /**
   * 查询协议
   * @url /node-cgi/data-dict/event/query
   */
  Query() {},
};

module.exports = Protocol;

// async get() {
//   let abc = {
//     def_val: [
//       {
//         id: 1,
//         value: 2,
//       },
//     ],
//   };
//   let str = JSON.stringify(abc);
//   console.log(str);
//   let mdKey = md5(str);
//   // INSERT INTO data_dict_event (name) VALUES("hi");
//   // const [a, b] = await db.query("SELECT * FROM data_dict_event");
//   await db
//     // .query("DELETE FROM data_dict_event WHERE id=5")
//     // .query("UPDATE data_dict_event SET name = 'hhh' WHERE name = :name", {
//     // replacements: { name: name },
//     // })
//     .query(
//       "INSERT INTO data_dict_event(proto_id, name, definition_val, md_key) VALUES(1, '测试', :val, :key)",
//       {
//         replacements: { name: "abcd", val: str, key: mdKey },
//       }
//     )
//     // .query("SELECT * FROM data_dict_event WHERE md_key = :def", {
//     //   replacements: { def: name },
//     // })
//     .then(([a, b]) => {
//       console.log("get result a: ", a);
//       console.log("get type of result a: ", typeof a);
//       console.log("get result b: ", b);
//       console.log("get type of result b: ", typeof b);
//     })
//     .catch((err) => {
//       console.log(err.message);
//     });
//   console.log("done in get");
// },
