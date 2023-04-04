const fs = require('fs')
const path = require('path')

// 前期理解：
//   - webpack中通过compilation对象进行模块编译时，会首先进行匹配loader处理文件得到结果,
//   之后才会输出给webpack进行编译。
//   - 简单来说就是在每一个模块module通过webpack编译前都会首先根据对应文件后缀寻找匹配到对应的loader，
//   先调用loader处理资源文件从而将处理后的结果交给webpack进行编译。
//   - 在webpack中的_doBuild函数中调用了runLoaders方法，而runLoaders方法正是来自于loader-runner库。

// const {runLoaders} = require('loader-runner')
const {runLoaders} = require('./core/index')

// 模块路径
const filePath = path.resolve(__dirname, './title.js')

const request = 'inline1-loader!inline2-loader!./title.js'

// 模拟webpack配置
const rules = [
  {
    test: /\.js$/,
    use: ['normal1-loader', 'normal2-loader']
  },
  {
    test: /\.js$/,
    use: ['pre1-loader', 'pre2-loader'],
    enforce: 'pre'
  },
  {
    test: /\.js$/,
    use: ['post1-loader', 'post2-loader'],
    enforce: 'post'
  }
]

// 从文件引入路径中提取inline-loader, 同时将路径中的! -! !! 等标志inline-loader规则 删除
const parts = request.replace(/^-?!+/, '').split('!')

// 获取文件路径
const sourcePath = parts.pop()

// 获取inline-loader
const inlineLoaders = parts

// 处理rules中的loader规则
const preLoaders = [],
  normalLoaders = [],
  postLoaders = []
rules.forEach(rule => {
  if(rule.test.test(sourcePath)) {
    switch(rule.enforce) {
      case 'pre': 
        preLoaders.push(...rule.use)
        break;
      case 'post': 
        postLoaders.push(...rule.use)
        break;
      default:
        normalLoaders.push(...rule.use)
        break;
    }
  }
})

/**
 * 根据inlineLoader的规则过滤需要的loader
 * https://webpack.js.org/concepts/loaders/
 * !: 单个！开头，排除所有normal-loader.
 * !!: 两个!!开头 仅剩余 inline-loader 排除所有(pre,normal,post).
 * -!: -!开头将会禁用所有pre、normal类型的loader，剩余post和normal类型的.
 */
let loaders = []
if(request.startsWith('!!')) {
  loaders.push(...inlineLoaders)
} else if(request.startsWith('-!')) {
  loaders.push(...postLoaders, ...inlineLoaders)
} else if(request.startsWith('!')) {
  loaders.push(...postLoaders, ...inlineLoaders, ...preLoaders)
} else {
  loaders.push(
    ...[...postLoaders, ...inlineLoaders, ...normalLoaders, ...preLoaders]
  )
}

// 将loader转化为loader所在的文件夹路径
// webpack中默认是针对resolveLoader的路径进行解析
// 此处模拟
const resolveLoader = (loader) => path.resolve(__dirname, './loaders', loader)

// 获取需要处理的loader路径
loaders = loaders.map(resolveLoader)

runLoaders(
  {
    resource: filePath, // 加载的模块路径
    loaders, // 需要处理的loader数组
    context: {name: 'loader-runner'}, // 需要传递的上下文对象
    readResource: fs.readFile.bind(fs), // 读取文件的方法
  },
  (error, result) => {
    if(error) {
      console.log('runLoaders-error', error)
    }
    console.log('runLoaders-result', result)
  }
)