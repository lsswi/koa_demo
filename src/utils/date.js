const DateLib = {
  // 把MySQL中取出来的datetime转成 2022-03-24 03:02:58 格式
  formatTime(date) {
    return date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
  },
};

module.exports = { DateLib };
