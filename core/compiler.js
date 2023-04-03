// Compiler类，进行核心编译的实现

const { SyncHook } = require('tapable')
const {toUnixPath, tryExtensions, getSourceCode} = require('./utils')
const path = require('path')
const fs = require('fs')
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

class Compiler {
  constructor(options) {
    this.options = options

    // 相对根路径，context对象
    this.rootPath = this.options.context || toUnixPath(process.cwd())

    // 创建plugin hooks
    this.hooks = {
      // 开始编译时的钩子
      run: new SyncHook(),
      // 输出asset到output目录之前执行（写入文件之前）
      emit: new SyncHook(),
      // 在compilation完成时执行，全部编译完成执行
      done: new SyncHook()
    }

    // 保存所有的入口模块对象
    this.entries = new Set()
    // 保存所有的依赖模块对象
    this.modules = new Set()
    // 所有代码块对象
    this.chunks = new Set()
    // 存放本次产出的文件对象
    this.assets = new Set()
    // 存放本次编译产生的文件名
    this.files = new Set()

  }

  // run 方法启动编译
  // run接收外部传递的callback
  run(callback) {
    // 调用run的方式，触发开始编译的plugin
    this.hooks.run.call()
    // 获取入口配置对象
    const entry = this.getEntry()
    // console.log('entry', entry);
    // 编译入口文件
    this.buildEntryModule(entry)
    // 导出列表，之后将每个chunk转化成单独的文件加入到输出列表asset是中
    this.exportFile(callback)
  }

  // 获取入口文件路径
  getEntry() {
    let entry = Object.create(null)
    const {entry: optionsEntry} = this.options
    if(typeof optionsEntry === 'string') {
      entry['main'] = optionsEntry
    } else {
      entry = optionsEntry
    }
    // 将entry变成绝对路径
    Object.keys(entry).forEach(key => {
      const value = entry[key]
      if(!path.isAbsolute(value)) {
        // 转化为绝对路径，同时统一路径为/
        entry[key] = toUnixPath(path.join(this.rootPath, value))
      }
    })
    return entry
  }

  buildEntryModule(entry) {
    Object.keys(entry).forEach(entryName => {
      const entryPath = entry[entryName]
      const entryObj = this.buildModule(entryName, entryPath)
      this.entries.add(entryObj)
      // console.log('this.entries', this.entries)
      // console.log('this.modules', this.modules)

      // 根据当前入口文件和相关依赖，组装成一个包含入口文件和相关依赖的chunk
      this.buildUpChunk(entryName, entryObj)

      console.log('this.chunks', this.chunks)
    })
  }

  /**
   * 模块编译，主要功能如下：
   * 1. 通过fs模块根据入口文件读取源代码
   * 2. 调用loader对源代码进行处理，返回处理结果
   * 3. 通过babel分析loader处理后的内容，进行代码编译
   * 4. 若该入口文件存在依赖的模块，则递归执行buildModule
   * 5. 若该入口文件不存在依赖的模块，则返回编译后的模块对象
   * @param {*} moduleName 
   * @param {*} modulePath 
   * @returns 
   */
  buildModule(moduleName, modulePath) {
    // 1. 读取原始代码
    const originSourceCode = 
    ((this.originSourceCode = fs.readFileSync(modulePath, 'utf-8')))
    // this.moduleCode 为修改后的代码，后续会修改
    this.moduleCode = originSourceCode

    // 2. 调用loader进行处理
    this.handleLoader(modulePath)

    // 3. 调用webpack进行模块编译，(包含递归) 获取最终的module对象
    const module = this.handleWebpackCompiler(moduleName, modulePath)
    // 4. 返回对应的module
    return module
  }

  // 处理匹配的loader，处理文件
  handleLoader(modulePath) {
    const matchLoaders = []
    // 1. 获取config中的rules
    const rules = this.options.module.rules
    rules.forEach(loader => {
      const testRule = loader.test
      if(testRule.test(modulePath)) {
        // 仅考虑 js文件且use是数组或者字符串
        if(loader.loader) {
          matchLoaders.push(loader.loader)
        } else {
          matchLoaders.push(...loader.use)
        }
      }
      // 2. 倒序执行loader 传入源代码
      // for(let i = matchLoaders.length - 1; i >= 0; i--) {
      //   const loaderFn = require(matchLoaders[i])
      //   this.moduleCode = loaderFn(this.moduleCode)
      // }
    })
    // 2. 倒序执行loader 传入源代码
    for(let i = matchLoaders.length - 1; i >= 0; i--) {
      const loaderFn = require(matchLoaders[i])
      this.moduleCode = loaderFn(this.moduleCode)
    }
  }

  // webpack 模块编译 
  handleWebpackCompiler(moduleName, modulePath) {
    // 将当前模块相对于根目录，计算出相对路径，最为模块ID
    const moduleId = './' + path.posix.relative(this.rootPath, modulePath)
    // 创建模块对象
    const module = {
      id: moduleId,
      dependencies: new Set(), // 依赖的绝对路径
      name: [moduleName] // 该模块所属的入口文件
    }
    // 调用babel分析代码
    console.log('babel 分析');
    const ast = parser.parse(this.moduleCode, {
      sourceType: 'module'
    })
    console.log('遍历');
    // 深度优先，遍历ast
    traverse(ast, {
      // 当遇到require语句时
      CallExpression: (nodePath) => {
        const node = nodePath.node
        if(node.callee.name === 'require') {
          // 获得源代码中引入模块的绝对路径
          const requirePath = node.arguments[0].value
          // 寻找绝对模块：当前模块路径 + require()对应的相对路径
          const moduleDirName = path.posix.dirname(modulePath)
          const absolutePath = tryExtensions(
            path.posix.join(moduleDirName, requirePath),
            this.options.resolve.extensions,
            requirePath,
            moduleDirName
          )
          // 生成模块ID： 针对于根路径的模块ID， 添加进新的模块依赖路径
          const moduleId = './' + path.posix.relative(this.rootPath, absolutePath)
          // 通过babel修改源代码中的require变成__webpack_require__语句
          node.callee = t.identifier('__webpack_require__')
          // 修改源代码中require语句引入的模块： 全部改为相对于根路径来处理
          node.arguments = [t.stringLiteral(moduleId)]
          // 为当前模块添加require语句造成的依赖（内容相对于根路径的模块ID）
          // module.dependencies.add(moduleId)
          // 处理依赖项被重复处理的问题（转化为id数组）
          const alreadyModules = Array.from(this.modules).map(i => i.id)
          if(!alreadyModules.includes(moduleId)) {
            module.dependencies.add(moduleId)
          } else {
            // 已经存在
            // 虽不进行添加如模块依赖，但需要更新这个模块依赖的入口
            this.modules.forEach(module => {
              if(module.id === moduleId) {
                module.name.push(moduleName)
              }
            })
          }

        }
      }
    })
    // 遍历结束后，根据ast生成新的代码
    const {code} = generator(ast)
    // 为当前模块挂载新生成的代码
    module._source = code

    // 递归依赖，深度遍历，存在依赖模块则加入
    module.dependencies.forEach(dependency => {
      const depModule = this.buildModule(moduleName, dependency)
      // 将编译后的任何依赖到模块对象添加到modules中
      this.modules.add(depModule)
    })
    // 返回当前模块对象
    return module
  }

  /**
   * 根据入口文件和依赖，组装chunk
   * @param {*} entryName 
   * @param {*} entryObj 
   */
  buildUpChunk(entryName, entryObj) {
    const chunk = {
      name: entryName, // 每个入口文件作为一个chunk
      entryModule: entryObj, // entry 编译后的对象
      // 寻找与当前entry相关的module
      modules: Array.from(this.modules).filter(module => {
        return module.name.includes(entryName)
      })
    }
    this.chunks.add(chunk)
  }

  /**
   * 将chunk添加到输出列表中
   * @param {*} callback 
   */
  exportFile(callback) {
    const output = this.options.output
    // 根据chunks生成assets
    this.chunks.forEach(chunk => {
      const parseFileName = output.filename.replace('[name]', chunk.name)
      // assets中 {main.js: '生成的字符串代码'}
      this.assets[parseFileName] = getSourceCode(chunk)
    })
    // 调用plugin emit钩子
    this.hooks.emit.call()

    // 判断输出文件夹是否存在
    if(!fs.existsSync(output.path)) {
      fs.mkdirSync(output.path)
    }

    // files中保存所有生成的文件名
    this.files = Object.keys(this.assets)

    // 将assets中的内容打包成文件，写入文件系统中
    Object.keys(this.assets).forEach(fileName => {
      const filePath = path.join(output.path, fileName)
      fs.writeFileSync(filePath, this.assets[fileName])
    })

    // 结束之后，触发钩子
    this.hooks.done.call()
    callback(null, {
      toJson: () => {
        return {
          entries: this.entries,
          modules: this.modules,
          files: this.files,
          chunks: this.chunks,
          assets: this.assets
        }
      }
    })
  }

}

module.exports = Compiler