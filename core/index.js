/**
 * 核心入口文件
 */


const webpack = require('./webpack')
// const webpack = require('webpack')
const config = require('../example/webpack.config')

const compiler = webpack(config)

compiler.run((err, stats) => {
  if(err) {
    console.log('compiler-run-err', err)
  }
})