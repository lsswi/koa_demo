// 低40位存业务相关信息
// [40:37] 类型ID，不用关心
// [36:34] 绑定类型ID，1为流量x字段校验，2位流量x事件字段校验
// [33:17] media_id
// [16:1] rel_m_fvid/rel_e_fvid
// 因为nt的js的位运算只处理32位，所以64位的数只能用字符串处理
function parseRuleID(ruleID) {
  const bNum = parseInt(ruleID, 10).toString(2);
  // 二进制
  const typebNum = bNum.substring(bNum.length - 36, bNum.length - 36 + 3);
  // 十进制
  const typeDeNum = parseInt(typebNum, 2);
  return {
    verification_type: typeDeNum,
    media_id: (ruleID >> 16) & 0x1ffff,
    rel_id: ruleID & 0xffff,
  };
}

module.exports = { parseRuleID };
