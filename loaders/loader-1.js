// loader 本质上是一个函数，接受源代码作为入参，返回处理后的结果

function loader1(sourceCode) {
  console.log('join loader1')
  return sourceCode += `\n const loader1 = 'loader1 xxxx'`
}

module.exports = loader1