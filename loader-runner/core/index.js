const fs = require('fs')

/**
 * 执行loader处理
 * @param {*} options 
 * @param {*} callback 
 */
function runLoaders(options, callback) {
  const resource = options.resource || ''
  let loaders = options.loaders || []
  const loaderContext = options.context || {}
  const readResource = options.readResource || fs.readFile.bind(fs)

  // 根据loaders路径，创建loaders对象
  loaders = loaders.map(createLoaderObject)

  // 处理loaderContext，即loader中的this对象
  handleLoaderContext(loaderContext, resource, readResource, loaders)

  // 用来存储读取资源文件的二进制内容（转化前的原始文件内容）
  const processOptions = {
    resourceBuffer: null
  }

  // 开始迭代loaders，从pitch阶段开始迭代
  // 按照 post -》 inline -》 normal -》 pre 的顺序
  iteratePitchingLoaders(processOptions, loaderContext, (err, result) => {
    callback(err, {
      result,
      resourceBuffer: processOptions.resourceBuffer
    })
  })
}

/**
 * 将loader的绝对路径转换成loader对象
 * @param {*} loader 
 */
function createLoaderObject(loader) {
  const obj = {
    normal: null, // loader normal 函数本身
    pitch: null, // loader.pitch 函数
    raw: null, // 是否需要转成Buffer对象
    data: null, // pitch函数和normal函数交流的媒介
    pitchExcuted: false, // pitch函数是否已经执行
    normalExcuted: false, // loader函数本身是否已经被执行
    request: loader, // 保存当前资源的绝对路径
  }

  // 按照路径加载loader模块
  // 真实源码中，loadLoader加载还支持ESM，这里暂时模拟次吃CJS语法
  const normalLoader = require(obj.request)

  // 赋值
  obj.normal = normalLoader
  obj.pitch = normalLoader.pitch

  // 转化时需要 Buffer/String
  obj.raw = normalLoader.raw
  
  return obj
}

/**
 * 处理loaderContext对象，loader中的this
 * @param {*} loaderContext 
 * @param {*} resource 
 * @param {*} readResource 
 * @param {*} loaders 
 */
function handleLoaderContext(loaderContext, resource, readResource, loaders) {
  loaderContext.resourcePath = resource
  loaderContext.readResource = readResource
  loaderContext.loaderIndex = 0 // 通过loaderIndex来执行对应的loader
  loaderContext.loaders = loaders
  loaderContext.data = null
  // 是否是异步loader
  loaderContext.async = null
  loaderContext.callback = null

  // request 保存所有loader路径和资源路径
  // 这里全部转换为inline-loader的形式（字符串!拼接），在结尾拼接资源路径
  Object.defineProperty(loaderContext, 'request', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .map(loader => loader.request)
        .concat(loaderContext.resourcePath || '')
        .join('!')
    }
  })

  // 保存剩下的请求，不包含自身（loaderIndex为分界）， 包含资源路径
  Object.defineProperty(loaderContext, 'remainingRequest', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .slice(loaderContext.loaderIndex + 1)
        .map(l => l.request)
        .concat(loaderContext.resourcePath)
        .join('!')
    }
  })

  // 保存剩下的请求，包含自身和资源路径
  Object.defineProperty(loaderContext, 'currentReqeust', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .slice(loaderContext.loaderIndex)
        .map(l => l.request)
        .concat(loaderContext.resourcePath)
        .join('!')
    }
  })

  // 保存已经处理过的请求，不包含自身，也不包含资源路径
  Object.defineProperty(loaderContext, 'previousRequst', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .slice(0, loaderContext.loaderIndex)
        .map(l => l.request)
        .join('!')
    }
  })

  // 通过代理，保存pitch存储的值，pitch方法中的第三个参数可以修改，
  // 通过normal中this.data 可以获取loader对应pitch方法操作的data
  Object.defineProperty(loaderContext, 'data', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders[loaderContext.loaderIndex].data
    }
  })
}

/**
 * pitching loaders
 * 核心思路：执行第一个loader的pitch函数，依次执行，最后一个pitch后开始读取文件
 * @param {*} options 
 * @param {*} loaderContext 
 * @param {*} callback 
 */
function iteratePitchingLoaders(options, loaderContext, callback) {
  // 判断是否结束pitch，开始读取文件
  if(loaderContext.loaderIndex >= loaderContext.loaders.length) {
    return processResource(options, loaderContext, callback)
  }

  const currentLoaderObject = loaderContext.loaders[loaderContext.loaderIndex]
  // 当前pitch已经执行过，执行下一个
  if(currentLoaderObject.pitchExcuted) {
    loaderContext.loaderIndex++
    return iteratePitchingLoaders(options, loaderContext, callback)
  }

  const pitchFunction = currentLoaderObject.pitch
  // 标记当前pitch已经执行过了
  currentLoaderObject.pitchExcuted = true

  // 如果当前loader不存在pitch函数，即不存在pitch阶段
  if(!currentLoaderObject.pitch) {
    // ? iteratePitchingLoaders 函数内部会判断当前pitch是否已经执行
    return iteratePitchingLoaders(options, loaderContext, callback)
  }

  // 存在pitch函数，并且当前pitch未执行过，调用loader的pitch函数执行
  runSyncOrAsync(
    pitchFunction,
    loaderContext,
    [
      currentLoaderObject.remainingRequest,
      currentLoaderObject.previousRequest,
      currentLoaderObject.data
    ],
    function(err, ...args) {
      if(err) {
        // 存在错误，则执行callback，表示runLoader执行完毕
        return callback(err)
      }

      // 根据返回值，判断是否需要熔断 或者 执行下一个pitch
      // pitch存在非undefined的返回值 -》 进行熔断，掉头执行loader normal
      // pitch函数不存在非undefined的返回值 -》继续迭代下一个
      const hasArg = args.some(i => i !== undefined)
      if(hasArg) {
        loaderContext.loaderIndex--;
        // 熔断，直接调用normal-loader
        iterateNormalLoaders(options, loaderContext, args, callback)
      } else {
        iteratePitchingLoaders(options, loaderContext, callback)
      }
    }
  )

}

/**
 * 执行loader 同步/异步
 * @param {*} fn 需要被执行的函数
 * @param {*} context loader的上下文
 * @param {*} args 参数，包含3个：未执行的请求，已经执行的请求，data
 * @param {*} callback 外部传入的callback, iteratePitchingLoaders执行runSyncOrAsync的callback中存在熔断判断
 */
function runSyncOrAsync(fn, context, args, callback) {
  // 是否同步，默认同步，表示当前loader执行完，自动迭代执行下一个
  let isSync = true
  // 表示fn是否已经执行过，避免重复执行
  let isDone = false

  // 定义 this.callback
  // 同时 this.async 通过闭包访问innerCallback，表示异步loader执行完毕
  const innerCallback = (context.callback = function() {
    isDone = true
    // 当调用this.callback时， 标记不走loader函数的return了
    isSync = true
    callback(null, ...arguments)
  })

  // 定义异步 this.async
  context.async = function() {
    isSync = false
    return innerCallback
  }

  // pitch 返回值，判断是否需要熔断
  const result = fn.apply(context, args)
  if(isSync) {
    isDone = true
    if(result === undefined) {
      return callback()
    }

    // 如果loader返回的是一个promise，异步loader
    if(
      result &&
      typeof result === 'object' &&
      typeof result.then === 'function'
    ) {
      // 同样等待promise结束后，直接熔断；否则reject，直接callback错误
      return result.then(r => callback(null, r), callback)
    }

    // 非promise，且存在执行结果，进行熔断
    return callback(null, result)
  }
} 

/**
 * 读取文件
 * @param {*} options 
 * @param {*} loaderContext 
 * @param {*} callback 
 */
function processResource(options, loaderContext, callback) {
  // 重置越界的loaderContext.loaderIndex
  // 来实现倒序执行loader-normal: pre -> normal -> inline -> post 
  loaderContext.loaderIndex = loaderContext.loaders.length - 1
  const resource = loaderContext.resourcePath

  // 读取文件内容
  loaderContext.readResource(resource, (err, buffer) => {
    if(err) {
      return callback(err)
    }

    // 保存原始文件的buffer，相当于processOptions.resourceBuffer = buffer 
    options.resourceBuffer = buffer
    // 将读取到的内容传递到iterateNormalLoaders, 进行迭代 normal-loader
    // [buffer] runSyncOrAsync时args数据类型格式保持统一
    iterateNormalLoaders(options, loaderContext, [buffer], callback)
  })
}

/**
 * 迭代normal-loaders， 根据loderIndex的值进行迭代
 * 执行条件：
 *  1. pitch end -》 readFile -> iterateNormalLoaders;
 *  2. pitch -》 发生熔断 -》 iterateNormalLoaders
 * @param {*} options 
 * @param {*} loaderContext 
 * @param {*} args 
 * @param {*} callback 
 */
function iterateNormalLoaders(options, loaderContext, args, callback) {
  // 越界元素判断，越界则表示所有normal-loader都已经执行完毕，直接调用callback返回
  if(loaderContext.loaderIndex < 0) {
    return callback(null, args)
  }

  const currentLoader = loaderContext.loaders[loaderContext.loaderIndex]
  if(currentLoader.normalExcuted) {
    loaderContext.loaderIndex--
    return iterateNormalLoaders(options, loaderContext, args, callback)
  }

  const normalFn = currentLoader.normal
  // 标记已经执行过
  currentLoader.normalExcuted = true
  // 检查是否执行过
  if(!normalFn) {
    return iterateNormalLoaders(options, loaderContext, args, callback)
  }
  // 根据loader中的raw值，格式化source
  convertArgs(args, loaderContext.raw)
  // 执行loader
  runSyncOrAsync(normalFn, loaderContext, args, (err, ...args) => {
    if(err) {
      return callback(err)
    }
    // 继续迭代
    iterateNormalLoaders(options, loaderContext, args, callback)
  })
}

/**
 * 转化资源source的格式
 * @param {*} args 
 * @param {*} raw 是否需要转换成Buffer。true：需要
 */
function convertArgs(args, raw) {
  if(!raw && Buffer.isBuffer(args[0])) {
    // 不需要buffer
    args[0] = args[0].toString()
  } else if(raw&& typeof args[0] === 'string') {
    // 需要buffer
    args[0] = Buffer.from(args[0], 'utf-8')
  }
}

module.exports = {
  runLoaders
}
