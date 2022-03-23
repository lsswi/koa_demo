const ddd = {
  p() {
    console.log('hello in p');
    console.log('get header in p: ', this.req);
    function pt(objName) {
      this.obj_name = objName;
    }
    pt.prototype.obj_name = 'mmm';
    // obj.obj_name = "nnn";
    return 'end in p';
  },
  name: 'nihao',
};

const abc = () => {
  bbb();
  console.log('im abc');
  function bbb() {
    console.log('im bbb');
  }
};

module.exports = {
  ddd,
  age: 11,
  abc,
  set header(name) {
    this.req = name;
    console.log(this.req);
  },
  get header() {
    return this.req;
  },
  tFunc() {
    console.log('get req in tFunc: ', this.req);
  },
};
