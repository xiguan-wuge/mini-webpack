/**
 * 实现webpack
 */

const Compiler = require('./compiler')

function webpack(options) {
  // 合并参数
  const mergeOptions = _mergeOptions(options)
  // 创建compiler实例
  const compiler = new Compiler(mergeOptions)
  // 加载插件
  _loadPlugin(options.plugins, compiler)
  return compiler
}

// 合并参数
function _mergeOptions(options) {
  console.log('process.argv', process.argv);
  const argv = process.argv.slice(2)
  const shellOptions = argv.reduce((option, argv) => {
    // argv -》 --mode=production 
    // 测试效果可以看./temp.js
    const [key, value] = argv.split('=')
    if(key && value) {
      option[key] = value
    }
    return option

  }, {})
  return {
    ...options,
    ...shellOptions
  }
}

// 加载插件函数
function _loadPlugin(plugins, compiler) {
  if(plugins && Array.isArray(plugins)) {
    plugins.forEach(plugin => {
      plugin.apply(compiler)
    })
  }
}

module.exports = webpack