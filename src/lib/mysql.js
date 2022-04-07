const { Sequelize } = require('sequelize');

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
};

module.exports = DBLib;
