// loader 本质上是一个函数，接受源代码作为入参，返回处理后的结果

function loader2(sourceCode) {
  console.log('join loader2')
  return sourceCode += `\n const loader2 = 'loader2 xxxx'`
}

module.exports = loader2