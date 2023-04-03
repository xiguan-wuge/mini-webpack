const fs =  require('fs')

/**
 * 统一路径分割符
 */
function toUnixPath(path) {
  return path.replace(/\\/g, '/')
}

/**
 * 补充文件后缀
 * @param {*} modulePath 模块绝对路径名
 * @param {*} extensions 扩展名数组
 * @param {*} originModulePath 原始引入模块路径
 * @param {*} moduleContext 模块上下文（当前模块所在目录）
 */
function tryExtensions(
  modulePath,
  extensions,
  originModulePath,
  moduleContext
) {
  // 优先尝试不需要扩展名选项
  extensions.unshift('')
  for(let extension of extensions) {
    if(fs.existsSync(modulePath + extension)) {
      return modulePath + extension
    }
  }
  // 未匹配对应文件
  throw new Error(
    `No Module, Error: can't resolve ${modulePath} in ${moduleContext}`
  )
}

/**
 * 接收chunk对象，返回对应的源代码
 * @param {*} chunk 
 */
function getSourceCode(chunk) {
  // name: 入口文件名称
  // entryModule: 入口文件的module对象
  // modules: 依赖模块路径
  const {name, entryModule, modules} = chunk
  return `
  (() => {
    var __webpack_modules__ = {
      ${modules
        .map((module) => {
          return `
          '${module.id}': (module) => {
            ${module._source}
      }
        `;
        })
        .join(',')}
    };
    // The module cache
    var __webpack_module_cache__ = {};

    // The require function
    function __webpack_require__(moduleId) {
      // Check if module is in cache
      var cachedModule = __webpack_module_cache__[moduleId];
      if (cachedModule !== undefined) {
        return cachedModule.exports;
      }
      // Create a new module (and put it into the cache)
      var module = (__webpack_module_cache__[moduleId] = {
        // no module.id needed
        // no module.loaded needed
        exports: {},
      });

      // Execute the module function
      __webpack_modules__[moduleId](module, module.exports, __webpack_require__);

      // Return the exports of the module
      return module.exports;
    }

    var __webpack_exports__ = {};
    // This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
    (() => {
      ${entryModule._source}
    })();
  })();
  `
}

module.exports = {
  toUnixPath,
  tryExtensions,
  getSourceCode
}