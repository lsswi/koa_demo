const { Sequelize } = require("sequelize");
const md5 = require("blueimp-md5");

const DBLib = {
  getDBPool() {
    return new Sequelize("data_dict", "root", "Lzymysql9787.", {
      host: "localhost",
      dialect: "mysql",
      pool: {
        max: 5,
        min: 0,
        idle: 30000,
      },
    });
  },
  
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
};

module.exports = DBLib;
