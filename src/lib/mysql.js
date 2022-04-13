const { Sequelize } = require('sequelize');
const { MYSQL_CONF: { DATA_DICT } } = require('./hello');

const DBLib = {
  getDBPool() {
    return new Sequelize('data_dict', 'root', 'Lzymysql9787.', {
      host: 'localhost',
      dialect: 'mysql',
      pool: {
        max: 5,
        min: 0,
        idle: 30000,
      },
      timezone: '+08:00',
    });
  },

  tt() {
    this.getDBPool().authenticate().then(() => {
      console.log('DB连接成功');
    });
    console.log(DATA_DICT);
  },
};

function set(choiceList) {
  let choice = 0;
  for (const c of choiceList) {
    choice |= 1 << c;
  }
  return choice;
}

function get(choice) {
  for (let i = 0; i < 32; i++) {
    if ((choice >> i) & 1 === 1) {
      console.log(i);
    }
  }
}

module.exports = DBLib;
