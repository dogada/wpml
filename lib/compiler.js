'use strict';

var debug = require('debug')('wpml:compiler')
var assign = require('object-assign')
var escape = require('escape-html')
var linkify = require('linkify-it')({}, {fuzzyEmail: false}).tlds('.onion', true)
var config = require('./config')

// generate long enough string for code indenation
var INDENT = (function (len) {
  for (var str = '    '; str.length < len; str += str);
  return str
})(80);

function filter(value, re) {
  var src = value.split(' ')
  var res = []
  for (var i = 0; i < src.length; i++) {
    if (re.test(src[i])) res.push(src[i])
  }
  return res.join(' ')
}

function isDisabledTag(worker, tag) {
  var opts = worker.opts
  var name = tag.name.toLowerCase().trim()
  if (name === 'script' && !opts.javascript) return true
  if (opts.whitelist && opts.whitelist.indexOf(name) === -1) return true
}

function attr(opts, name, value) {
  if (!opts.javascript && opts.inlineJsTest.test(value)) return '';
  if (name === 'id' && opts.idTest && !opts.idTest.test(value)) value = ''
  if (name === 'class' && opts.classTest) value = filter(value, opts.classTest)
  
  if (value) return escape(name) + '=\"' + escape(value) + '\"'
  else return ''
}


function compileAttrs(worker, attrs) {
  var str = ''
  for (var name in (attrs || {})) {
    if (attrs.hasOwnProperty(name)) {
      var v = attr(worker.opts, name, attrs[name])
      if (v) str += ' ' + v
    }
  }
  debug('attrs', attrs, str)
  return str
}

/**
   Escape and urlize text.
*/
function urlize(worker, text) {
  var matches = linkify.match(text)
  if (!matches) return escape(text)
  var lastIndex = 0;
  var buf = []
  for (var i = 0, match; (match = matches[i++]); ) {
    buf.push(escape(text.slice(lastIndex, match.index)))
    var link = {tag: true, name: 'a',
                attrs: {href: match.url}, value: escape(match.text)}
    buf = buf.concat(tagBuffer(worker, link, true))
    lastIndex = match.lastIndex
  }
  buf.push(escape(text.slice(lastIndex)))
  debug('urlize', matches, buf)
  return buf.join('')
}


function tagBuffer(worker, data, urlized) {
  var name = escape(data.name)
  var buf = ['<', name, compileAttrs(worker, data.attrs || {}), '>']
  if (data.tag && data.value) {
    buf.push(urlized ? data.value : urlize(worker, data.value))
    buf.push('</', name, '>')
  }
  debug('tagBuffer', buf)
  return buf
}


/**
   @return Escaped verison of the disabled markup.
*/
function escapeDisabledTag(worker, data) {
  var content = (typeof data.value === 'string' ? data.value : '...')
  worker.format(escape(
    '<' + data.name + compileAttrs(worker, data.attrs) + '>' +
      content + '</' + data.name + '>'))
}

function openTag(worker, data) {
  worker.format.apply(null, tagBuffer(worker, data))
}

function compileTag(data, worker) {
  var name = data.name
  var plugin = worker.opts.plugins[name]
  if (plugin) return worker.format(plugin(data))

  if (data.name && isDisabledTag(worker, data)) {
    if (worker.opts.excludeDisabledTags) return
    return escapeDisabledTag(worker, data)
  }

  if (data.block) {
    openTag(worker, data)
    worker.stack.push(name)
    for (var i = 0, len = data.value.length; i < len; i++) {
      compileLine(data.value[i], worker)
    }
    worker.stack.pop()
    worker.format('</', name, '>')
  } else {
    // single or one-line tag
    openTag(worker, data)
  }
}

function formatTag(name, escaped, worker) {
  worker.format('<', name, '>', escaped, '</', name, '>')
}

function getSingleLineUrl(line) {
  var matches = linkify.match(line)
  var single = matches && matches.length === 1 && matches[0]
  if (single && single.index === 0 && single.lastIndex === line.length) return single.url
}

function compileValue(data, worker) {
  if (worker.stack.length) return worker.format(urlize(worker, data.value))

  var linkPlugin = worker.opts.plugins[worker.opts.linkPlugin]
  var singleUrl = getSingleLineUrl(data.value)
  //debug('compileValue', singleUrl, linkPlugin)
  if (linkPlugin && singleUrl) worker.format(linkPlugin(data))
  else worker.format('<', config.defaultTag, '>',
                     urlize(worker, data.value),
                     '</', config.defaultTag, '>')
}

function slice(data) {
  return Array.prototype.slice.call(data)
}


function compileLine(data, worker) {
  debug('compileLine', data)
  if (data.name) compileTag(data, worker)
  else if (data.value) compileValue(data, worker)
  else console.log('Invalid line: ', data)
}


function makeWorker(opts) {
  var buf = []
  var stack = []

  function format() {
    //debug('new line: ', slice(arguments).join(''))
    if (buf.length) buf.push('\n')
    if (opts.indent && stack.length) buf.push(INDENT.slice(0, stack.length * opts.indent))
    buf.push.apply(buf, slice(arguments))
  }
  
  return {opts: opts, buf: buf, stack: stack, format: format}
}


/**
   Compile parsed MML-document into HTML.
   @param {object} ast Parsed WPML document
   @param {object} opts Same as opts in mml.doc
   @return{ string} Generated html string. 
*/
function compile(ast, opts) {
  opts = assign({}, config.defaultOpts, opts)
  debug('compile', opts, ast)
  var worker = makeWorker(opts)
  for (var i = 0, text = ast.value, len = text.length; i < len; i++) {
    compileLine(text[i], worker)
  }
  return worker.buf.join('')
}


module.exports = compile

