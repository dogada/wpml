(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.wpml = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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


},{"./config":2,"debug":5,"escape-html":8,"linkify-it":9,"object-assign":15}],2:[function(require,module,exports){
module.exports = {
  defaultTag: 'p',
  defaultOpts: {
    javascript: false,
    inlineJsTest: /^javascript:/i,
    indent: 0,
    plugins: {},
    linkPlugin: null
  }
}

},{}],3:[function(require,module,exports){
'use strict';

var parser = require('./parser')
var compiler = require('./compiler')

/**
   Converts text in WPML format to WPML document.
   @param {string} text WPML text
   @param {object} opts
   @param {boolean} [javascript=false] Allow inline JS and script tags inside WPML doc.
   @param {number} [indent=0] Number of spaces used for indentation of generated html.
   @param {object} [opts.transforms={}] List of tags transforms, for example to
   transform all types of headings to h4
   {"h1": "h4", "h2": "h4", "h3": "h4"}.
   @param {object<string, function>} [opts.plugins] Converters of embedded content objects
   ("youtube", "facebook", "gallery", "html". Each converter should produce html
   string to replace content object:
   {"youtube": function(obj) {...}}
   
   @return {object} doc WPML document
   @return {object} doc.meta Meta information (title, tags, etc)
   @return {string} doc.html Generated HTML
   
*/
function doc(text, opts) {
  var parsed = parser(text)
  return {
    meta: parsed.attrs,
    html: compiler(parsed, opts)
  }
}

function meta(text) {
  return parser(text).attrs
}

function render(text, opts) {
  return compiler(parser(text), opts)
}

module.exports = {
  parse: parser,
  renderParsed: compiler,
  render: render,
  html: render,
  doc: doc,
  meta: meta,
}

},{"./compiler":1,"./parser":4}],4:[function(require,module,exports){
'use strict';

var debug = require('debug')('wpml:parser')
var config = require('./config')

// http://www.unicode.org/reports/tr18/#Line_Boundaries
var LINE_RE = /\s*(?:\r\n|[\n\r\v\f\x85\u2028\u2029])+/

var OPEN_TAG_RE = /^\s*([a-z]+[\w\-\.#]*):$/
var CLOSE_TAG_RE = /^\s*:([a-z]+[\w\-]*)$/
var FULL_TAG_RE = /^\s*([!\.]?)([a-z]+[\w\-\.#]*):\s+(.+)$/
var INVALID_TAG_RE = /([\.#]{2,}|#.+#|[\.#]$)/

var SINGLE_TAGS = /^(img|hr|br)$/


function mergeMeta(meta, target) {
  target[meta.name] = meta.value
}

function parseAttrs(tokens) {
  var attrs = {}
  for (var i = 0, len = tokens.length - 1; i < len; i += 2) {
    var separator = tokens[i]
    var token = tokens[i + 1]
    switch (separator) {
    case '#':
      attrs.id = token
      break
    case '.':
      if (!attrs['class']) attrs['class'] = token
      else attrs['class'] += ' ' + token
      break
    }
  }
  return attrs
}

function parseTag(str, type, value) {
  var tokens = str.split(/(\.|#)/)
  var tag = {name: tokens.shift() || config.defaultTag}
  var attrs = parseAttrs(tokens)
  if (Object.keys(attrs).length) tag.attrs = attrs
  if (type) tag[type] = true
  if (value) tag.value = value
  else if (tag.block) tag.value = []
  debug('tokens', tokens, '->', tag)
  return tag
}

function prefixType(prefix) {
  switch (prefix) {
  case '!':
    return 'root'
  case '.':
    return 'attr'
  }
  return 'tag'
}

function parseLine(line) {
  var match, data
  if ((match = line.match(FULL_TAG_RE)) && !INVALID_TAG_RE.test(match[2])) {
    return parseTag(match[2], prefixType(match[1]), match[3])
  } else if ((match = line.match(OPEN_TAG_RE)) && !INVALID_TAG_RE.test(match[1])) {
    var single = SINGLE_TAGS.test(match[1]) || match[2]
    return parseTag(match[1], single ? 'tag' : 'block')
  } else if ((match = line.match(CLOSE_TAG_RE))) {
    return parseTag(match[1], 'blockend')
  } else {
    return {value: line}
  }
}

function mergeIntoParent(parent, child) {
  if (!parent.attrs) parent.attrs = {}
  parent.attrs[child.name] = child.value
}

function processLine(line, doc, stack) {
  if (line.blockend) {
    if (stack.length) stack.pop()
    else console.error('No open tag for ', line)
    return
  }

  var target = (stack.length ? stack[stack.length - 1] : doc).value
  target.push(line)

  if (line.block) {
    stack.push(line)
  }
}

function parseLines(lines) {
  var doc = {attrs: {}, value: []}
  var stack = []
  var lastTag
  for (var i = 0, len = lines.length; i < len; i++) {
    var parsed = parseLine(lines[i])
    if (parsed.root) doc.attrs[parsed.name] = parsed.value
    else if (parsed.attr) {
      if (lastTag) mergeIntoParent(lastTag, parsed)
      else console.error('No parent tag for', parsed)
    } else {
      lastTag = (parsed.name ? parsed : null)
      processLine(parsed, doc, stack)
    }
  }
  if (stack.length) {
    console.warn('Parser finished with unclosed tags:\n', stack)
  }
  return doc
}

function splitLines(text) {
  var raw = text.split(LINE_RE)
  var lines = []
  for (var i = 0, len = raw.length; i < len; i++) {
    var line = raw[i]
    if (line) lines.push(line)
  }
  return lines
}

/**
   Parse text in WPML format and return JSON structure of a document.
   @param {string} text
   @return {object}
*/
function parse(text) {
  return parseLines(splitLines(text))
}

module.exports = parse

},{"./config":2,"debug":5}],5:[function(require,module,exports){

/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = require('./debug');
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = 'undefined' != typeof chrome
               && 'undefined' != typeof chrome.storage
                  ? chrome.storage.local
                  : localstorage();

/**
 * Colors.
 */

exports.colors = [
  'lightseagreen',
  'forestgreen',
  'goldenrod',
  'dodgerblue',
  'darkorchid',
  'crimson'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // is webkit? http://stackoverflow.com/a/16459606/376773
  return ('WebkitAppearance' in document.documentElement.style) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (window.console && (console.firebug || (console.exception && console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31);
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  return JSON.stringify(v);
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs() {
  var args = arguments;
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return args;

  var c = 'color: ' + this.color;
  args = [args[0], c, 'color: inherit'].concat(Array.prototype.slice.call(args, 1));

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
  return args;
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // this hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return 'object' === typeof console
    && console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      exports.storage.removeItem('debug');
    } else {
      exports.storage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    r = exports.storage.debug;
  } catch(e) {}
  return r;
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage(){
  try {
    return window.localStorage;
  } catch (e) {}
}

},{"./debug":6}],6:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = debug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = require('ms');

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lowercased letter, i.e. "n".
 */

exports.formatters = {};

/**
 * Previously assigned color.
 */

var prevColor = 0;

/**
 * Previous log timestamp.
 */

var prevTime;

/**
 * Select a color.
 *
 * @return {Number}
 * @api private
 */

function selectColor() {
  return exports.colors[prevColor++ % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function debug(namespace) {

  // define the `disabled` version
  function disabled() {
  }
  disabled.enabled = false;

  // define the `enabled` version
  function enabled() {

    var self = enabled;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // add the `color` if not set
    if (null == self.useColors) self.useColors = exports.useColors();
    if (null == self.color && self.useColors) self.color = selectColor();

    var args = Array.prototype.slice.call(arguments);

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %o
      args = ['%o'].concat(args);
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    if ('function' === typeof exports.formatArgs) {
      args = exports.formatArgs.apply(self, args);
    }
    var logFn = enabled.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }
  enabled.enabled = true;

  var fn = exports.enabled(namespace) ? enabled : disabled;

  fn.namespace = namespace;

  return fn;
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  var split = (namespaces || '').split(/[\s,]+/);
  var len = split.length;

  for (var i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

},{"ms":7}],7:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} options
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options){
  options = options || {};
  if ('string' == typeof val) return parse(val);
  return options.long
    ? long(val)
    : short(val);
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = '' + str;
  if (str.length > 10000) return;
  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str);
  if (!match) return;
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function short(ms) {
  if (ms >= d) return Math.round(ms / d) + 'd';
  if (ms >= h) return Math.round(ms / h) + 'h';
  if (ms >= m) return Math.round(ms / m) + 'm';
  if (ms >= s) return Math.round(ms / s) + 's';
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function long(ms) {
  return plural(ms, d, 'day')
    || plural(ms, h, 'hour')
    || plural(ms, m, 'minute')
    || plural(ms, s, 'second')
    || ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) return;
  if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
  return Math.ceil(ms / n) + ' ' + name + 's';
}

},{}],8:[function(require,module,exports){
/*!
 * escape-html
 * Copyright(c) 2012-2013 TJ Holowaychuk
 * MIT Licensed
 */

/**
 * Module exports.
 * @public
 */

module.exports = escapeHtml;

/**
 * Escape special characters in the given string of html.
 *
 * @param  {string} str The string to escape for inserting into HTML
 * @return {string}
 * @public
 */

function escapeHtml(html) {
  return String(html)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

},{}],9:[function(require,module,exports){
'use strict';


////////////////////////////////////////////////////////////////////////////////
// Helpers

// Merge objects
//
function assign(obj /*from1, from2, from3, ...*/) {
  var sources = Array.prototype.slice.call(arguments, 1);

  sources.forEach(function (source) {
    if (!source) { return; }

    Object.keys(source).forEach(function (key) {
      obj[key] = source[key];
    });
  });

  return obj;
}

function _class(obj) { return Object.prototype.toString.call(obj); }
function isString(obj) { return _class(obj) === '[object String]'; }
function isObject(obj) { return _class(obj) === '[object Object]'; }
function isRegExp(obj) { return _class(obj) === '[object RegExp]'; }
function isFunction(obj) { return _class(obj) === '[object Function]'; }


function escapeRE (str) { return str.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&'); }

////////////////////////////////////////////////////////////////////////////////


var defaultOptions = {
  fuzzyLink: true,
  fuzzyEmail: true,
  fuzzyIP: false
};


function isOptionsObj(obj) {
  return Object.keys(obj || {}).reduce(function (acc, k) {
    return acc || defaultOptions.hasOwnProperty(k);
  }, false);
}


var defaultSchemas = {
  'http:': {
    validate: function (text, pos, self) {
      var tail = text.slice(pos);

      if (!self.re.http) {
        // compile lazily, because "host"-containing variables can change on tlds update.
        self.re.http =  new RegExp(
          '^\\/\\/' + self.re.src_auth + self.re.src_host_port_strict + self.re.src_path, 'i'
        );
      }
      if (self.re.http.test(tail)) {
        return tail.match(self.re.http)[0].length;
      }
      return 0;
    }
  },
  'https:':  'http:',
  'ftp:':    'http:',
  '//':      {
    validate: function (text, pos, self) {
      var tail = text.slice(pos);

      if (!self.re.no_http) {
      // compile lazily, becayse "host"-containing variables can change on tlds update.
        self.re.no_http =  new RegExp(
          '^' + self.re.src_auth + self.re.src_host_port_strict + self.re.src_path, 'i'
        );
      }

      if (self.re.no_http.test(tail)) {
        // should not be `://`, that protects from errors in protocol name
        if (pos >= 3 && text[pos - 3] === ':') { return 0; }
        return tail.match(self.re.no_http)[0].length;
      }
      return 0;
    }
  },
  'mailto:': {
    validate: function (text, pos, self) {
      var tail = text.slice(pos);

      if (!self.re.mailto) {
        self.re.mailto =  new RegExp(
          '^' + self.re.src_email_name + '@' + self.re.src_host_strict, 'i'
        );
      }
      if (self.re.mailto.test(tail)) {
        return tail.match(self.re.mailto)[0].length;
      }
      return 0;
    }
  }
};

/*eslint-disable max-len*/

// RE pattern for 2-character tlds (autogenerated by ./support/tlds_2char_gen.js)
var tlds_2ch_src_re = 'a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]';

// DON'T try to make PRs with changes. Extend TLDs with LinkifyIt.tlds() instead
var tlds_default = 'biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф'.split('|');

/*eslint-enable max-len*/

////////////////////////////////////////////////////////////////////////////////

function resetScanCache(self) {
  self.__index__ = -1;
  self.__text_cache__   = '';
}

function createValidator(re) {
  return function (text, pos) {
    var tail = text.slice(pos);

    if (re.test(tail)) {
      return tail.match(re)[0].length;
    }
    return 0;
  };
}

function createNormalizer() {
  return function (match, self) {
    self.normalize(match);
  };
}

// Schemas compiler. Build regexps.
//
function compile(self) {

  // Load & clone RE patterns.
  var re = self.re = assign({}, require('./lib/re'));

  // Define dynamic patterns
  var tlds = self.__tlds__.slice();

  if (!self.__tlds_replaced__) {
    tlds.push(tlds_2ch_src_re);
  }
  tlds.push(re.src_xn);

  re.src_tlds = tlds.join('|');

  function untpl(tpl) { return tpl.replace('%TLDS%', re.src_tlds); }

  re.email_fuzzy      = RegExp(untpl(re.tpl_email_fuzzy), 'i');
  re.link_fuzzy       = RegExp(untpl(re.tpl_link_fuzzy), 'i');
  re.link_no_ip_fuzzy = RegExp(untpl(re.tpl_link_no_ip_fuzzy), 'i');
  re.host_fuzzy_test  = RegExp(untpl(re.tpl_host_fuzzy_test), 'i');

  //
  // Compile each schema
  //

  var aliases = [];

  self.__compiled__ = {}; // Reset compiled data

  function schemaError(name, val) {
    throw new Error('(LinkifyIt) Invalid schema "' + name + '": ' + val);
  }

  Object.keys(self.__schemas__).forEach(function (name) {
    var val = self.__schemas__[name];

    // skip disabled methods
    if (val === null) { return; }

    var compiled = { validate: null, link: null };

    self.__compiled__[name] = compiled;

    if (isObject(val)) {
      if (isRegExp(val.validate)) {
        compiled.validate = createValidator(val.validate);
      } else if (isFunction(val.validate)) {
        compiled.validate = val.validate;
      } else {
        schemaError(name, val);
      }

      if (isFunction(val.normalize)) {
        compiled.normalize = val.normalize;
      } else if (!val.normalize) {
        compiled.normalize = createNormalizer();
      } else {
        schemaError(name, val);
      }

      return;
    }

    if (isString(val)) {
      aliases.push(name);
      return;
    }

    schemaError(name, val);
  });

  //
  // Compile postponed aliases
  //

  aliases.forEach(function (alias) {
    if (!self.__compiled__[self.__schemas__[alias]]) {
      // Silently fail on missed schemas to avoid errons on disable.
      // schemaError(alias, self.__schemas__[alias]);
      return;
    }

    self.__compiled__[alias].validate =
      self.__compiled__[self.__schemas__[alias]].validate;
    self.__compiled__[alias].normalize =
      self.__compiled__[self.__schemas__[alias]].normalize;
  });

  //
  // Fake record for guessed links
  //
  self.__compiled__[''] = { validate: null, normalize: createNormalizer() };

  //
  // Build schema condition
  //
  var slist = Object.keys(self.__compiled__)
                      .filter(function(name) {
                        // Filter disabled & fake schemas
                        return name.length > 0 && self.__compiled__[name];
                      })
                      .map(escapeRE)
                      .join('|');
  // (?!_) cause 1.5x slowdown
  self.re.schema_test   = RegExp('(^|(?!_)(?:>|' + re.src_ZPCc + '))(' + slist + ')', 'i');
  self.re.schema_search = RegExp('(^|(?!_)(?:>|' + re.src_ZPCc + '))(' + slist + ')', 'ig');

  self.re.pretest       = RegExp(
                            '(' + self.re.schema_test.source + ')|' +
                            '(' + self.re.host_fuzzy_test.source + ')|' +
                            '@',
                            'i');

  //
  // Cleanup
  //

  resetScanCache(self);
}

/**
 * class Match
 *
 * Match result. Single element of array, returned by [[LinkifyIt#match]]
 **/
function Match(self, shift) {
  var start = self.__index__,
      end   = self.__last_index__,
      text  = self.__text_cache__.slice(start, end);

  /**
   * Match#schema -> String
   *
   * Prefix (protocol) for matched string.
   **/
  this.schema    = self.__schema__.toLowerCase();
  /**
   * Match#index -> Number
   *
   * First position of matched string.
   **/
  this.index     = start + shift;
  /**
   * Match#lastIndex -> Number
   *
   * Next position after matched string.
   **/
  this.lastIndex = end + shift;
  /**
   * Match#raw -> String
   *
   * Matched string.
   **/
  this.raw       = text;
  /**
   * Match#text -> String
   *
   * Notmalized text of matched string.
   **/
  this.text      = text;
  /**
   * Match#url -> String
   *
   * Normalized url of matched string.
   **/
  this.url       = text;
}

function createMatch(self, shift) {
  var match = new Match(self, shift);

  self.__compiled__[match.schema].normalize(match, self);

  return match;
}


/**
 * class LinkifyIt
 **/

/**
 * new LinkifyIt(schemas, options)
 * - schemas (Object): Optional. Additional schemas to validate (prefix/validator)
 * - options (Object): { fuzzyLink|fuzzyEmail|fuzzyIP: true|false }
 *
 * Creates new linkifier instance with optional additional schemas.
 * Can be called without `new` keyword for convenience.
 *
 * By default understands:
 *
 * - `http(s)://...` , `ftp://...`, `mailto:...` & `//...` links
 * - "fuzzy" links and emails (example.com, foo@bar.com).
 *
 * `schemas` is an object, where each key/value describes protocol/rule:
 *
 * - __key__ - link prefix (usually, protocol name with `:` at the end, `skype:`
 *   for example). `linkify-it` makes shure that prefix is not preceeded with
 *   alphanumeric char and symbols. Only whitespaces and punctuation allowed.
 * - __value__ - rule to check tail after link prefix
 *   - _String_ - just alias to existing rule
 *   - _Object_
 *     - _validate_ - validator function (should return matched length on success),
 *       or `RegExp`.
 *     - _normalize_ - optional function to normalize text & url of matched result
 *       (for example, for @twitter mentions).
 *
 * `options`:
 *
 * - __fuzzyLink__ - recognige URL-s without `http(s):` prefix. Default `true`.
 * - __fuzzyIP__ - allow IPs in fuzzy links above. Can conflict with some texts
 *   like version numbers. Default `false`.
 * - __fuzzyEmail__ - recognize emails without `mailto:` prefix.
 *
 **/
function LinkifyIt(schemas, options) {
  if (!(this instanceof LinkifyIt)) {
    return new LinkifyIt(schemas, options);
  }

  if (!options) {
    if (isOptionsObj(schemas)) {
      options = schemas;
      schemas = {};
    }
  }

  this.__opts__           = assign({}, defaultOptions, options);

  // Cache last tested result. Used to skip repeating steps on next `match` call.
  this.__index__          = -1;
  this.__last_index__     = -1; // Next scan position
  this.__schema__         = '';
  this.__text_cache__     = '';

  this.__schemas__        = assign({}, defaultSchemas, schemas);
  this.__compiled__       = {};

  this.__tlds__           = tlds_default;
  this.__tlds_replaced__  = false;

  this.re = {};

  compile(this);
}


/** chainable
 * LinkifyIt#add(schema, definition)
 * - schema (String): rule name (fixed pattern prefix)
 * - definition (String|RegExp|Object): schema definition
 *
 * Add new rule definition. See constructor description for details.
 **/
LinkifyIt.prototype.add = function add(schema, definition) {
  this.__schemas__[schema] = definition;
  compile(this);
  return this;
};


/** chainable
 * LinkifyIt#set(options)
 * - options (Object): { fuzzyLink|fuzzyEmail|fuzzyIP: true|false }
 *
 * Set recognition options for links without schema.
 **/
LinkifyIt.prototype.set = function set(options) {
  this.__opts__ = assign(this.__opts__, options);
  return this;
};


/**
 * LinkifyIt#test(text) -> Boolean
 *
 * Searches linkifiable pattern and returns `true` on success or `false` on fail.
 **/
LinkifyIt.prototype.test = function test(text) {
  // Reset scan cache
  this.__text_cache__ = text;
  this.__index__      = -1;

  if (!text.length) { return false; }

  var m, ml, me, len, shift, next, re, tld_pos, at_pos;

  // try to scan for link with schema - that's the most simple rule
  if (this.re.schema_test.test(text)) {
    re = this.re.schema_search;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      len = this.testSchemaAt(text, m[2], re.lastIndex);
      if (len) {
        this.__schema__     = m[2];
        this.__index__      = m.index + m[1].length;
        this.__last_index__ = m.index + m[0].length + len;
        break;
      }
    }
  }

  if (this.__opts__.fuzzyLink && this.__compiled__['http:']) {
    // guess schemaless links
    tld_pos = text.search(this.re.host_fuzzy_test);
    if (tld_pos >= 0) {
      // if tld is located after found link - no need to check fuzzy pattern
      if (this.__index__ < 0 || tld_pos < this.__index__) {
        if ((ml = text.match(this.__opts__.fuzzyIP ? this.re.link_fuzzy : this.re.link_no_ip_fuzzy)) !== null) {

          shift = ml.index + ml[1].length;

          if (this.__index__ < 0 || shift < this.__index__) {
            this.__schema__     = '';
            this.__index__      = shift;
            this.__last_index__ = ml.index + ml[0].length;
          }
        }
      }
    }
  }

  if (this.__opts__.fuzzyEmail && this.__compiled__['mailto:']) {
    // guess schemaless emails
    at_pos = text.indexOf('@');
    if (at_pos >= 0) {
      // We can't skip this check, because this cases are possible:
      // 192.168.1.1@gmail.com, my.in@example.com
      if ((me = text.match(this.re.email_fuzzy)) !== null) {

        shift = me.index + me[1].length;
        next  = me.index + me[0].length;

        if (this.__index__ < 0 || shift < this.__index__ ||
            (shift === this.__index__ && next > this.__last_index__)) {
          this.__schema__     = 'mailto:';
          this.__index__      = shift;
          this.__last_index__ = next;
        }
      }
    }
  }

  return this.__index__ >= 0;
};


/**
 * LinkifyIt#pretest(text) -> Boolean
 *
 * Very quick check, that can give false positives. Returns true if link MAY BE
 * can exists. Can be used for speed optimization, when you need to check that
 * link NOT exists.
 **/
LinkifyIt.prototype.pretest = function pretest(text) {
  return this.re.pretest.test(text);
};


/**
 * LinkifyIt#testSchemaAt(text, name, position) -> Number
 * - text (String): text to scan
 * - name (String): rule (schema) name
 * - position (Number): text offset to check from
 *
 * Similar to [[LinkifyIt#test]] but checks only specific protocol tail exactly
 * at given position. Returns length of found pattern (0 on fail).
 **/
LinkifyIt.prototype.testSchemaAt = function testSchemaAt(text, schema, pos) {
  // If not supported schema check requested - terminate
  if (!this.__compiled__[schema.toLowerCase()]) {
    return 0;
  }
  return this.__compiled__[schema.toLowerCase()].validate(text, pos, this);
};


/**
 * LinkifyIt#match(text) -> Array|null
 *
 * Returns array of found link descriptions or `null` on fail. We strongly
 * to use [[LinkifyIt#test]] first, for best speed.
 *
 * ##### Result match description
 *
 * - __schema__ - link schema, can be empty for fuzzy links, or `//` for
 *   protocol-neutral  links.
 * - __index__ - offset of matched text
 * - __lastIndex__ - index of next char after mathch end
 * - __raw__ - matched text
 * - __text__ - normalized text
 * - __url__ - link, generated from matched text
 **/
LinkifyIt.prototype.match = function match(text) {
  var shift = 0, result = [];

  // Try to take previous element from cache, if .test() called before
  if (this.__index__ >= 0 && this.__text_cache__ === text) {
    result.push(createMatch(this, shift));
    shift = this.__last_index__;
  }

  // Cut head if cache was used
  var tail = shift ? text.slice(shift) : text;

  // Scan string until end reached
  while (this.test(tail)) {
    result.push(createMatch(this, shift));

    tail = tail.slice(this.__last_index__);
    shift += this.__last_index__;
  }

  if (result.length) {
    return result;
  }

  return null;
};


/** chainable
 * LinkifyIt#tlds(list [, keepOld]) -> this
 * - list (Array): list of tlds
 * - keepOld (Boolean): merge with current list if `true` (`false` by default)
 *
 * Load (or merge) new tlds list. Those are user for fuzzy links (without prefix)
 * to avoid false positives. By default this algorythm used:
 *
 * - hostname with any 2-letter root zones are ok.
 * - biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф
 *   are ok.
 * - encoded (`xn--...`) root zones are ok.
 *
 * If list is replaced, then exact match for 2-chars root zones will be checked.
 **/
LinkifyIt.prototype.tlds = function tlds(list, keepOld) {
  list = Array.isArray(list) ? list : [ list ];

  if (!keepOld) {
    this.__tlds__ = list.slice();
    this.__tlds_replaced__ = true;
    compile(this);
    return this;
  }

  this.__tlds__ = this.__tlds__.concat(list)
                                  .sort()
                                  .filter(function(el, idx, arr) {
                                    return el !== arr[idx - 1];
                                  })
                                  .reverse();

  compile(this);
  return this;
};

/**
 * LinkifyIt#normalize(match)
 *
 * Default normalizer (if schema does not define it's own).
 **/
LinkifyIt.prototype.normalize = function normalize(match) {

  // Do minimal possible changes by default. Need to collect feedback prior
  // to move forward https://github.com/markdown-it/linkify-it/issues/1

  if (!match.schema) { match.url = 'http://' + match.url; }

  if (match.schema === 'mailto:' && !/^mailto:/i.test(match.url)) {
    match.url = 'mailto:' + match.url;
  }
};


module.exports = LinkifyIt;

},{"./lib/re":10}],10:[function(require,module,exports){
'use strict';

// Use direct extract instead of `regenerate` to reduse browserified size
var src_Any = exports.src_Any = require('uc.micro/properties/Any/regex').source;
var src_Cc  = exports.src_Cc = require('uc.micro/categories/Cc/regex').source;
var src_Z   = exports.src_Z  = require('uc.micro/categories/Z/regex').source;
var src_P   = exports.src_P  = require('uc.micro/categories/P/regex').source;

// \p{\Z\P\Cc\CF} (white spaces + control + format + punctuation)
var src_ZPCc = exports.src_ZPCc = [ src_Z, src_P, src_Cc ].join('|');

// \p{\Z\Cc} (white spaces + control)
var src_ZCc = exports.src_ZCc = [ src_Z, src_Cc ].join('|');

// All possible word characters (everything without punctuation, spaces & controls)
// Defined via punctuation & spaces to save space
// Should be something like \p{\L\N\S\M} (\w but without `_`)
var src_pseudo_letter       = '(?:(?!' + src_ZPCc + ')' + src_Any + ')';
// The same as abothe but without [0-9]
var src_pseudo_letter_non_d = '(?:(?![0-9]|' + src_ZPCc + ')' + src_Any + ')';

////////////////////////////////////////////////////////////////////////////////

var src_ip4 = exports.src_ip4 =

  '(?:(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';

exports.src_auth    = '(?:(?:(?!' + src_ZCc + ').)+@)?';

var src_port = exports.src_port =

  '(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?';

var src_host_terminator = exports.src_host_terminator =

  '(?=$|' + src_ZPCc + ')(?!-|_|:\\d|\\.-|\\.(?!$|' + src_ZPCc + '))';

var src_path = exports.src_path =

  '(?:' +
    '[/?#]' +
      '(?:' +
        '(?!' + src_ZCc + '|[()[\\]{}.,"\'?!\\-]).|' +
        '\\[(?:(?!' + src_ZCc + '|\\]).)*\\]|' +
        '\\((?:(?!' + src_ZCc + '|[)]).)*\\)|' +
        '\\{(?:(?!' + src_ZCc + '|[}]).)*\\}|' +
        '\\"(?:(?!' + src_ZCc + '|["]).)+\\"|' +
        "\\'(?:(?!" + src_ZCc + "|[']).)+\\'|" +
        "\\'(?=" + src_pseudo_letter + ').|' +  // allow `I'm_king` if no pair found
        '\\.{2,3}[a-zA-Z0-9%/]|' + // github has ... in commit range links. Restrict to
                                   // - english
                                   // - percent-encoded
                                   // - parts of file path
                                   // until more examples found.
        '\\.(?!' + src_ZCc + '|[.]).|' +
        '\\-(?!--(?:[^-]|$))(?:-*)|' +  // `---` => long dash, terminate
        '\\,(?!' + src_ZCc + ').|' +      // allow `,,,` in paths
        '\\!(?!' + src_ZCc + '|[!]).|' +
        '\\?(?!' + src_ZCc + '|[?]).' +
      ')+' +
    '|\\/' +
  ')?';

var src_email_name = exports.src_email_name =

  '[\\-;:&=\\+\\$,\\"\\.a-zA-Z0-9_]+';

var src_xn = exports.src_xn =

  'xn--[a-z0-9\\-]{1,59}';

// More to read about domain names
// http://serverfault.com/questions/638260/

var src_domain_root = exports.src_domain_root =

  // Can't have digits and dashes
  '(?:' +
    src_xn +
    '|' +
    src_pseudo_letter_non_d + '{1,63}' +
  ')';

var src_domain = exports.src_domain =

  '(?:' +
    src_xn +
    '|' +
    '(?:' + src_pseudo_letter + ')' +
    '|' +
    // don't allow `--` in domain names, because:
    // - that can conflict with markdown &mdash; / &ndash;
    // - nobody use those anyway
    '(?:' + src_pseudo_letter + '(?:-(?!-)|' + src_pseudo_letter + '){0,61}' + src_pseudo_letter + ')' +
  ')';

var src_host = exports.src_host =

  '(?:' +
    src_ip4 +
  '|' +
    '(?:(?:(?:' + src_domain + ')\\.)*' + src_domain_root + ')' +
  ')';

var tpl_host_fuzzy = exports.tpl_host_fuzzy =

  '(?:' +
    src_ip4 +
  '|' +
    '(?:(?:(?:' + src_domain + ')\\.)+(?:%TLDS%))' +
  ')';

var tpl_host_no_ip_fuzzy = exports.tpl_host_no_ip_fuzzy =

  '(?:(?:(?:' + src_domain + ')\\.)+(?:%TLDS%))';

exports.src_host_strict =

  src_host + src_host_terminator;

var tpl_host_fuzzy_strict = exports.tpl_host_fuzzy_strict =

  tpl_host_fuzzy + src_host_terminator;

exports.src_host_port_strict =

  src_host + src_port + src_host_terminator;

var tpl_host_port_fuzzy_strict = exports.tpl_host_port_fuzzy_strict =

  tpl_host_fuzzy + src_port + src_host_terminator;

var tpl_host_port_no_ip_fuzzy_strict = exports.tpl_host_port_no_ip_fuzzy_strict =

  tpl_host_no_ip_fuzzy + src_port + src_host_terminator;


////////////////////////////////////////////////////////////////////////////////
// Main rules

// Rude test fuzzy links by host, for quick deny
exports.tpl_host_fuzzy_test =

  'localhost|\\.\\d{1,3}\\.|(?:\\.(?:%TLDS%)(?:' + src_ZPCc + '|$))';

exports.tpl_email_fuzzy =

    '(^|>|' + src_ZCc + ')(' + src_email_name + '@' + tpl_host_fuzzy_strict + ')';

exports.tpl_link_fuzzy =
    // Fuzzy link can't be prepended with .:/\- and non punctuation.
    // but can start with > (markdown blockquote)
    '(^|(?![.:/\\-_@])(?:[$+<=>^`|]|' + src_ZPCc + '))' +
    '((?![$+<=>^`|])' + tpl_host_port_fuzzy_strict + src_path + ')';

exports.tpl_link_no_ip_fuzzy =
    // Fuzzy link can't be prepended with .:/\- and non punctuation.
    // but can start with > (markdown blockquote)
    '(^|(?![.:/\\-_@])(?:[$+<=>^`|]|' + src_ZPCc + '))' +
    '((?![$+<=>^`|])' + tpl_host_port_no_ip_fuzzy_strict + src_path + ')';

},{"uc.micro/categories/Cc/regex":11,"uc.micro/categories/P/regex":12,"uc.micro/categories/Z/regex":13,"uc.micro/properties/Any/regex":14}],11:[function(require,module,exports){
module.exports=/[\0-\x1F\x7F-\x9F]/
},{}],12:[function(require,module,exports){
module.exports=/[!-#%-\*,-/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E42\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDE38-\uDE3D]|\uD805[\uDCC6\uDDC1-\uDDC9\uDE41-\uDE43]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD82F\uDC9F/
},{}],13:[function(require,module,exports){
module.exports=/[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/
},{}],14:[function(require,module,exports){
module.exports=/[\0-\uD7FF\uDC00-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF]/
},{}],15:[function(require,module,exports){
/* eslint-disable no-unused-vars */
'use strict';
var hasOwnProperty = Object.prototype.hasOwnProperty;
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val) {
	if (val === null || val === undefined) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

module.exports = Object.assign || function (target, source) {
	var from;
	var to = toObject(target);
	var symbols;

	for (var s = 1; s < arguments.length; s++) {
		from = Object(arguments[s]);

		for (var key in from) {
			if (hasOwnProperty.call(from, key)) {
				to[key] = from[key];
			}
		}

		if (Object.getOwnPropertySymbols) {
			symbols = Object.getOwnPropertySymbols(from);
			for (var i = 0; i < symbols.length; i++) {
				if (propIsEnumerable.call(from, symbols[i])) {
					to[symbols[i]] = from[symbols[i]];
				}
			}
		}
	}

	return to;
};

},{}]},{},[3])(3)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsImxpYi9jb21waWxlci5qcyIsImxpYi9jb25maWcuanMiLCJsaWIvaW5kZXguanMiLCJsaWIvcGFyc2VyLmpzIiwibm9kZV9tb2R1bGVzL2RlYnVnL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvZGVidWcvZGVidWcuanMiLCJub2RlX21vZHVsZXMvZGVidWcvbm9kZV9tb2R1bGVzL21zL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2VzY2FwZS1odG1sL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2xpbmtpZnktaXQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbGlua2lmeS1pdC9saWIvcmUuanMiLCJub2RlX21vZHVsZXMvbGlua2lmeS1pdC9ub2RlX21vZHVsZXMvdWMubWljcm8vY2F0ZWdvcmllcy9DYy9yZWdleC5qcyIsIm5vZGVfbW9kdWxlcy9saW5raWZ5LWl0L25vZGVfbW9kdWxlcy91Yy5taWNyby9jYXRlZ29yaWVzL1AvcmVnZXguanMiLCJub2RlX21vZHVsZXMvbGlua2lmeS1pdC9ub2RlX21vZHVsZXMvdWMubWljcm8vY2F0ZWdvcmllcy9aL3JlZ2V4LmpzIiwibm9kZV9tb2R1bGVzL2xpbmtpZnktaXQvbm9kZV9tb2R1bGVzL3VjLm1pY3JvL3Byb3BlcnRpZXMvQW55L3JlZ2V4LmpzIiwibm9kZV9tb2R1bGVzL29iamVjdC1hc3NpZ24vaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDck1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3htQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoS0E7O0FDQUE7O0FDQUE7O0FDQUE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCd3cG1sOmNvbXBpbGVyJylcbnZhciBhc3NpZ24gPSByZXF1aXJlKCdvYmplY3QtYXNzaWduJylcbnZhciBlc2NhcGUgPSByZXF1aXJlKCdlc2NhcGUtaHRtbCcpXG52YXIgbGlua2lmeSA9IHJlcXVpcmUoJ2xpbmtpZnktaXQnKSh7fSwge2Z1enp5RW1haWw6IGZhbHNlfSkudGxkcygnLm9uaW9uJywgdHJ1ZSlcbnZhciBjb25maWcgPSByZXF1aXJlKCcuL2NvbmZpZycpXG5cbi8vIGdlbmVyYXRlIGxvbmcgZW5vdWdoIHN0cmluZyBmb3IgY29kZSBpbmRlbmF0aW9uXG52YXIgSU5ERU5UID0gKGZ1bmN0aW9uIChsZW4pIHtcbiAgZm9yICh2YXIgc3RyID0gJyAgICAnOyBzdHIubGVuZ3RoIDwgbGVuOyBzdHIgKz0gc3RyKTtcbiAgcmV0dXJuIHN0clxufSkoODApO1xuXG5mdW5jdGlvbiBmaWx0ZXIodmFsdWUsIHJlKSB7XG4gIHZhciBzcmMgPSB2YWx1ZS5zcGxpdCgnICcpXG4gIHZhciByZXMgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHNyYy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZS50ZXN0KHNyY1tpXSkpIHJlcy5wdXNoKHNyY1tpXSlcbiAgfVxuICByZXR1cm4gcmVzLmpvaW4oJyAnKVxufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVGFnKHdvcmtlciwgdGFnKSB7XG4gIHZhciBvcHRzID0gd29ya2VyLm9wdHNcbiAgdmFyIG5hbWUgPSB0YWcubmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICBpZiAobmFtZSA9PT0gJ3NjcmlwdCcgJiYgIW9wdHMuamF2YXNjcmlwdCkgcmV0dXJuIHRydWVcbiAgaWYgKG9wdHMud2hpdGVsaXN0ICYmIG9wdHMud2hpdGVsaXN0LmluZGV4T2YobmFtZSkgPT09IC0xKSByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiBhdHRyKG9wdHMsIG5hbWUsIHZhbHVlKSB7XG4gIGlmICghb3B0cy5qYXZhc2NyaXB0ICYmIG9wdHMuaW5saW5lSnNUZXN0LnRlc3QodmFsdWUpKSByZXR1cm4gJyc7XG4gIGlmIChuYW1lID09PSAnaWQnICYmIG9wdHMuaWRUZXN0ICYmICFvcHRzLmlkVGVzdC50ZXN0KHZhbHVlKSkgdmFsdWUgPSAnJ1xuICBpZiAobmFtZSA9PT0gJ2NsYXNzJyAmJiBvcHRzLmNsYXNzVGVzdCkgdmFsdWUgPSBmaWx0ZXIodmFsdWUsIG9wdHMuY2xhc3NUZXN0KVxuICBcbiAgaWYgKHZhbHVlKSByZXR1cm4gZXNjYXBlKG5hbWUpICsgJz1cXFwiJyArIGVzY2FwZSh2YWx1ZSkgKyAnXFxcIidcbiAgZWxzZSByZXR1cm4gJydcbn1cblxuXG5mdW5jdGlvbiBjb21waWxlQXR0cnMod29ya2VyLCBhdHRycykge1xuICB2YXIgc3RyID0gJydcbiAgZm9yICh2YXIgbmFtZSBpbiAoYXR0cnMgfHwge30pKSB7XG4gICAgaWYgKGF0dHJzLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICB2YXIgdiA9IGF0dHIod29ya2VyLm9wdHMsIG5hbWUsIGF0dHJzW25hbWVdKVxuICAgICAgaWYgKHYpIHN0ciArPSAnICcgKyB2XG4gICAgfVxuICB9XG4gIGRlYnVnKCdhdHRycycsIGF0dHJzLCBzdHIpXG4gIHJldHVybiBzdHJcbn1cblxuLyoqXG4gICBFc2NhcGUgYW5kIHVybGl6ZSB0ZXh0LlxuKi9cbmZ1bmN0aW9uIHVybGl6ZSh3b3JrZXIsIHRleHQpIHtcbiAgdmFyIG1hdGNoZXMgPSBsaW5raWZ5Lm1hdGNoKHRleHQpXG4gIGlmICghbWF0Y2hlcykgcmV0dXJuIGVzY2FwZSh0ZXh0KVxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIGJ1ZiA9IFtdXG4gIGZvciAodmFyIGkgPSAwLCBtYXRjaDsgKG1hdGNoID0gbWF0Y2hlc1tpKytdKTsgKSB7XG4gICAgYnVmLnB1c2goZXNjYXBlKHRleHQuc2xpY2UobGFzdEluZGV4LCBtYXRjaC5pbmRleCkpKVxuICAgIHZhciBsaW5rID0ge3RhZzogdHJ1ZSwgbmFtZTogJ2EnLFxuICAgICAgICAgICAgICAgIGF0dHJzOiB7aHJlZjogbWF0Y2gudXJsfSwgdmFsdWU6IGVzY2FwZShtYXRjaC50ZXh0KX1cbiAgICBidWYgPSBidWYuY29uY2F0KHRhZ0J1ZmZlcih3b3JrZXIsIGxpbmssIHRydWUpKVxuICAgIGxhc3RJbmRleCA9IG1hdGNoLmxhc3RJbmRleFxuICB9XG4gIGJ1Zi5wdXNoKGVzY2FwZSh0ZXh0LnNsaWNlKGxhc3RJbmRleCkpKVxuICBkZWJ1ZygndXJsaXplJywgbWF0Y2hlcywgYnVmKVxuICByZXR1cm4gYnVmLmpvaW4oJycpXG59XG5cblxuZnVuY3Rpb24gdGFnQnVmZmVyKHdvcmtlciwgZGF0YSwgdXJsaXplZCkge1xuICB2YXIgbmFtZSA9IGVzY2FwZShkYXRhLm5hbWUpXG4gIHZhciBidWYgPSBbJzwnLCBuYW1lLCBjb21waWxlQXR0cnMod29ya2VyLCBkYXRhLmF0dHJzIHx8IHt9KSwgJz4nXVxuICBpZiAoZGF0YS50YWcgJiYgZGF0YS52YWx1ZSkge1xuICAgIGJ1Zi5wdXNoKHVybGl6ZWQgPyBkYXRhLnZhbHVlIDogdXJsaXplKHdvcmtlciwgZGF0YS52YWx1ZSkpXG4gICAgYnVmLnB1c2goJzwvJywgbmFtZSwgJz4nKVxuICB9XG4gIGRlYnVnKCd0YWdCdWZmZXInLCBidWYpXG4gIHJldHVybiBidWZcbn1cblxuXG4vKipcbiAgIEByZXR1cm4gRXNjYXBlZCB2ZXJpc29uIG9mIHRoZSBkaXNhYmxlZCBtYXJrdXAuXG4qL1xuZnVuY3Rpb24gZXNjYXBlRGlzYWJsZWRUYWcod29ya2VyLCBkYXRhKSB7XG4gIHZhciBjb250ZW50ID0gKHR5cGVvZiBkYXRhLnZhbHVlID09PSAnc3RyaW5nJyA/IGRhdGEudmFsdWUgOiAnLi4uJylcbiAgd29ya2VyLmZvcm1hdChlc2NhcGUoXG4gICAgJzwnICsgZGF0YS5uYW1lICsgY29tcGlsZUF0dHJzKHdvcmtlciwgZGF0YS5hdHRycykgKyAnPicgK1xuICAgICAgY29udGVudCArICc8LycgKyBkYXRhLm5hbWUgKyAnPicpKVxufVxuXG5mdW5jdGlvbiBvcGVuVGFnKHdvcmtlciwgZGF0YSkge1xuICB3b3JrZXIuZm9ybWF0LmFwcGx5KG51bGwsIHRhZ0J1ZmZlcih3b3JrZXIsIGRhdGEpKVxufVxuXG5mdW5jdGlvbiBjb21waWxlVGFnKGRhdGEsIHdvcmtlcikge1xuICB2YXIgbmFtZSA9IGRhdGEubmFtZVxuICB2YXIgcGx1Z2luID0gd29ya2VyLm9wdHMucGx1Z2luc1tuYW1lXVxuICBpZiAocGx1Z2luKSByZXR1cm4gd29ya2VyLmZvcm1hdChwbHVnaW4oZGF0YSkpXG5cbiAgaWYgKGRhdGEubmFtZSAmJiBpc0Rpc2FibGVkVGFnKHdvcmtlciwgZGF0YSkpIHtcbiAgICBpZiAod29ya2VyLm9wdHMuZXhjbHVkZURpc2FibGVkVGFncykgcmV0dXJuXG4gICAgcmV0dXJuIGVzY2FwZURpc2FibGVkVGFnKHdvcmtlciwgZGF0YSlcbiAgfVxuXG4gIGlmIChkYXRhLmJsb2NrKSB7XG4gICAgb3BlblRhZyh3b3JrZXIsIGRhdGEpXG4gICAgd29ya2VyLnN0YWNrLnB1c2gobmFtZSlcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gZGF0YS52YWx1ZS5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgY29tcGlsZUxpbmUoZGF0YS52YWx1ZVtpXSwgd29ya2VyKVxuICAgIH1cbiAgICB3b3JrZXIuc3RhY2sucG9wKClcbiAgICB3b3JrZXIuZm9ybWF0KCc8LycsIG5hbWUsICc+JylcbiAgfSBlbHNlIHtcbiAgICAvLyBzaW5nbGUgb3Igb25lLWxpbmUgdGFnXG4gICAgb3BlblRhZyh3b3JrZXIsIGRhdGEpXG4gIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0VGFnKG5hbWUsIGVzY2FwZWQsIHdvcmtlcikge1xuICB3b3JrZXIuZm9ybWF0KCc8JywgbmFtZSwgJz4nLCBlc2NhcGVkLCAnPC8nLCBuYW1lLCAnPicpXG59XG5cbmZ1bmN0aW9uIGdldFNpbmdsZUxpbmVVcmwobGluZSkge1xuICB2YXIgbWF0Y2hlcyA9IGxpbmtpZnkubWF0Y2gobGluZSlcbiAgdmFyIHNpbmdsZSA9IG1hdGNoZXMgJiYgbWF0Y2hlcy5sZW5ndGggPT09IDEgJiYgbWF0Y2hlc1swXVxuICBpZiAoc2luZ2xlICYmIHNpbmdsZS5pbmRleCA9PT0gMCAmJiBzaW5nbGUubGFzdEluZGV4ID09PSBsaW5lLmxlbmd0aCkgcmV0dXJuIHNpbmdsZS51cmxcbn1cblxuZnVuY3Rpb24gY29tcGlsZVZhbHVlKGRhdGEsIHdvcmtlcikge1xuICBpZiAod29ya2VyLnN0YWNrLmxlbmd0aCkgcmV0dXJuIHdvcmtlci5mb3JtYXQodXJsaXplKHdvcmtlciwgZGF0YS52YWx1ZSkpXG5cbiAgdmFyIGxpbmtQbHVnaW4gPSB3b3JrZXIub3B0cy5wbHVnaW5zW3dvcmtlci5vcHRzLmxpbmtQbHVnaW5dXG4gIHZhciBzaW5nbGVVcmwgPSBnZXRTaW5nbGVMaW5lVXJsKGRhdGEudmFsdWUpXG4gIC8vZGVidWcoJ2NvbXBpbGVWYWx1ZScsIHNpbmdsZVVybCwgbGlua1BsdWdpbilcbiAgaWYgKGxpbmtQbHVnaW4gJiYgc2luZ2xlVXJsKSB3b3JrZXIuZm9ybWF0KGxpbmtQbHVnaW4oZGF0YSkpXG4gIGVsc2Ugd29ya2VyLmZvcm1hdCgnPCcsIGNvbmZpZy5kZWZhdWx0VGFnLCAnPicsXG4gICAgICAgICAgICAgICAgICAgICB1cmxpemUod29ya2VyLCBkYXRhLnZhbHVlKSxcbiAgICAgICAgICAgICAgICAgICAgICc8LycsIGNvbmZpZy5kZWZhdWx0VGFnLCAnPicpXG59XG5cbmZ1bmN0aW9uIHNsaWNlKGRhdGEpIHtcbiAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGRhdGEpXG59XG5cblxuZnVuY3Rpb24gY29tcGlsZUxpbmUoZGF0YSwgd29ya2VyKSB7XG4gIGRlYnVnKCdjb21waWxlTGluZScsIGRhdGEpXG4gIGlmIChkYXRhLm5hbWUpIGNvbXBpbGVUYWcoZGF0YSwgd29ya2VyKVxuICBlbHNlIGlmIChkYXRhLnZhbHVlKSBjb21waWxlVmFsdWUoZGF0YSwgd29ya2VyKVxuICBlbHNlIGNvbnNvbGUubG9nKCdJbnZhbGlkIGxpbmU6ICcsIGRhdGEpXG59XG5cblxuZnVuY3Rpb24gbWFrZVdvcmtlcihvcHRzKSB7XG4gIHZhciBidWYgPSBbXVxuICB2YXIgc3RhY2sgPSBbXVxuXG4gIGZ1bmN0aW9uIGZvcm1hdCgpIHtcbiAgICAvL2RlYnVnKCduZXcgbGluZTogJywgc2xpY2UoYXJndW1lbnRzKS5qb2luKCcnKSlcbiAgICBpZiAoYnVmLmxlbmd0aCkgYnVmLnB1c2goJ1xcbicpXG4gICAgaWYgKG9wdHMuaW5kZW50ICYmIHN0YWNrLmxlbmd0aCkgYnVmLnB1c2goSU5ERU5ULnNsaWNlKDAsIHN0YWNrLmxlbmd0aCAqIG9wdHMuaW5kZW50KSlcbiAgICBidWYucHVzaC5hcHBseShidWYsIHNsaWNlKGFyZ3VtZW50cykpXG4gIH1cbiAgXG4gIHJldHVybiB7b3B0czogb3B0cywgYnVmOiBidWYsIHN0YWNrOiBzdGFjaywgZm9ybWF0OiBmb3JtYXR9XG59XG5cblxuLyoqXG4gICBDb21waWxlIHBhcnNlZCBNTUwtZG9jdW1lbnQgaW50byBIVE1MLlxuICAgQHBhcmFtIHtvYmplY3R9IGFzdCBQYXJzZWQgV1BNTCBkb2N1bWVudFxuICAgQHBhcmFtIHtvYmplY3R9IG9wdHMgU2FtZSBhcyBvcHRzIGluIG1tbC5kb2NcbiAgIEByZXR1cm57IHN0cmluZ30gR2VuZXJhdGVkIGh0bWwgc3RyaW5nLiBcbiovXG5mdW5jdGlvbiBjb21waWxlKGFzdCwgb3B0cykge1xuICBvcHRzID0gYXNzaWduKHt9LCBjb25maWcuZGVmYXVsdE9wdHMsIG9wdHMpXG4gIGRlYnVnKCdjb21waWxlJywgb3B0cywgYXN0KVxuICB2YXIgd29ya2VyID0gbWFrZVdvcmtlcihvcHRzKVxuICBmb3IgKHZhciBpID0gMCwgdGV4dCA9IGFzdC52YWx1ZSwgbGVuID0gdGV4dC5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGNvbXBpbGVMaW5lKHRleHRbaV0sIHdvcmtlcilcbiAgfVxuICByZXR1cm4gd29ya2VyLmJ1Zi5qb2luKCcnKVxufVxuXG5cbm1vZHVsZS5leHBvcnRzID0gY29tcGlsZVxuXG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgZGVmYXVsdFRhZzogJ3AnLFxuICBkZWZhdWx0T3B0czoge1xuICAgIGphdmFzY3JpcHQ6IGZhbHNlLFxuICAgIGlubGluZUpzVGVzdDogL15qYXZhc2NyaXB0Oi9pLFxuICAgIGluZGVudDogMCxcbiAgICBwbHVnaW5zOiB7fSxcbiAgICBsaW5rUGx1Z2luOiBudWxsXG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBhcnNlciA9IHJlcXVpcmUoJy4vcGFyc2VyJylcbnZhciBjb21waWxlciA9IHJlcXVpcmUoJy4vY29tcGlsZXInKVxuXG4vKipcbiAgIENvbnZlcnRzIHRleHQgaW4gV1BNTCBmb3JtYXQgdG8gV1BNTCBkb2N1bWVudC5cbiAgIEBwYXJhbSB7c3RyaW5nfSB0ZXh0IFdQTUwgdGV4dFxuICAgQHBhcmFtIHtvYmplY3R9IG9wdHNcbiAgIEBwYXJhbSB7Ym9vbGVhbn0gW2phdmFzY3JpcHQ9ZmFsc2VdIEFsbG93IGlubGluZSBKUyBhbmQgc2NyaXB0IHRhZ3MgaW5zaWRlIFdQTUwgZG9jLlxuICAgQHBhcmFtIHtudW1iZXJ9IFtpbmRlbnQ9MF0gTnVtYmVyIG9mIHNwYWNlcyB1c2VkIGZvciBpbmRlbnRhdGlvbiBvZiBnZW5lcmF0ZWQgaHRtbC5cbiAgIEBwYXJhbSB7b2JqZWN0fSBbb3B0cy50cmFuc2Zvcm1zPXt9XSBMaXN0IG9mIHRhZ3MgdHJhbnNmb3JtcywgZm9yIGV4YW1wbGUgdG9cbiAgIHRyYW5zZm9ybSBhbGwgdHlwZXMgb2YgaGVhZGluZ3MgdG8gaDRcbiAgIHtcImgxXCI6IFwiaDRcIiwgXCJoMlwiOiBcImg0XCIsIFwiaDNcIjogXCJoNFwifS5cbiAgIEBwYXJhbSB7b2JqZWN0PHN0cmluZywgZnVuY3Rpb24+fSBbb3B0cy5wbHVnaW5zXSBDb252ZXJ0ZXJzIG9mIGVtYmVkZGVkIGNvbnRlbnQgb2JqZWN0c1xuICAgKFwieW91dHViZVwiLCBcImZhY2Vib29rXCIsIFwiZ2FsbGVyeVwiLCBcImh0bWxcIi4gRWFjaCBjb252ZXJ0ZXIgc2hvdWxkIHByb2R1Y2UgaHRtbFxuICAgc3RyaW5nIHRvIHJlcGxhY2UgY29udGVudCBvYmplY3Q6XG4gICB7XCJ5b3V0dWJlXCI6IGZ1bmN0aW9uKG9iaikgey4uLn19XG4gICBcbiAgIEByZXR1cm4ge29iamVjdH0gZG9jIFdQTUwgZG9jdW1lbnRcbiAgIEByZXR1cm4ge29iamVjdH0gZG9jLm1ldGEgTWV0YSBpbmZvcm1hdGlvbiAodGl0bGUsIHRhZ3MsIGV0YylcbiAgIEByZXR1cm4ge3N0cmluZ30gZG9jLmh0bWwgR2VuZXJhdGVkIEhUTUxcbiAgIFxuKi9cbmZ1bmN0aW9uIGRvYyh0ZXh0LCBvcHRzKSB7XG4gIHZhciBwYXJzZWQgPSBwYXJzZXIodGV4dClcbiAgcmV0dXJuIHtcbiAgICBtZXRhOiBwYXJzZWQuYXR0cnMsXG4gICAgaHRtbDogY29tcGlsZXIocGFyc2VkLCBvcHRzKVxuICB9XG59XG5cbmZ1bmN0aW9uIG1ldGEodGV4dCkge1xuICByZXR1cm4gcGFyc2VyKHRleHQpLmF0dHJzXG59XG5cbmZ1bmN0aW9uIHJlbmRlcih0ZXh0LCBvcHRzKSB7XG4gIHJldHVybiBjb21waWxlcihwYXJzZXIodGV4dCksIG9wdHMpXG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBwYXJzZTogcGFyc2VyLFxuICByZW5kZXJQYXJzZWQ6IGNvbXBpbGVyLFxuICByZW5kZXI6IHJlbmRlcixcbiAgaHRtbDogcmVuZGVyLFxuICBkb2M6IGRvYyxcbiAgbWV0YTogbWV0YSxcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGRlYnVnID0gcmVxdWlyZSgnZGVidWcnKSgnd3BtbDpwYXJzZXInKVxudmFyIGNvbmZpZyA9IHJlcXVpcmUoJy4vY29uZmlnJylcblxuLy8gaHR0cDovL3d3dy51bmljb2RlLm9yZy9yZXBvcnRzL3RyMTgvI0xpbmVfQm91bmRhcmllc1xudmFyIExJTkVfUkUgPSAvXFxzKig/OlxcclxcbnxbXFxuXFxyXFx2XFxmXFx4ODVcXHUyMDI4XFx1MjAyOV0pKy9cblxudmFyIE9QRU5fVEFHX1JFID0gL15cXHMqKFthLXpdK1tcXHdcXC1cXC4jXSopOiQvXG52YXIgQ0xPU0VfVEFHX1JFID0gL15cXHMqOihbYS16XStbXFx3XFwtXSopJC9cbnZhciBGVUxMX1RBR19SRSA9IC9eXFxzKihbIVxcLl0/KShbYS16XStbXFx3XFwtXFwuI10qKTpcXHMrKC4rKSQvXG52YXIgSU5WQUxJRF9UQUdfUkUgPSAvKFtcXC4jXXsyLH18Iy4rI3xbXFwuI10kKS9cblxudmFyIFNJTkdMRV9UQUdTID0gL14oaW1nfGhyfGJyKSQvXG5cblxuZnVuY3Rpb24gbWVyZ2VNZXRhKG1ldGEsIHRhcmdldCkge1xuICB0YXJnZXRbbWV0YS5uYW1lXSA9IG1ldGEudmFsdWVcbn1cblxuZnVuY3Rpb24gcGFyc2VBdHRycyh0b2tlbnMpIHtcbiAgdmFyIGF0dHJzID0ge31cbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHRva2Vucy5sZW5ndGggLSAxOyBpIDwgbGVuOyBpICs9IDIpIHtcbiAgICB2YXIgc2VwYXJhdG9yID0gdG9rZW5zW2ldXG4gICAgdmFyIHRva2VuID0gdG9rZW5zW2kgKyAxXVxuICAgIHN3aXRjaCAoc2VwYXJhdG9yKSB7XG4gICAgY2FzZSAnIyc6XG4gICAgICBhdHRycy5pZCA9IHRva2VuXG4gICAgICBicmVha1xuICAgIGNhc2UgJy4nOlxuICAgICAgaWYgKCFhdHRyc1snY2xhc3MnXSkgYXR0cnNbJ2NsYXNzJ10gPSB0b2tlblxuICAgICAgZWxzZSBhdHRyc1snY2xhc3MnXSArPSAnICcgKyB0b2tlblxuICAgICAgYnJlYWtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGF0dHJzXG59XG5cbmZ1bmN0aW9uIHBhcnNlVGFnKHN0ciwgdHlwZSwgdmFsdWUpIHtcbiAgdmFyIHRva2VucyA9IHN0ci5zcGxpdCgvKFxcLnwjKS8pXG4gIHZhciB0YWcgPSB7bmFtZTogdG9rZW5zLnNoaWZ0KCkgfHwgY29uZmlnLmRlZmF1bHRUYWd9XG4gIHZhciBhdHRycyA9IHBhcnNlQXR0cnModG9rZW5zKVxuICBpZiAoT2JqZWN0LmtleXMoYXR0cnMpLmxlbmd0aCkgdGFnLmF0dHJzID0gYXR0cnNcbiAgaWYgKHR5cGUpIHRhZ1t0eXBlXSA9IHRydWVcbiAgaWYgKHZhbHVlKSB0YWcudmFsdWUgPSB2YWx1ZVxuICBlbHNlIGlmICh0YWcuYmxvY2spIHRhZy52YWx1ZSA9IFtdXG4gIGRlYnVnKCd0b2tlbnMnLCB0b2tlbnMsICctPicsIHRhZylcbiAgcmV0dXJuIHRhZ1xufVxuXG5mdW5jdGlvbiBwcmVmaXhUeXBlKHByZWZpeCkge1xuICBzd2l0Y2ggKHByZWZpeCkge1xuICBjYXNlICchJzpcbiAgICByZXR1cm4gJ3Jvb3QnXG4gIGNhc2UgJy4nOlxuICAgIHJldHVybiAnYXR0cidcbiAgfVxuICByZXR1cm4gJ3RhZydcbn1cblxuZnVuY3Rpb24gcGFyc2VMaW5lKGxpbmUpIHtcbiAgdmFyIG1hdGNoLCBkYXRhXG4gIGlmICgobWF0Y2ggPSBsaW5lLm1hdGNoKEZVTExfVEFHX1JFKSkgJiYgIUlOVkFMSURfVEFHX1JFLnRlc3QobWF0Y2hbMl0pKSB7XG4gICAgcmV0dXJuIHBhcnNlVGFnKG1hdGNoWzJdLCBwcmVmaXhUeXBlKG1hdGNoWzFdKSwgbWF0Y2hbM10pXG4gIH0gZWxzZSBpZiAoKG1hdGNoID0gbGluZS5tYXRjaChPUEVOX1RBR19SRSkpICYmICFJTlZBTElEX1RBR19SRS50ZXN0KG1hdGNoWzFdKSkge1xuICAgIHZhciBzaW5nbGUgPSBTSU5HTEVfVEFHUy50ZXN0KG1hdGNoWzFdKSB8fCBtYXRjaFsyXVxuICAgIHJldHVybiBwYXJzZVRhZyhtYXRjaFsxXSwgc2luZ2xlID8gJ3RhZycgOiAnYmxvY2snKVxuICB9IGVsc2UgaWYgKChtYXRjaCA9IGxpbmUubWF0Y2goQ0xPU0VfVEFHX1JFKSkpIHtcbiAgICByZXR1cm4gcGFyc2VUYWcobWF0Y2hbMV0sICdibG9ja2VuZCcpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHt2YWx1ZTogbGluZX1cbiAgfVxufVxuXG5mdW5jdGlvbiBtZXJnZUludG9QYXJlbnQocGFyZW50LCBjaGlsZCkge1xuICBpZiAoIXBhcmVudC5hdHRycykgcGFyZW50LmF0dHJzID0ge31cbiAgcGFyZW50LmF0dHJzW2NoaWxkLm5hbWVdID0gY2hpbGQudmFsdWVcbn1cblxuZnVuY3Rpb24gcHJvY2Vzc0xpbmUobGluZSwgZG9jLCBzdGFjaykge1xuICBpZiAobGluZS5ibG9ja2VuZCkge1xuICAgIGlmIChzdGFjay5sZW5ndGgpIHN0YWNrLnBvcCgpXG4gICAgZWxzZSBjb25zb2xlLmVycm9yKCdObyBvcGVuIHRhZyBmb3IgJywgbGluZSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIHZhciB0YXJnZXQgPSAoc3RhY2subGVuZ3RoID8gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV0gOiBkb2MpLnZhbHVlXG4gIHRhcmdldC5wdXNoKGxpbmUpXG5cbiAgaWYgKGxpbmUuYmxvY2spIHtcbiAgICBzdGFjay5wdXNoKGxpbmUpXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VMaW5lcyhsaW5lcykge1xuICB2YXIgZG9jID0ge2F0dHJzOiB7fSwgdmFsdWU6IFtdfVxuICB2YXIgc3RhY2sgPSBbXVxuICB2YXIgbGFzdFRhZ1xuICBmb3IgKHZhciBpID0gMCwgbGVuID0gbGluZXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VMaW5lKGxpbmVzW2ldKVxuICAgIGlmIChwYXJzZWQucm9vdCkgZG9jLmF0dHJzW3BhcnNlZC5uYW1lXSA9IHBhcnNlZC52YWx1ZVxuICAgIGVsc2UgaWYgKHBhcnNlZC5hdHRyKSB7XG4gICAgICBpZiAobGFzdFRhZykgbWVyZ2VJbnRvUGFyZW50KGxhc3RUYWcsIHBhcnNlZClcbiAgICAgIGVsc2UgY29uc29sZS5lcnJvcignTm8gcGFyZW50IHRhZyBmb3InLCBwYXJzZWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIGxhc3RUYWcgPSAocGFyc2VkLm5hbWUgPyBwYXJzZWQgOiBudWxsKVxuICAgICAgcHJvY2Vzc0xpbmUocGFyc2VkLCBkb2MsIHN0YWNrKVxuICAgIH1cbiAgfVxuICBpZiAoc3RhY2subGVuZ3RoKSB7XG4gICAgY29uc29sZS53YXJuKCdQYXJzZXIgZmluaXNoZWQgd2l0aCB1bmNsb3NlZCB0YWdzOlxcbicsIHN0YWNrKVxuICB9XG4gIHJldHVybiBkb2Ncbn1cblxuZnVuY3Rpb24gc3BsaXRMaW5lcyh0ZXh0KSB7XG4gIHZhciByYXcgPSB0ZXh0LnNwbGl0KExJTkVfUkUpXG4gIHZhciBsaW5lcyA9IFtdXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSByYXcubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICB2YXIgbGluZSA9IHJhd1tpXVxuICAgIGlmIChsaW5lKSBsaW5lcy5wdXNoKGxpbmUpXG4gIH1cbiAgcmV0dXJuIGxpbmVzXG59XG5cbi8qKlxuICAgUGFyc2UgdGV4dCBpbiBXUE1MIGZvcm1hdCBhbmQgcmV0dXJuIEpTT04gc3RydWN0dXJlIG9mIGEgZG9jdW1lbnQuXG4gICBAcGFyYW0ge3N0cmluZ30gdGV4dFxuICAgQHJldHVybiB7b2JqZWN0fVxuKi9cbmZ1bmN0aW9uIHBhcnNlKHRleHQpIHtcbiAgcmV0dXJuIHBhcnNlTGluZXMoc3BsaXRMaW5lcyh0ZXh0KSlcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBwYXJzZVxuIiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIHdlYiBicm93c2VyIGltcGxlbWVudGF0aW9uIG9mIGBkZWJ1ZygpYC5cbiAqXG4gKiBFeHBvc2UgYGRlYnVnKClgIGFzIHRoZSBtb2R1bGUuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9kZWJ1ZycpO1xuZXhwb3J0cy5sb2cgPSBsb2c7XG5leHBvcnRzLmZvcm1hdEFyZ3MgPSBmb3JtYXRBcmdzO1xuZXhwb3J0cy5zYXZlID0gc2F2ZTtcbmV4cG9ydHMubG9hZCA9IGxvYWQ7XG5leHBvcnRzLnVzZUNvbG9ycyA9IHVzZUNvbG9ycztcbmV4cG9ydHMuc3RvcmFnZSA9ICd1bmRlZmluZWQnICE9IHR5cGVvZiBjaHJvbWVcbiAgICAgICAgICAgICAgICYmICd1bmRlZmluZWQnICE9IHR5cGVvZiBjaHJvbWUuc3RvcmFnZVxuICAgICAgICAgICAgICAgICAgPyBjaHJvbWUuc3RvcmFnZS5sb2NhbFxuICAgICAgICAgICAgICAgICAgOiBsb2NhbHN0b3JhZ2UoKTtcblxuLyoqXG4gKiBDb2xvcnMuXG4gKi9cblxuZXhwb3J0cy5jb2xvcnMgPSBbXG4gICdsaWdodHNlYWdyZWVuJyxcbiAgJ2ZvcmVzdGdyZWVuJyxcbiAgJ2dvbGRlbnJvZCcsXG4gICdkb2RnZXJibHVlJyxcbiAgJ2RhcmtvcmNoaWQnLFxuICAnY3JpbXNvbidcbl07XG5cbi8qKlxuICogQ3VycmVudGx5IG9ubHkgV2ViS2l0LWJhc2VkIFdlYiBJbnNwZWN0b3JzLCBGaXJlZm94ID49IHYzMSxcbiAqIGFuZCB0aGUgRmlyZWJ1ZyBleHRlbnNpb24gKGFueSBGaXJlZm94IHZlcnNpb24pIGFyZSBrbm93blxuICogdG8gc3VwcG9ydCBcIiVjXCIgQ1NTIGN1c3RvbWl6YXRpb25zLlxuICpcbiAqIFRPRE86IGFkZCBhIGBsb2NhbFN0b3JhZ2VgIHZhcmlhYmxlIHRvIGV4cGxpY2l0bHkgZW5hYmxlL2Rpc2FibGUgY29sb3JzXG4gKi9cblxuZnVuY3Rpb24gdXNlQ29sb3JzKCkge1xuICAvLyBpcyB3ZWJraXQ/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzE2NDU5NjA2LzM3Njc3M1xuICByZXR1cm4gKCdXZWJraXRBcHBlYXJhbmNlJyBpbiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGUpIHx8XG4gICAgLy8gaXMgZmlyZWJ1Zz8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMzk4MTIwLzM3Njc3M1xuICAgICh3aW5kb3cuY29uc29sZSAmJiAoY29uc29sZS5maXJlYnVnIHx8IChjb25zb2xlLmV4Y2VwdGlvbiAmJiBjb25zb2xlLnRhYmxlKSkpIHx8XG4gICAgLy8gaXMgZmlyZWZveCA+PSB2MzE/XG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9Ub29scy9XZWJfQ29uc29sZSNTdHlsaW5nX21lc3NhZ2VzXG4gICAgKG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvZmlyZWZveFxcLyhcXGQrKS8pICYmIHBhcnNlSW50KFJlZ0V4cC4kMSwgMTApID49IDMxKTtcbn1cblxuLyoqXG4gKiBNYXAgJWogdG8gYEpTT04uc3RyaW5naWZ5KClgLCBzaW5jZSBubyBXZWIgSW5zcGVjdG9ycyBkbyB0aGF0IGJ5IGRlZmF1bHQuXG4gKi9cblxuZXhwb3J0cy5mb3JtYXR0ZXJzLmogPSBmdW5jdGlvbih2KSB7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbn07XG5cblxuLyoqXG4gKiBDb2xvcml6ZSBsb2cgYXJndW1lbnRzIGlmIGVuYWJsZWQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBmb3JtYXRBcmdzKCkge1xuICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgdmFyIHVzZUNvbG9ycyA9IHRoaXMudXNlQ29sb3JzO1xuXG4gIGFyZ3NbMF0gPSAodXNlQ29sb3JzID8gJyVjJyA6ICcnKVxuICAgICsgdGhpcy5uYW1lc3BhY2VcbiAgICArICh1c2VDb2xvcnMgPyAnICVjJyA6ICcgJylcbiAgICArIGFyZ3NbMF1cbiAgICArICh1c2VDb2xvcnMgPyAnJWMgJyA6ICcgJylcbiAgICArICcrJyArIGV4cG9ydHMuaHVtYW5pemUodGhpcy5kaWZmKTtcblxuICBpZiAoIXVzZUNvbG9ycykgcmV0dXJuIGFyZ3M7XG5cbiAgdmFyIGMgPSAnY29sb3I6ICcgKyB0aGlzLmNvbG9yO1xuICBhcmdzID0gW2FyZ3NbMF0sIGMsICdjb2xvcjogaW5oZXJpdCddLmNvbmNhdChBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmdzLCAxKSk7XG5cbiAgLy8gdGhlIGZpbmFsIFwiJWNcIiBpcyBzb21ld2hhdCB0cmlja3ksIGJlY2F1c2UgdGhlcmUgY291bGQgYmUgb3RoZXJcbiAgLy8gYXJndW1lbnRzIHBhc3NlZCBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSAlYywgc28gd2UgbmVlZCB0b1xuICAvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IGluZGV4IHRvIGluc2VydCB0aGUgQ1NTIGludG9cbiAgdmFyIGluZGV4ID0gMDtcbiAgdmFyIGxhc3RDID0gMDtcbiAgYXJnc1swXS5yZXBsYWNlKC8lW2EteiVdL2csIGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgaWYgKCclJScgPT09IG1hdGNoKSByZXR1cm47XG4gICAgaW5kZXgrKztcbiAgICBpZiAoJyVjJyA9PT0gbWF0Y2gpIHtcbiAgICAgIC8vIHdlIG9ubHkgYXJlIGludGVyZXN0ZWQgaW4gdGhlICpsYXN0KiAlY1xuICAgICAgLy8gKHRoZSB1c2VyIG1heSBoYXZlIHByb3ZpZGVkIHRoZWlyIG93bilcbiAgICAgIGxhc3RDID0gaW5kZXg7XG4gICAgfVxuICB9KTtcblxuICBhcmdzLnNwbGljZShsYXN0QywgMCwgYyk7XG4gIHJldHVybiBhcmdzO1xufVxuXG4vKipcbiAqIEludm9rZXMgYGNvbnNvbGUubG9nKClgIHdoZW4gYXZhaWxhYmxlLlxuICogTm8tb3Agd2hlbiBgY29uc29sZS5sb2dgIGlzIG5vdCBhIFwiZnVuY3Rpb25cIi5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gdGhpcyBoYWNrZXJ5IGlzIHJlcXVpcmVkIGZvciBJRTgvOSwgd2hlcmVcbiAgLy8gdGhlIGBjb25zb2xlLmxvZ2AgZnVuY3Rpb24gZG9lc24ndCBoYXZlICdhcHBseSdcbiAgcmV0dXJuICdvYmplY3QnID09PSB0eXBlb2YgY29uc29sZVxuICAgICYmIGNvbnNvbGUubG9nXG4gICAgJiYgRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5LmNhbGwoY29uc29sZS5sb2csIGNvbnNvbGUsIGFyZ3VtZW50cyk7XG59XG5cbi8qKlxuICogU2F2ZSBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNhdmUobmFtZXNwYWNlcykge1xuICB0cnkge1xuICAgIGlmIChudWxsID09IG5hbWVzcGFjZXMpIHtcbiAgICAgIGV4cG9ydHMuc3RvcmFnZS5yZW1vdmVJdGVtKCdkZWJ1ZycpO1xuICAgIH0gZWxzZSB7XG4gICAgICBleHBvcnRzLnN0b3JhZ2UuZGVidWcgPSBuYW1lc3BhY2VzO1xuICAgIH1cbiAgfSBjYXRjaChlKSB7fVxufVxuXG4vKipcbiAqIExvYWQgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgcHJldmlvdXNseSBwZXJzaXN0ZWQgZGVidWcgbW9kZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvYWQoKSB7XG4gIHZhciByO1xuICB0cnkge1xuICAgIHIgPSBleHBvcnRzLnN0b3JhZ2UuZGVidWc7XG4gIH0gY2F0Y2goZSkge31cbiAgcmV0dXJuIHI7XG59XG5cbi8qKlxuICogRW5hYmxlIG5hbWVzcGFjZXMgbGlzdGVkIGluIGBsb2NhbFN0b3JhZ2UuZGVidWdgIGluaXRpYWxseS5cbiAqL1xuXG5leHBvcnRzLmVuYWJsZShsb2FkKCkpO1xuXG4vKipcbiAqIExvY2Fsc3RvcmFnZSBhdHRlbXB0cyB0byByZXR1cm4gdGhlIGxvY2Fsc3RvcmFnZS5cbiAqXG4gKiBUaGlzIGlzIG5lY2Vzc2FyeSBiZWNhdXNlIHNhZmFyaSB0aHJvd3NcbiAqIHdoZW4gYSB1c2VyIGRpc2FibGVzIGNvb2tpZXMvbG9jYWxzdG9yYWdlXG4gKiBhbmQgeW91IGF0dGVtcHQgdG8gYWNjZXNzIGl0LlxuICpcbiAqIEByZXR1cm4ge0xvY2FsU3RvcmFnZX1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvY2Fsc3RvcmFnZSgpe1xuICB0cnkge1xuICAgIHJldHVybiB3aW5kb3cubG9jYWxTdG9yYWdlO1xuICB9IGNhdGNoIChlKSB7fVxufVxuIiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIGNvbW1vbiBsb2dpYyBmb3IgYm90aCB0aGUgTm9kZS5qcyBhbmQgd2ViIGJyb3dzZXJcbiAqIGltcGxlbWVudGF0aW9ucyBvZiBgZGVidWcoKWAuXG4gKlxuICogRXhwb3NlIGBkZWJ1ZygpYCBhcyB0aGUgbW9kdWxlLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IGRlYnVnO1xuZXhwb3J0cy5jb2VyY2UgPSBjb2VyY2U7XG5leHBvcnRzLmRpc2FibGUgPSBkaXNhYmxlO1xuZXhwb3J0cy5lbmFibGUgPSBlbmFibGU7XG5leHBvcnRzLmVuYWJsZWQgPSBlbmFibGVkO1xuZXhwb3J0cy5odW1hbml6ZSA9IHJlcXVpcmUoJ21zJyk7XG5cbi8qKlxuICogVGhlIGN1cnJlbnRseSBhY3RpdmUgZGVidWcgbW9kZSBuYW1lcywgYW5kIG5hbWVzIHRvIHNraXAuXG4gKi9cblxuZXhwb3J0cy5uYW1lcyA9IFtdO1xuZXhwb3J0cy5za2lwcyA9IFtdO1xuXG4vKipcbiAqIE1hcCBvZiBzcGVjaWFsIFwiJW5cIiBoYW5kbGluZyBmdW5jdGlvbnMsIGZvciB0aGUgZGVidWcgXCJmb3JtYXRcIiBhcmd1bWVudC5cbiAqXG4gKiBWYWxpZCBrZXkgbmFtZXMgYXJlIGEgc2luZ2xlLCBsb3dlcmNhc2VkIGxldHRlciwgaS5lLiBcIm5cIi5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdHRlcnMgPSB7fTtcblxuLyoqXG4gKiBQcmV2aW91c2x5IGFzc2lnbmVkIGNvbG9yLlxuICovXG5cbnZhciBwcmV2Q29sb3IgPSAwO1xuXG4vKipcbiAqIFByZXZpb3VzIGxvZyB0aW1lc3RhbXAuXG4gKi9cblxudmFyIHByZXZUaW1lO1xuXG4vKipcbiAqIFNlbGVjdCBhIGNvbG9yLlxuICpcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNlbGVjdENvbG9yKCkge1xuICByZXR1cm4gZXhwb3J0cy5jb2xvcnNbcHJldkNvbG9yKysgJSBleHBvcnRzLmNvbG9ycy5sZW5ndGhdO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIGRlYnVnZ2VyIHdpdGggdGhlIGdpdmVuIGBuYW1lc3BhY2VgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VcbiAqIEByZXR1cm4ge0Z1bmN0aW9ufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBkZWJ1ZyhuYW1lc3BhY2UpIHtcblxuICAvLyBkZWZpbmUgdGhlIGBkaXNhYmxlZGAgdmVyc2lvblxuICBmdW5jdGlvbiBkaXNhYmxlZCgpIHtcbiAgfVxuICBkaXNhYmxlZC5lbmFibGVkID0gZmFsc2U7XG5cbiAgLy8gZGVmaW5lIHRoZSBgZW5hYmxlZGAgdmVyc2lvblxuICBmdW5jdGlvbiBlbmFibGVkKCkge1xuXG4gICAgdmFyIHNlbGYgPSBlbmFibGVkO1xuXG4gICAgLy8gc2V0IGBkaWZmYCB0aW1lc3RhbXBcbiAgICB2YXIgY3VyciA9ICtuZXcgRGF0ZSgpO1xuICAgIHZhciBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG4gICAgc2VsZi5kaWZmID0gbXM7XG4gICAgc2VsZi5wcmV2ID0gcHJldlRpbWU7XG4gICAgc2VsZi5jdXJyID0gY3VycjtcbiAgICBwcmV2VGltZSA9IGN1cnI7XG5cbiAgICAvLyBhZGQgdGhlIGBjb2xvcmAgaWYgbm90IHNldFxuICAgIGlmIChudWxsID09IHNlbGYudXNlQ29sb3JzKSBzZWxmLnVzZUNvbG9ycyA9IGV4cG9ydHMudXNlQ29sb3JzKCk7XG4gICAgaWYgKG51bGwgPT0gc2VsZi5jb2xvciAmJiBzZWxmLnVzZUNvbG9ycykgc2VsZi5jb2xvciA9IHNlbGVjdENvbG9yKCk7XG5cbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICBhcmdzWzBdID0gZXhwb3J0cy5jb2VyY2UoYXJnc1swXSk7XG5cbiAgICBpZiAoJ3N0cmluZycgIT09IHR5cGVvZiBhcmdzWzBdKSB7XG4gICAgICAvLyBhbnl0aGluZyBlbHNlIGxldCdzIGluc3BlY3Qgd2l0aCAlb1xuICAgICAgYXJncyA9IFsnJW8nXS5jb25jYXQoYXJncyk7XG4gICAgfVxuXG4gICAgLy8gYXBwbHkgYW55IGBmb3JtYXR0ZXJzYCB0cmFuc2Zvcm1hdGlvbnNcbiAgICB2YXIgaW5kZXggPSAwO1xuICAgIGFyZ3NbMF0gPSBhcmdzWzBdLnJlcGxhY2UoLyUoW2EteiVdKS9nLCBmdW5jdGlvbihtYXRjaCwgZm9ybWF0KSB7XG4gICAgICAvLyBpZiB3ZSBlbmNvdW50ZXIgYW4gZXNjYXBlZCAlIHRoZW4gZG9uJ3QgaW5jcmVhc2UgdGhlIGFycmF5IGluZGV4XG4gICAgICBpZiAobWF0Y2ggPT09ICclJScpIHJldHVybiBtYXRjaDtcbiAgICAgIGluZGV4Kys7XG4gICAgICB2YXIgZm9ybWF0dGVyID0gZXhwb3J0cy5mb3JtYXR0ZXJzW2Zvcm1hdF07XG4gICAgICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGZvcm1hdHRlcikge1xuICAgICAgICB2YXIgdmFsID0gYXJnc1tpbmRleF07XG4gICAgICAgIG1hdGNoID0gZm9ybWF0dGVyLmNhbGwoc2VsZiwgdmFsKTtcblxuICAgICAgICAvLyBub3cgd2UgbmVlZCB0byByZW1vdmUgYGFyZ3NbaW5kZXhdYCBzaW5jZSBpdCdzIGlubGluZWQgaW4gdGhlIGBmb3JtYXRgXG4gICAgICAgIGFyZ3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgaW5kZXgtLTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaDtcbiAgICB9KTtcblxuICAgIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgZXhwb3J0cy5mb3JtYXRBcmdzKSB7XG4gICAgICBhcmdzID0gZXhwb3J0cy5mb3JtYXRBcmdzLmFwcGx5KHNlbGYsIGFyZ3MpO1xuICAgIH1cbiAgICB2YXIgbG9nRm4gPSBlbmFibGVkLmxvZyB8fCBleHBvcnRzLmxvZyB8fCBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuICAgIGxvZ0ZuLmFwcGx5KHNlbGYsIGFyZ3MpO1xuICB9XG4gIGVuYWJsZWQuZW5hYmxlZCA9IHRydWU7XG5cbiAgdmFyIGZuID0gZXhwb3J0cy5lbmFibGVkKG5hbWVzcGFjZSkgPyBlbmFibGVkIDogZGlzYWJsZWQ7XG5cbiAgZm4ubmFtZXNwYWNlID0gbmFtZXNwYWNlO1xuXG4gIHJldHVybiBmbjtcbn1cblxuLyoqXG4gKiBFbmFibGVzIGEgZGVidWcgbW9kZSBieSBuYW1lc3BhY2VzLiBUaGlzIGNhbiBpbmNsdWRlIG1vZGVzXG4gKiBzZXBhcmF0ZWQgYnkgYSBjb2xvbiBhbmQgd2lsZGNhcmRzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVuYWJsZShuYW1lc3BhY2VzKSB7XG4gIGV4cG9ydHMuc2F2ZShuYW1lc3BhY2VzKTtcblxuICB2YXIgc3BsaXQgPSAobmFtZXNwYWNlcyB8fCAnJykuc3BsaXQoL1tcXHMsXSsvKTtcbiAgdmFyIGxlbiA9IHNwbGl0Lmxlbmd0aDtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKCFzcGxpdFtpXSkgY29udGludWU7IC8vIGlnbm9yZSBlbXB0eSBzdHJpbmdzXG4gICAgbmFtZXNwYWNlcyA9IHNwbGl0W2ldLnJlcGxhY2UoL1xcKi9nLCAnLio/Jyk7XG4gICAgaWYgKG5hbWVzcGFjZXNbMF0gPT09ICctJykge1xuICAgICAgZXhwb3J0cy5za2lwcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcy5zdWJzdHIoMSkgKyAnJCcpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZXhwb3J0cy5uYW1lcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcyArICckJykpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIERpc2FibGUgZGVidWcgb3V0cHV0LlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZGlzYWJsZSgpIHtcbiAgZXhwb3J0cy5lbmFibGUoJycpO1xufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgZ2l2ZW4gbW9kZSBuYW1lIGlzIGVuYWJsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZW5hYmxlZChuYW1lKSB7XG4gIHZhciBpLCBsZW47XG4gIGZvciAoaSA9IDAsIGxlbiA9IGV4cG9ydHMuc2tpcHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZiAoZXhwb3J0cy5za2lwc1tpXS50ZXN0KG5hbWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIGZvciAoaSA9IDAsIGxlbiA9IGV4cG9ydHMubmFtZXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZiAoZXhwb3J0cy5uYW1lc1tpXS50ZXN0KG5hbWUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIENvZXJjZSBgdmFsYC5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSB2YWxcbiAqIEByZXR1cm4ge01peGVkfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gY29lcmNlKHZhbCkge1xuICBpZiAodmFsIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiB2YWwuc3RhY2sgfHwgdmFsLm1lc3NhZ2U7XG4gIHJldHVybiB2YWw7XG59XG4iLCIvKipcbiAqIEhlbHBlcnMuXG4gKi9cblxudmFyIHMgPSAxMDAwO1xudmFyIG0gPSBzICogNjA7XG52YXIgaCA9IG0gKiA2MDtcbnZhciBkID0gaCAqIDI0O1xudmFyIHkgPSBkICogMzY1LjI1O1xuXG4vKipcbiAqIFBhcnNlIG9yIGZvcm1hdCB0aGUgZ2l2ZW4gYHZhbGAuXG4gKlxuICogT3B0aW9uczpcbiAqXG4gKiAgLSBgbG9uZ2AgdmVyYm9zZSBmb3JtYXR0aW5nIFtmYWxzZV1cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ3xOdW1iZXJ9IHZhbFxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEByZXR1cm4ge1N0cmluZ3xOdW1iZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odmFsLCBvcHRpb25zKXtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIGlmICgnc3RyaW5nJyA9PSB0eXBlb2YgdmFsKSByZXR1cm4gcGFyc2UodmFsKTtcbiAgcmV0dXJuIG9wdGlvbnMubG9uZ1xuICAgID8gbG9uZyh2YWwpXG4gICAgOiBzaG9ydCh2YWwpO1xufTtcblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gYHN0cmAgYW5kIHJldHVybiBtaWxsaXNlY29uZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gcGFyc2Uoc3RyKSB7XG4gIHN0ciA9ICcnICsgc3RyO1xuICBpZiAoc3RyLmxlbmd0aCA+IDEwMDAwKSByZXR1cm47XG4gIHZhciBtYXRjaCA9IC9eKCg/OlxcZCspP1xcLj9cXGQrKSAqKG1pbGxpc2Vjb25kcz98bXNlY3M/fG1zfHNlY29uZHM/fHNlY3M/fHN8bWludXRlcz98bWlucz98bXxob3Vycz98aHJzP3xofGRheXM/fGR8eWVhcnM/fHlycz98eSk/JC9pLmV4ZWMoc3RyKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuICB2YXIgbiA9IHBhcnNlRmxvYXQobWF0Y2hbMV0pO1xuICB2YXIgdHlwZSA9IChtYXRjaFsyXSB8fCAnbXMnKS50b0xvd2VyQ2FzZSgpO1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlICd5ZWFycyc6XG4gICAgY2FzZSAneWVhcic6XG4gICAgY2FzZSAneXJzJzpcbiAgICBjYXNlICd5cic6XG4gICAgY2FzZSAneSc6XG4gICAgICByZXR1cm4gbiAqIHk7XG4gICAgY2FzZSAnZGF5cyc6XG4gICAgY2FzZSAnZGF5JzpcbiAgICBjYXNlICdkJzpcbiAgICAgIHJldHVybiBuICogZDtcbiAgICBjYXNlICdob3Vycyc6XG4gICAgY2FzZSAnaG91cic6XG4gICAgY2FzZSAnaHJzJzpcbiAgICBjYXNlICdocic6XG4gICAgY2FzZSAnaCc6XG4gICAgICByZXR1cm4gbiAqIGg7XG4gICAgY2FzZSAnbWludXRlcyc6XG4gICAgY2FzZSAnbWludXRlJzpcbiAgICBjYXNlICdtaW5zJzpcbiAgICBjYXNlICdtaW4nOlxuICAgIGNhc2UgJ20nOlxuICAgICAgcmV0dXJuIG4gKiBtO1xuICAgIGNhc2UgJ3NlY29uZHMnOlxuICAgIGNhc2UgJ3NlY29uZCc6XG4gICAgY2FzZSAnc2Vjcyc6XG4gICAgY2FzZSAnc2VjJzpcbiAgICBjYXNlICdzJzpcbiAgICAgIHJldHVybiBuICogcztcbiAgICBjYXNlICdtaWxsaXNlY29uZHMnOlxuICAgIGNhc2UgJ21pbGxpc2Vjb25kJzpcbiAgICBjYXNlICdtc2Vjcyc6XG4gICAgY2FzZSAnbXNlYyc6XG4gICAgY2FzZSAnbXMnOlxuICAgICAgcmV0dXJuIG47XG4gIH1cbn1cblxuLyoqXG4gKiBTaG9ydCBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzaG9ydChtcykge1xuICBpZiAobXMgPj0gZCkgcmV0dXJuIE1hdGgucm91bmQobXMgLyBkKSArICdkJztcbiAgaWYgKG1zID49IGgpIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gaCkgKyAnaCc7XG4gIGlmIChtcyA+PSBtKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIG0pICsgJ20nO1xuICBpZiAobXMgPj0gcykgcmV0dXJuIE1hdGgucm91bmQobXMgLyBzKSArICdzJztcbiAgcmV0dXJuIG1zICsgJ21zJztcbn1cblxuLyoqXG4gKiBMb25nIGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvbmcobXMpIHtcbiAgcmV0dXJuIHBsdXJhbChtcywgZCwgJ2RheScpXG4gICAgfHwgcGx1cmFsKG1zLCBoLCAnaG91cicpXG4gICAgfHwgcGx1cmFsKG1zLCBtLCAnbWludXRlJylcbiAgICB8fCBwbHVyYWwobXMsIHMsICdzZWNvbmQnKVxuICAgIHx8IG1zICsgJyBtcyc7XG59XG5cbi8qKlxuICogUGx1cmFsaXphdGlvbiBoZWxwZXIuXG4gKi9cblxuZnVuY3Rpb24gcGx1cmFsKG1zLCBuLCBuYW1lKSB7XG4gIGlmIChtcyA8IG4pIHJldHVybjtcbiAgaWYgKG1zIDwgbiAqIDEuNSkgcmV0dXJuIE1hdGguZmxvb3IobXMgLyBuKSArICcgJyArIG5hbWU7XG4gIHJldHVybiBNYXRoLmNlaWwobXMgLyBuKSArICcgJyArIG5hbWUgKyAncyc7XG59XG4iLCIvKiFcbiAqIGVzY2FwZS1odG1sXG4gKiBDb3B5cmlnaHQoYykgMjAxMi0yMDEzIFRKIEhvbG93YXljaHVrXG4gKiBNSVQgTGljZW5zZWRcbiAqL1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICogQHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZXNjYXBlSHRtbDtcblxuLyoqXG4gKiBFc2NhcGUgc3BlY2lhbCBjaGFyYWN0ZXJzIGluIHRoZSBnaXZlbiBzdHJpbmcgb2YgaHRtbC5cbiAqXG4gKiBAcGFyYW0gIHtzdHJpbmd9IHN0ciBUaGUgc3RyaW5nIHRvIGVzY2FwZSBmb3IgaW5zZXJ0aW5nIGludG8gSFRNTFxuICogQHJldHVybiB7c3RyaW5nfVxuICogQHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwoaHRtbCkge1xuICByZXR1cm4gU3RyaW5nKGh0bWwpXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpXG4gICAgLnJlcGxhY2UoLycvZywgJyYjMzk7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKTtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuLy8gSGVscGVyc1xuXG4vLyBNZXJnZSBvYmplY3RzXG4vL1xuZnVuY3Rpb24gYXNzaWduKG9iaiAvKmZyb20xLCBmcm9tMiwgZnJvbTMsIC4uLiovKSB7XG4gIHZhciBzb3VyY2VzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcblxuICBzb3VyY2VzLmZvckVhY2goZnVuY3Rpb24gKHNvdXJjZSkge1xuICAgIGlmICghc291cmNlKSB7IHJldHVybjsgfVxuXG4gICAgT2JqZWN0LmtleXMoc291cmNlKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIG9ialtrZXldID0gc291cmNlW2tleV07XG4gICAgfSk7XG4gIH0pO1xuXG4gIHJldHVybiBvYmo7XG59XG5cbmZ1bmN0aW9uIF9jbGFzcyhvYmopIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvYmopOyB9XG5mdW5jdGlvbiBpc1N0cmluZyhvYmopIHsgcmV0dXJuIF9jbGFzcyhvYmopID09PSAnW29iamVjdCBTdHJpbmddJzsgfVxuZnVuY3Rpb24gaXNPYmplY3Qob2JqKSB7IHJldHVybiBfY2xhc3Mob2JqKSA9PT0gJ1tvYmplY3QgT2JqZWN0XSc7IH1cbmZ1bmN0aW9uIGlzUmVnRXhwKG9iaikgeyByZXR1cm4gX2NsYXNzKG9iaikgPT09ICdbb2JqZWN0IFJlZ0V4cF0nOyB9XG5mdW5jdGlvbiBpc0Z1bmN0aW9uKG9iaikgeyByZXR1cm4gX2NsYXNzKG9iaikgPT09ICdbb2JqZWN0IEZ1bmN0aW9uXSc7IH1cblxuXG5mdW5jdGlvbiBlc2NhcGVSRSAoc3RyKSB7IHJldHVybiBzdHIucmVwbGFjZSgvWy4/KiteJFtcXF1cXFxcKCl7fXwtXS9nLCAnXFxcXCQmJyk7IH1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuXG52YXIgZGVmYXVsdE9wdGlvbnMgPSB7XG4gIGZ1enp5TGluazogdHJ1ZSxcbiAgZnV6enlFbWFpbDogdHJ1ZSxcbiAgZnV6enlJUDogZmFsc2Vcbn07XG5cblxuZnVuY3Rpb24gaXNPcHRpb25zT2JqKG9iaikge1xuICByZXR1cm4gT2JqZWN0LmtleXMob2JqIHx8IHt9KS5yZWR1Y2UoZnVuY3Rpb24gKGFjYywgaykge1xuICAgIHJldHVybiBhY2MgfHwgZGVmYXVsdE9wdGlvbnMuaGFzT3duUHJvcGVydHkoayk7XG4gIH0sIGZhbHNlKTtcbn1cblxuXG52YXIgZGVmYXVsdFNjaGVtYXMgPSB7XG4gICdodHRwOic6IHtcbiAgICB2YWxpZGF0ZTogZnVuY3Rpb24gKHRleHQsIHBvcywgc2VsZikge1xuICAgICAgdmFyIHRhaWwgPSB0ZXh0LnNsaWNlKHBvcyk7XG5cbiAgICAgIGlmICghc2VsZi5yZS5odHRwKSB7XG4gICAgICAgIC8vIGNvbXBpbGUgbGF6aWx5LCBiZWNhdXNlIFwiaG9zdFwiLWNvbnRhaW5pbmcgdmFyaWFibGVzIGNhbiBjaGFuZ2Ugb24gdGxkcyB1cGRhdGUuXG4gICAgICAgIHNlbGYucmUuaHR0cCA9ICBuZXcgUmVnRXhwKFxuICAgICAgICAgICdeXFxcXC9cXFxcLycgKyBzZWxmLnJlLnNyY19hdXRoICsgc2VsZi5yZS5zcmNfaG9zdF9wb3J0X3N0cmljdCArIHNlbGYucmUuc3JjX3BhdGgsICdpJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKHNlbGYucmUuaHR0cC50ZXN0KHRhaWwpKSB7XG4gICAgICAgIHJldHVybiB0YWlsLm1hdGNoKHNlbGYucmUuaHR0cClbMF0ubGVuZ3RoO1xuICAgICAgfVxuICAgICAgcmV0dXJuIDA7XG4gICAgfVxuICB9LFxuICAnaHR0cHM6JzogICdodHRwOicsXG4gICdmdHA6JzogICAgJ2h0dHA6JyxcbiAgJy8vJzogICAgICB7XG4gICAgdmFsaWRhdGU6IGZ1bmN0aW9uICh0ZXh0LCBwb3MsIHNlbGYpIHtcbiAgICAgIHZhciB0YWlsID0gdGV4dC5zbGljZShwb3MpO1xuXG4gICAgICBpZiAoIXNlbGYucmUubm9faHR0cCkge1xuICAgICAgLy8gY29tcGlsZSBsYXppbHksIGJlY2F5c2UgXCJob3N0XCItY29udGFpbmluZyB2YXJpYWJsZXMgY2FuIGNoYW5nZSBvbiB0bGRzIHVwZGF0ZS5cbiAgICAgICAgc2VsZi5yZS5ub19odHRwID0gIG5ldyBSZWdFeHAoXG4gICAgICAgICAgJ14nICsgc2VsZi5yZS5zcmNfYXV0aCArIHNlbGYucmUuc3JjX2hvc3RfcG9ydF9zdHJpY3QgKyBzZWxmLnJlLnNyY19wYXRoLCAnaSdcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHNlbGYucmUubm9faHR0cC50ZXN0KHRhaWwpKSB7XG4gICAgICAgIC8vIHNob3VsZCBub3QgYmUgYDovL2AsIHRoYXQgcHJvdGVjdHMgZnJvbSBlcnJvcnMgaW4gcHJvdG9jb2wgbmFtZVxuICAgICAgICBpZiAocG9zID49IDMgJiYgdGV4dFtwb3MgLSAzXSA9PT0gJzonKSB7IHJldHVybiAwOyB9XG4gICAgICAgIHJldHVybiB0YWlsLm1hdGNoKHNlbGYucmUubm9faHR0cClbMF0ubGVuZ3RoO1xuICAgICAgfVxuICAgICAgcmV0dXJuIDA7XG4gICAgfVxuICB9LFxuICAnbWFpbHRvOic6IHtcbiAgICB2YWxpZGF0ZTogZnVuY3Rpb24gKHRleHQsIHBvcywgc2VsZikge1xuICAgICAgdmFyIHRhaWwgPSB0ZXh0LnNsaWNlKHBvcyk7XG5cbiAgICAgIGlmICghc2VsZi5yZS5tYWlsdG8pIHtcbiAgICAgICAgc2VsZi5yZS5tYWlsdG8gPSAgbmV3IFJlZ0V4cChcbiAgICAgICAgICAnXicgKyBzZWxmLnJlLnNyY19lbWFpbF9uYW1lICsgJ0AnICsgc2VsZi5yZS5zcmNfaG9zdF9zdHJpY3QsICdpJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKHNlbGYucmUubWFpbHRvLnRlc3QodGFpbCkpIHtcbiAgICAgICAgcmV0dXJuIHRhaWwubWF0Y2goc2VsZi5yZS5tYWlsdG8pWzBdLmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIHJldHVybiAwO1xuICAgIH1cbiAgfVxufTtcblxuLyplc2xpbnQtZGlzYWJsZSBtYXgtbGVuKi9cblxuLy8gUkUgcGF0dGVybiBmb3IgMi1jaGFyYWN0ZXIgdGxkcyAoYXV0b2dlbmVyYXRlZCBieSAuL3N1cHBvcnQvdGxkc18yY2hhcl9nZW4uanMpXG52YXIgdGxkc18yY2hfc3JjX3JlID0gJ2FbY2RlZmdpbG1ub3Fyc3R1d3h6XXxiW2FiZGVmZ2hpam1ub3JzdHZ3eXpdfGNbYWNkZmdoaWtsbW5vcnV2d3h5el18ZFtlamttb3pdfGVbY2VncnN0dV18Zltpamttb3JdfGdbYWJkZWZnaGlsbW5wcXJzdHV3eV18aFtrbW5ydHVdfGlbZGVsbW5vcXJzdF18altlbW9wXXxrW2VnaGltbnByd3l6XXxsW2FiY2lrcnN0dXZ5XXxtW2FjZGVnaGtsbW5vcHFyc3R1dnd4eXpdfG5bYWNlZmdpbG9wcnV6XXxvbXxwW2FlZmdoa2xtbnJzdHd5XXxxYXxyW2Vvc3V3XXxzW2FiY2RlZ2hpamtsbW5vcnR1dnh5el18dFtjZGZnaGprbG1ub3J0dnd6XXx1W2Fna3N5el18dlthY2VnaW51XXx3W2ZzXXx5W2V0XXx6W2Ftd10nO1xuXG4vLyBET04nVCB0cnkgdG8gbWFrZSBQUnMgd2l0aCBjaGFuZ2VzLiBFeHRlbmQgVExEcyB3aXRoIExpbmtpZnlJdC50bGRzKCkgaW5zdGVhZFxudmFyIHRsZHNfZGVmYXVsdCA9ICdiaXp8Y29tfGVkdXxnb3Z8bmV0fG9yZ3xwcm98d2VifHh4eHxhZXJvfGFzaWF8Y29vcHxpbmZvfG11c2V1bXxuYW1lfHNob3B80YDRhCcuc3BsaXQoJ3wnKTtcblxuLyplc2xpbnQtZW5hYmxlIG1heC1sZW4qL1xuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG5mdW5jdGlvbiByZXNldFNjYW5DYWNoZShzZWxmKSB7XG4gIHNlbGYuX19pbmRleF9fID0gLTE7XG4gIHNlbGYuX190ZXh0X2NhY2hlX18gICA9ICcnO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVWYWxpZGF0b3IocmUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICh0ZXh0LCBwb3MpIHtcbiAgICB2YXIgdGFpbCA9IHRleHQuc2xpY2UocG9zKTtcblxuICAgIGlmIChyZS50ZXN0KHRhaWwpKSB7XG4gICAgICByZXR1cm4gdGFpbC5tYXRjaChyZSlbMF0ubGVuZ3RoO1xuICAgIH1cbiAgICByZXR1cm4gMDtcbiAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTm9ybWFsaXplcigpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChtYXRjaCwgc2VsZikge1xuICAgIHNlbGYubm9ybWFsaXplKG1hdGNoKTtcbiAgfTtcbn1cblxuLy8gU2NoZW1hcyBjb21waWxlci4gQnVpbGQgcmVnZXhwcy5cbi8vXG5mdW5jdGlvbiBjb21waWxlKHNlbGYpIHtcblxuICAvLyBMb2FkICYgY2xvbmUgUkUgcGF0dGVybnMuXG4gIHZhciByZSA9IHNlbGYucmUgPSBhc3NpZ24oe30sIHJlcXVpcmUoJy4vbGliL3JlJykpO1xuXG4gIC8vIERlZmluZSBkeW5hbWljIHBhdHRlcm5zXG4gIHZhciB0bGRzID0gc2VsZi5fX3RsZHNfXy5zbGljZSgpO1xuXG4gIGlmICghc2VsZi5fX3RsZHNfcmVwbGFjZWRfXykge1xuICAgIHRsZHMucHVzaCh0bGRzXzJjaF9zcmNfcmUpO1xuICB9XG4gIHRsZHMucHVzaChyZS5zcmNfeG4pO1xuXG4gIHJlLnNyY190bGRzID0gdGxkcy5qb2luKCd8Jyk7XG5cbiAgZnVuY3Rpb24gdW50cGwodHBsKSB7IHJldHVybiB0cGwucmVwbGFjZSgnJVRMRFMlJywgcmUuc3JjX3RsZHMpOyB9XG5cbiAgcmUuZW1haWxfZnV6enkgICAgICA9IFJlZ0V4cCh1bnRwbChyZS50cGxfZW1haWxfZnV6enkpLCAnaScpO1xuICByZS5saW5rX2Z1enp5ICAgICAgID0gUmVnRXhwKHVudHBsKHJlLnRwbF9saW5rX2Z1enp5KSwgJ2knKTtcbiAgcmUubGlua19ub19pcF9mdXp6eSA9IFJlZ0V4cCh1bnRwbChyZS50cGxfbGlua19ub19pcF9mdXp6eSksICdpJyk7XG4gIHJlLmhvc3RfZnV6enlfdGVzdCAgPSBSZWdFeHAodW50cGwocmUudHBsX2hvc3RfZnV6enlfdGVzdCksICdpJyk7XG5cbiAgLy9cbiAgLy8gQ29tcGlsZSBlYWNoIHNjaGVtYVxuICAvL1xuXG4gIHZhciBhbGlhc2VzID0gW107XG5cbiAgc2VsZi5fX2NvbXBpbGVkX18gPSB7fTsgLy8gUmVzZXQgY29tcGlsZWQgZGF0YVxuXG4gIGZ1bmN0aW9uIHNjaGVtYUVycm9yKG5hbWUsIHZhbCkge1xuICAgIHRocm93IG5ldyBFcnJvcignKExpbmtpZnlJdCkgSW52YWxpZCBzY2hlbWEgXCInICsgbmFtZSArICdcIjogJyArIHZhbCk7XG4gIH1cblxuICBPYmplY3Qua2V5cyhzZWxmLl9fc2NoZW1hc19fKS5mb3JFYWNoKGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdmFyIHZhbCA9IHNlbGYuX19zY2hlbWFzX19bbmFtZV07XG5cbiAgICAvLyBza2lwIGRpc2FibGVkIG1ldGhvZHNcbiAgICBpZiAodmFsID09PSBudWxsKSB7IHJldHVybjsgfVxuXG4gICAgdmFyIGNvbXBpbGVkID0geyB2YWxpZGF0ZTogbnVsbCwgbGluazogbnVsbCB9O1xuXG4gICAgc2VsZi5fX2NvbXBpbGVkX19bbmFtZV0gPSBjb21waWxlZDtcblxuICAgIGlmIChpc09iamVjdCh2YWwpKSB7XG4gICAgICBpZiAoaXNSZWdFeHAodmFsLnZhbGlkYXRlKSkge1xuICAgICAgICBjb21waWxlZC52YWxpZGF0ZSA9IGNyZWF0ZVZhbGlkYXRvcih2YWwudmFsaWRhdGUpO1xuICAgICAgfSBlbHNlIGlmIChpc0Z1bmN0aW9uKHZhbC52YWxpZGF0ZSkpIHtcbiAgICAgICAgY29tcGlsZWQudmFsaWRhdGUgPSB2YWwudmFsaWRhdGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzY2hlbWFFcnJvcihuYW1lLCB2YWwpO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNGdW5jdGlvbih2YWwubm9ybWFsaXplKSkge1xuICAgICAgICBjb21waWxlZC5ub3JtYWxpemUgPSB2YWwubm9ybWFsaXplO1xuICAgICAgfSBlbHNlIGlmICghdmFsLm5vcm1hbGl6ZSkge1xuICAgICAgICBjb21waWxlZC5ub3JtYWxpemUgPSBjcmVhdGVOb3JtYWxpemVyKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzY2hlbWFFcnJvcihuYW1lLCB2YWwpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGlzU3RyaW5nKHZhbCkpIHtcbiAgICAgIGFsaWFzZXMucHVzaChuYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzY2hlbWFFcnJvcihuYW1lLCB2YWwpO1xuICB9KTtcblxuICAvL1xuICAvLyBDb21waWxlIHBvc3Rwb25lZCBhbGlhc2VzXG4gIC8vXG5cbiAgYWxpYXNlcy5mb3JFYWNoKGZ1bmN0aW9uIChhbGlhcykge1xuICAgIGlmICghc2VsZi5fX2NvbXBpbGVkX19bc2VsZi5fX3NjaGVtYXNfX1thbGlhc11dKSB7XG4gICAgICAvLyBTaWxlbnRseSBmYWlsIG9uIG1pc3NlZCBzY2hlbWFzIHRvIGF2b2lkIGVycm9ucyBvbiBkaXNhYmxlLlxuICAgICAgLy8gc2NoZW1hRXJyb3IoYWxpYXMsIHNlbGYuX19zY2hlbWFzX19bYWxpYXNdKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzZWxmLl9fY29tcGlsZWRfX1thbGlhc10udmFsaWRhdGUgPVxuICAgICAgc2VsZi5fX2NvbXBpbGVkX19bc2VsZi5fX3NjaGVtYXNfX1thbGlhc11dLnZhbGlkYXRlO1xuICAgIHNlbGYuX19jb21waWxlZF9fW2FsaWFzXS5ub3JtYWxpemUgPVxuICAgICAgc2VsZi5fX2NvbXBpbGVkX19bc2VsZi5fX3NjaGVtYXNfX1thbGlhc11dLm5vcm1hbGl6ZTtcbiAgfSk7XG5cbiAgLy9cbiAgLy8gRmFrZSByZWNvcmQgZm9yIGd1ZXNzZWQgbGlua3NcbiAgLy9cbiAgc2VsZi5fX2NvbXBpbGVkX19bJyddID0geyB2YWxpZGF0ZTogbnVsbCwgbm9ybWFsaXplOiBjcmVhdGVOb3JtYWxpemVyKCkgfTtcblxuICAvL1xuICAvLyBCdWlsZCBzY2hlbWEgY29uZGl0aW9uXG4gIC8vXG4gIHZhciBzbGlzdCA9IE9iamVjdC5rZXlzKHNlbGYuX19jb21waWxlZF9fKVxuICAgICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoZnVuY3Rpb24obmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRmlsdGVyIGRpc2FibGVkICYgZmFrZSBzY2hlbWFzXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmFtZS5sZW5ndGggPiAwICYmIHNlbGYuX19jb21waWxlZF9fW25hbWVdO1xuICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgLm1hcChlc2NhcGVSRSlcbiAgICAgICAgICAgICAgICAgICAgICAuam9pbignfCcpO1xuICAvLyAoPyFfKSBjYXVzZSAxLjV4IHNsb3dkb3duXG4gIHNlbGYucmUuc2NoZW1hX3Rlc3QgICA9IFJlZ0V4cCgnKF58KD8hXykoPzo+fCcgKyByZS5zcmNfWlBDYyArICcpKSgnICsgc2xpc3QgKyAnKScsICdpJyk7XG4gIHNlbGYucmUuc2NoZW1hX3NlYXJjaCA9IFJlZ0V4cCgnKF58KD8hXykoPzo+fCcgKyByZS5zcmNfWlBDYyArICcpKSgnICsgc2xpc3QgKyAnKScsICdpZycpO1xuXG4gIHNlbGYucmUucHJldGVzdCAgICAgICA9IFJlZ0V4cChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnKCcgKyBzZWxmLnJlLnNjaGVtYV90ZXN0LnNvdXJjZSArICcpfCcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICcoJyArIHNlbGYucmUuaG9zdF9mdXp6eV90ZXN0LnNvdXJjZSArICcpfCcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdAJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnaScpO1xuXG4gIC8vXG4gIC8vIENsZWFudXBcbiAgLy9cblxuICByZXNldFNjYW5DYWNoZShzZWxmKTtcbn1cblxuLyoqXG4gKiBjbGFzcyBNYXRjaFxuICpcbiAqIE1hdGNoIHJlc3VsdC4gU2luZ2xlIGVsZW1lbnQgb2YgYXJyYXksIHJldHVybmVkIGJ5IFtbTGlua2lmeUl0I21hdGNoXV1cbiAqKi9cbmZ1bmN0aW9uIE1hdGNoKHNlbGYsIHNoaWZ0KSB7XG4gIHZhciBzdGFydCA9IHNlbGYuX19pbmRleF9fLFxuICAgICAgZW5kICAgPSBzZWxmLl9fbGFzdF9pbmRleF9fLFxuICAgICAgdGV4dCAgPSBzZWxmLl9fdGV4dF9jYWNoZV9fLnNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gIC8qKlxuICAgKiBNYXRjaCNzY2hlbWEgLT4gU3RyaW5nXG4gICAqXG4gICAqIFByZWZpeCAocHJvdG9jb2wpIGZvciBtYXRjaGVkIHN0cmluZy5cbiAgICoqL1xuICB0aGlzLnNjaGVtYSAgICA9IHNlbGYuX19zY2hlbWFfXy50b0xvd2VyQ2FzZSgpO1xuICAvKipcbiAgICogTWF0Y2gjaW5kZXggLT4gTnVtYmVyXG4gICAqXG4gICAqIEZpcnN0IHBvc2l0aW9uIG9mIG1hdGNoZWQgc3RyaW5nLlxuICAgKiovXG4gIHRoaXMuaW5kZXggICAgID0gc3RhcnQgKyBzaGlmdDtcbiAgLyoqXG4gICAqIE1hdGNoI2xhc3RJbmRleCAtPiBOdW1iZXJcbiAgICpcbiAgICogTmV4dCBwb3NpdGlvbiBhZnRlciBtYXRjaGVkIHN0cmluZy5cbiAgICoqL1xuICB0aGlzLmxhc3RJbmRleCA9IGVuZCArIHNoaWZ0O1xuICAvKipcbiAgICogTWF0Y2gjcmF3IC0+IFN0cmluZ1xuICAgKlxuICAgKiBNYXRjaGVkIHN0cmluZy5cbiAgICoqL1xuICB0aGlzLnJhdyAgICAgICA9IHRleHQ7XG4gIC8qKlxuICAgKiBNYXRjaCN0ZXh0IC0+IFN0cmluZ1xuICAgKlxuICAgKiBOb3RtYWxpemVkIHRleHQgb2YgbWF0Y2hlZCBzdHJpbmcuXG4gICAqKi9cbiAgdGhpcy50ZXh0ICAgICAgPSB0ZXh0O1xuICAvKipcbiAgICogTWF0Y2gjdXJsIC0+IFN0cmluZ1xuICAgKlxuICAgKiBOb3JtYWxpemVkIHVybCBvZiBtYXRjaGVkIHN0cmluZy5cbiAgICoqL1xuICB0aGlzLnVybCAgICAgICA9IHRleHQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU1hdGNoKHNlbGYsIHNoaWZ0KSB7XG4gIHZhciBtYXRjaCA9IG5ldyBNYXRjaChzZWxmLCBzaGlmdCk7XG5cbiAgc2VsZi5fX2NvbXBpbGVkX19bbWF0Y2guc2NoZW1hXS5ub3JtYWxpemUobWF0Y2gsIHNlbGYpO1xuXG4gIHJldHVybiBtYXRjaDtcbn1cblxuXG4vKipcbiAqIGNsYXNzIExpbmtpZnlJdFxuICoqL1xuXG4vKipcbiAqIG5ldyBMaW5raWZ5SXQoc2NoZW1hcywgb3B0aW9ucylcbiAqIC0gc2NoZW1hcyAoT2JqZWN0KTogT3B0aW9uYWwuIEFkZGl0aW9uYWwgc2NoZW1hcyB0byB2YWxpZGF0ZSAocHJlZml4L3ZhbGlkYXRvcilcbiAqIC0gb3B0aW9ucyAoT2JqZWN0KTogeyBmdXp6eUxpbmt8ZnV6enlFbWFpbHxmdXp6eUlQOiB0cnVlfGZhbHNlIH1cbiAqXG4gKiBDcmVhdGVzIG5ldyBsaW5raWZpZXIgaW5zdGFuY2Ugd2l0aCBvcHRpb25hbCBhZGRpdGlvbmFsIHNjaGVtYXMuXG4gKiBDYW4gYmUgY2FsbGVkIHdpdGhvdXQgYG5ld2Aga2V5d29yZCBmb3IgY29udmVuaWVuY2UuXG4gKlxuICogQnkgZGVmYXVsdCB1bmRlcnN0YW5kczpcbiAqXG4gKiAtIGBodHRwKHMpOi8vLi4uYCAsIGBmdHA6Ly8uLi5gLCBgbWFpbHRvOi4uLmAgJiBgLy8uLi5gIGxpbmtzXG4gKiAtIFwiZnV6enlcIiBsaW5rcyBhbmQgZW1haWxzIChleGFtcGxlLmNvbSwgZm9vQGJhci5jb20pLlxuICpcbiAqIGBzY2hlbWFzYCBpcyBhbiBvYmplY3QsIHdoZXJlIGVhY2gga2V5L3ZhbHVlIGRlc2NyaWJlcyBwcm90b2NvbC9ydWxlOlxuICpcbiAqIC0gX19rZXlfXyAtIGxpbmsgcHJlZml4ICh1c3VhbGx5LCBwcm90b2NvbCBuYW1lIHdpdGggYDpgIGF0IHRoZSBlbmQsIGBza3lwZTpgXG4gKiAgIGZvciBleGFtcGxlKS4gYGxpbmtpZnktaXRgIG1ha2VzIHNodXJlIHRoYXQgcHJlZml4IGlzIG5vdCBwcmVjZWVkZWQgd2l0aFxuICogICBhbHBoYW51bWVyaWMgY2hhciBhbmQgc3ltYm9scy4gT25seSB3aGl0ZXNwYWNlcyBhbmQgcHVuY3R1YXRpb24gYWxsb3dlZC5cbiAqIC0gX192YWx1ZV9fIC0gcnVsZSB0byBjaGVjayB0YWlsIGFmdGVyIGxpbmsgcHJlZml4XG4gKiAgIC0gX1N0cmluZ18gLSBqdXN0IGFsaWFzIHRvIGV4aXN0aW5nIHJ1bGVcbiAqICAgLSBfT2JqZWN0X1xuICogICAgIC0gX3ZhbGlkYXRlXyAtIHZhbGlkYXRvciBmdW5jdGlvbiAoc2hvdWxkIHJldHVybiBtYXRjaGVkIGxlbmd0aCBvbiBzdWNjZXNzKSxcbiAqICAgICAgIG9yIGBSZWdFeHBgLlxuICogICAgIC0gX25vcm1hbGl6ZV8gLSBvcHRpb25hbCBmdW5jdGlvbiB0byBub3JtYWxpemUgdGV4dCAmIHVybCBvZiBtYXRjaGVkIHJlc3VsdFxuICogICAgICAgKGZvciBleGFtcGxlLCBmb3IgQHR3aXR0ZXIgbWVudGlvbnMpLlxuICpcbiAqIGBvcHRpb25zYDpcbiAqXG4gKiAtIF9fZnV6enlMaW5rX18gLSByZWNvZ25pZ2UgVVJMLXMgd2l0aG91dCBgaHR0cChzKTpgIHByZWZpeC4gRGVmYXVsdCBgdHJ1ZWAuXG4gKiAtIF9fZnV6enlJUF9fIC0gYWxsb3cgSVBzIGluIGZ1enp5IGxpbmtzIGFib3ZlLiBDYW4gY29uZmxpY3Qgd2l0aCBzb21lIHRleHRzXG4gKiAgIGxpa2UgdmVyc2lvbiBudW1iZXJzLiBEZWZhdWx0IGBmYWxzZWAuXG4gKiAtIF9fZnV6enlFbWFpbF9fIC0gcmVjb2duaXplIGVtYWlscyB3aXRob3V0IGBtYWlsdG86YCBwcmVmaXguXG4gKlxuICoqL1xuZnVuY3Rpb24gTGlua2lmeUl0KHNjaGVtYXMsIG9wdGlvbnMpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIExpbmtpZnlJdCkpIHtcbiAgICByZXR1cm4gbmV3IExpbmtpZnlJdChzY2hlbWFzLCBvcHRpb25zKTtcbiAgfVxuXG4gIGlmICghb3B0aW9ucykge1xuICAgIGlmIChpc09wdGlvbnNPYmooc2NoZW1hcykpIHtcbiAgICAgIG9wdGlvbnMgPSBzY2hlbWFzO1xuICAgICAgc2NoZW1hcyA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuX19vcHRzX18gICAgICAgICAgID0gYXNzaWduKHt9LCBkZWZhdWx0T3B0aW9ucywgb3B0aW9ucyk7XG5cbiAgLy8gQ2FjaGUgbGFzdCB0ZXN0ZWQgcmVzdWx0LiBVc2VkIHRvIHNraXAgcmVwZWF0aW5nIHN0ZXBzIG9uIG5leHQgYG1hdGNoYCBjYWxsLlxuICB0aGlzLl9faW5kZXhfXyAgICAgICAgICA9IC0xO1xuICB0aGlzLl9fbGFzdF9pbmRleF9fICAgICA9IC0xOyAvLyBOZXh0IHNjYW4gcG9zaXRpb25cbiAgdGhpcy5fX3NjaGVtYV9fICAgICAgICAgPSAnJztcbiAgdGhpcy5fX3RleHRfY2FjaGVfXyAgICAgPSAnJztcblxuICB0aGlzLl9fc2NoZW1hc19fICAgICAgICA9IGFzc2lnbih7fSwgZGVmYXVsdFNjaGVtYXMsIHNjaGVtYXMpO1xuICB0aGlzLl9fY29tcGlsZWRfXyAgICAgICA9IHt9O1xuXG4gIHRoaXMuX190bGRzX18gICAgICAgICAgID0gdGxkc19kZWZhdWx0O1xuICB0aGlzLl9fdGxkc19yZXBsYWNlZF9fICA9IGZhbHNlO1xuXG4gIHRoaXMucmUgPSB7fTtcblxuICBjb21waWxlKHRoaXMpO1xufVxuXG5cbi8qKiBjaGFpbmFibGVcbiAqIExpbmtpZnlJdCNhZGQoc2NoZW1hLCBkZWZpbml0aW9uKVxuICogLSBzY2hlbWEgKFN0cmluZyk6IHJ1bGUgbmFtZSAoZml4ZWQgcGF0dGVybiBwcmVmaXgpXG4gKiAtIGRlZmluaXRpb24gKFN0cmluZ3xSZWdFeHB8T2JqZWN0KTogc2NoZW1hIGRlZmluaXRpb25cbiAqXG4gKiBBZGQgbmV3IHJ1bGUgZGVmaW5pdGlvbi4gU2VlIGNvbnN0cnVjdG9yIGRlc2NyaXB0aW9uIGZvciBkZXRhaWxzLlxuICoqL1xuTGlua2lmeUl0LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQoc2NoZW1hLCBkZWZpbml0aW9uKSB7XG4gIHRoaXMuX19zY2hlbWFzX19bc2NoZW1hXSA9IGRlZmluaXRpb247XG4gIGNvbXBpbGUodGhpcyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuXG4vKiogY2hhaW5hYmxlXG4gKiBMaW5raWZ5SXQjc2V0KG9wdGlvbnMpXG4gKiAtIG9wdGlvbnMgKE9iamVjdCk6IHsgZnV6enlMaW5rfGZ1enp5RW1haWx8ZnV6enlJUDogdHJ1ZXxmYWxzZSB9XG4gKlxuICogU2V0IHJlY29nbml0aW9uIG9wdGlvbnMgZm9yIGxpbmtzIHdpdGhvdXQgc2NoZW1hLlxuICoqL1xuTGlua2lmeUl0LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQob3B0aW9ucykge1xuICB0aGlzLl9fb3B0c19fID0gYXNzaWduKHRoaXMuX19vcHRzX18sIG9wdGlvbnMpO1xuICByZXR1cm4gdGhpcztcbn07XG5cblxuLyoqXG4gKiBMaW5raWZ5SXQjdGVzdCh0ZXh0KSAtPiBCb29sZWFuXG4gKlxuICogU2VhcmNoZXMgbGlua2lmaWFibGUgcGF0dGVybiBhbmQgcmV0dXJucyBgdHJ1ZWAgb24gc3VjY2VzcyBvciBgZmFsc2VgIG9uIGZhaWwuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLnRlc3QgPSBmdW5jdGlvbiB0ZXN0KHRleHQpIHtcbiAgLy8gUmVzZXQgc2NhbiBjYWNoZVxuICB0aGlzLl9fdGV4dF9jYWNoZV9fID0gdGV4dDtcbiAgdGhpcy5fX2luZGV4X18gICAgICA9IC0xO1xuXG4gIGlmICghdGV4dC5sZW5ndGgpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgdmFyIG0sIG1sLCBtZSwgbGVuLCBzaGlmdCwgbmV4dCwgcmUsIHRsZF9wb3MsIGF0X3BvcztcblxuICAvLyB0cnkgdG8gc2NhbiBmb3IgbGluayB3aXRoIHNjaGVtYSAtIHRoYXQncyB0aGUgbW9zdCBzaW1wbGUgcnVsZVxuICBpZiAodGhpcy5yZS5zY2hlbWFfdGVzdC50ZXN0KHRleHQpKSB7XG4gICAgcmUgPSB0aGlzLnJlLnNjaGVtYV9zZWFyY2g7XG4gICAgcmUubGFzdEluZGV4ID0gMDtcbiAgICB3aGlsZSAoKG0gPSByZS5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgICAgbGVuID0gdGhpcy50ZXN0U2NoZW1hQXQodGV4dCwgbVsyXSwgcmUubGFzdEluZGV4KTtcbiAgICAgIGlmIChsZW4pIHtcbiAgICAgICAgdGhpcy5fX3NjaGVtYV9fICAgICA9IG1bMl07XG4gICAgICAgIHRoaXMuX19pbmRleF9fICAgICAgPSBtLmluZGV4ICsgbVsxXS5sZW5ndGg7XG4gICAgICAgIHRoaXMuX19sYXN0X2luZGV4X18gPSBtLmluZGV4ICsgbVswXS5sZW5ndGggKyBsZW47XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICh0aGlzLl9fb3B0c19fLmZ1enp5TGluayAmJiB0aGlzLl9fY29tcGlsZWRfX1snaHR0cDonXSkge1xuICAgIC8vIGd1ZXNzIHNjaGVtYWxlc3MgbGlua3NcbiAgICB0bGRfcG9zID0gdGV4dC5zZWFyY2godGhpcy5yZS5ob3N0X2Z1enp5X3Rlc3QpO1xuICAgIGlmICh0bGRfcG9zID49IDApIHtcbiAgICAgIC8vIGlmIHRsZCBpcyBsb2NhdGVkIGFmdGVyIGZvdW5kIGxpbmsgLSBubyBuZWVkIHRvIGNoZWNrIGZ1enp5IHBhdHRlcm5cbiAgICAgIGlmICh0aGlzLl9faW5kZXhfXyA8IDAgfHwgdGxkX3BvcyA8IHRoaXMuX19pbmRleF9fKSB7XG4gICAgICAgIGlmICgobWwgPSB0ZXh0Lm1hdGNoKHRoaXMuX19vcHRzX18uZnV6enlJUCA/IHRoaXMucmUubGlua19mdXp6eSA6IHRoaXMucmUubGlua19ub19pcF9mdXp6eSkpICE9PSBudWxsKSB7XG5cbiAgICAgICAgICBzaGlmdCA9IG1sLmluZGV4ICsgbWxbMV0ubGVuZ3RoO1xuXG4gICAgICAgICAgaWYgKHRoaXMuX19pbmRleF9fIDwgMCB8fCBzaGlmdCA8IHRoaXMuX19pbmRleF9fKSB7XG4gICAgICAgICAgICB0aGlzLl9fc2NoZW1hX18gICAgID0gJyc7XG4gICAgICAgICAgICB0aGlzLl9faW5kZXhfXyAgICAgID0gc2hpZnQ7XG4gICAgICAgICAgICB0aGlzLl9fbGFzdF9pbmRleF9fID0gbWwuaW5kZXggKyBtbFswXS5sZW5ndGg7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKHRoaXMuX19vcHRzX18uZnV6enlFbWFpbCAmJiB0aGlzLl9fY29tcGlsZWRfX1snbWFpbHRvOiddKSB7XG4gICAgLy8gZ3Vlc3Mgc2NoZW1hbGVzcyBlbWFpbHNcbiAgICBhdF9wb3MgPSB0ZXh0LmluZGV4T2YoJ0AnKTtcbiAgICBpZiAoYXRfcG9zID49IDApIHtcbiAgICAgIC8vIFdlIGNhbid0IHNraXAgdGhpcyBjaGVjaywgYmVjYXVzZSB0aGlzIGNhc2VzIGFyZSBwb3NzaWJsZTpcbiAgICAgIC8vIDE5Mi4xNjguMS4xQGdtYWlsLmNvbSwgbXkuaW5AZXhhbXBsZS5jb21cbiAgICAgIGlmICgobWUgPSB0ZXh0Lm1hdGNoKHRoaXMucmUuZW1haWxfZnV6enkpKSAhPT0gbnVsbCkge1xuXG4gICAgICAgIHNoaWZ0ID0gbWUuaW5kZXggKyBtZVsxXS5sZW5ndGg7XG4gICAgICAgIG5leHQgID0gbWUuaW5kZXggKyBtZVswXS5sZW5ndGg7XG5cbiAgICAgICAgaWYgKHRoaXMuX19pbmRleF9fIDwgMCB8fCBzaGlmdCA8IHRoaXMuX19pbmRleF9fIHx8XG4gICAgICAgICAgICAoc2hpZnQgPT09IHRoaXMuX19pbmRleF9fICYmIG5leHQgPiB0aGlzLl9fbGFzdF9pbmRleF9fKSkge1xuICAgICAgICAgIHRoaXMuX19zY2hlbWFfXyAgICAgPSAnbWFpbHRvOic7XG4gICAgICAgICAgdGhpcy5fX2luZGV4X18gICAgICA9IHNoaWZ0O1xuICAgICAgICAgIHRoaXMuX19sYXN0X2luZGV4X18gPSBuZXh0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXMuX19pbmRleF9fID49IDA7XG59O1xuXG5cbi8qKlxuICogTGlua2lmeUl0I3ByZXRlc3QodGV4dCkgLT4gQm9vbGVhblxuICpcbiAqIFZlcnkgcXVpY2sgY2hlY2ssIHRoYXQgY2FuIGdpdmUgZmFsc2UgcG9zaXRpdmVzLiBSZXR1cm5zIHRydWUgaWYgbGluayBNQVkgQkVcbiAqIGNhbiBleGlzdHMuIENhbiBiZSB1c2VkIGZvciBzcGVlZCBvcHRpbWl6YXRpb24sIHdoZW4geW91IG5lZWQgdG8gY2hlY2sgdGhhdFxuICogbGluayBOT1QgZXhpc3RzLlxuICoqL1xuTGlua2lmeUl0LnByb3RvdHlwZS5wcmV0ZXN0ID0gZnVuY3Rpb24gcHJldGVzdCh0ZXh0KSB7XG4gIHJldHVybiB0aGlzLnJlLnByZXRlc3QudGVzdCh0ZXh0KTtcbn07XG5cblxuLyoqXG4gKiBMaW5raWZ5SXQjdGVzdFNjaGVtYUF0KHRleHQsIG5hbWUsIHBvc2l0aW9uKSAtPiBOdW1iZXJcbiAqIC0gdGV4dCAoU3RyaW5nKTogdGV4dCB0byBzY2FuXG4gKiAtIG5hbWUgKFN0cmluZyk6IHJ1bGUgKHNjaGVtYSkgbmFtZVxuICogLSBwb3NpdGlvbiAoTnVtYmVyKTogdGV4dCBvZmZzZXQgdG8gY2hlY2sgZnJvbVxuICpcbiAqIFNpbWlsYXIgdG8gW1tMaW5raWZ5SXQjdGVzdF1dIGJ1dCBjaGVja3Mgb25seSBzcGVjaWZpYyBwcm90b2NvbCB0YWlsIGV4YWN0bHlcbiAqIGF0IGdpdmVuIHBvc2l0aW9uLiBSZXR1cm5zIGxlbmd0aCBvZiBmb3VuZCBwYXR0ZXJuICgwIG9uIGZhaWwpLlxuICoqL1xuTGlua2lmeUl0LnByb3RvdHlwZS50ZXN0U2NoZW1hQXQgPSBmdW5jdGlvbiB0ZXN0U2NoZW1hQXQodGV4dCwgc2NoZW1hLCBwb3MpIHtcbiAgLy8gSWYgbm90IHN1cHBvcnRlZCBzY2hlbWEgY2hlY2sgcmVxdWVzdGVkIC0gdGVybWluYXRlXG4gIGlmICghdGhpcy5fX2NvbXBpbGVkX19bc2NoZW1hLnRvTG93ZXJDYXNlKCldKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX19jb21waWxlZF9fW3NjaGVtYS50b0xvd2VyQ2FzZSgpXS52YWxpZGF0ZSh0ZXh0LCBwb3MsIHRoaXMpO1xufTtcblxuXG4vKipcbiAqIExpbmtpZnlJdCNtYXRjaCh0ZXh0KSAtPiBBcnJheXxudWxsXG4gKlxuICogUmV0dXJucyBhcnJheSBvZiBmb3VuZCBsaW5rIGRlc2NyaXB0aW9ucyBvciBgbnVsbGAgb24gZmFpbC4gV2Ugc3Ryb25nbHlcbiAqIHRvIHVzZSBbW0xpbmtpZnlJdCN0ZXN0XV0gZmlyc3QsIGZvciBiZXN0IHNwZWVkLlxuICpcbiAqICMjIyMjIFJlc3VsdCBtYXRjaCBkZXNjcmlwdGlvblxuICpcbiAqIC0gX19zY2hlbWFfXyAtIGxpbmsgc2NoZW1hLCBjYW4gYmUgZW1wdHkgZm9yIGZ1enp5IGxpbmtzLCBvciBgLy9gIGZvclxuICogICBwcm90b2NvbC1uZXV0cmFsICBsaW5rcy5cbiAqIC0gX19pbmRleF9fIC0gb2Zmc2V0IG9mIG1hdGNoZWQgdGV4dFxuICogLSBfX2xhc3RJbmRleF9fIC0gaW5kZXggb2YgbmV4dCBjaGFyIGFmdGVyIG1hdGhjaCBlbmRcbiAqIC0gX19yYXdfXyAtIG1hdGNoZWQgdGV4dFxuICogLSBfX3RleHRfXyAtIG5vcm1hbGl6ZWQgdGV4dFxuICogLSBfX3VybF9fIC0gbGluaywgZ2VuZXJhdGVkIGZyb20gbWF0Y2hlZCB0ZXh0XG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLm1hdGNoID0gZnVuY3Rpb24gbWF0Y2godGV4dCkge1xuICB2YXIgc2hpZnQgPSAwLCByZXN1bHQgPSBbXTtcblxuICAvLyBUcnkgdG8gdGFrZSBwcmV2aW91cyBlbGVtZW50IGZyb20gY2FjaGUsIGlmIC50ZXN0KCkgY2FsbGVkIGJlZm9yZVxuICBpZiAodGhpcy5fX2luZGV4X18gPj0gMCAmJiB0aGlzLl9fdGV4dF9jYWNoZV9fID09PSB0ZXh0KSB7XG4gICAgcmVzdWx0LnB1c2goY3JlYXRlTWF0Y2godGhpcywgc2hpZnQpKTtcbiAgICBzaGlmdCA9IHRoaXMuX19sYXN0X2luZGV4X187XG4gIH1cblxuICAvLyBDdXQgaGVhZCBpZiBjYWNoZSB3YXMgdXNlZFxuICB2YXIgdGFpbCA9IHNoaWZ0ID8gdGV4dC5zbGljZShzaGlmdCkgOiB0ZXh0O1xuXG4gIC8vIFNjYW4gc3RyaW5nIHVudGlsIGVuZCByZWFjaGVkXG4gIHdoaWxlICh0aGlzLnRlc3QodGFpbCkpIHtcbiAgICByZXN1bHQucHVzaChjcmVhdGVNYXRjaCh0aGlzLCBzaGlmdCkpO1xuXG4gICAgdGFpbCA9IHRhaWwuc2xpY2UodGhpcy5fX2xhc3RfaW5kZXhfXyk7XG4gICAgc2hpZnQgKz0gdGhpcy5fX2xhc3RfaW5kZXhfXztcbiAgfVxuXG4gIGlmIChyZXN1bHQubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufTtcblxuXG4vKiogY2hhaW5hYmxlXG4gKiBMaW5raWZ5SXQjdGxkcyhsaXN0IFssIGtlZXBPbGRdKSAtPiB0aGlzXG4gKiAtIGxpc3QgKEFycmF5KTogbGlzdCBvZiB0bGRzXG4gKiAtIGtlZXBPbGQgKEJvb2xlYW4pOiBtZXJnZSB3aXRoIGN1cnJlbnQgbGlzdCBpZiBgdHJ1ZWAgKGBmYWxzZWAgYnkgZGVmYXVsdClcbiAqXG4gKiBMb2FkIChvciBtZXJnZSkgbmV3IHRsZHMgbGlzdC4gVGhvc2UgYXJlIHVzZXIgZm9yIGZ1enp5IGxpbmtzICh3aXRob3V0IHByZWZpeClcbiAqIHRvIGF2b2lkIGZhbHNlIHBvc2l0aXZlcy4gQnkgZGVmYXVsdCB0aGlzIGFsZ29yeXRobSB1c2VkOlxuICpcbiAqIC0gaG9zdG5hbWUgd2l0aCBhbnkgMi1sZXR0ZXIgcm9vdCB6b25lcyBhcmUgb2suXG4gKiAtIGJpenxjb218ZWR1fGdvdnxuZXR8b3JnfHByb3x3ZWJ8eHh4fGFlcm98YXNpYXxjb29wfGluZm98bXVzZXVtfG5hbWV8c2hvcHzRgNGEXG4gKiAgIGFyZSBvay5cbiAqIC0gZW5jb2RlZCAoYHhuLS0uLi5gKSByb290IHpvbmVzIGFyZSBvay5cbiAqXG4gKiBJZiBsaXN0IGlzIHJlcGxhY2VkLCB0aGVuIGV4YWN0IG1hdGNoIGZvciAyLWNoYXJzIHJvb3Qgem9uZXMgd2lsbCBiZSBjaGVja2VkLlxuICoqL1xuTGlua2lmeUl0LnByb3RvdHlwZS50bGRzID0gZnVuY3Rpb24gdGxkcyhsaXN0LCBrZWVwT2xkKSB7XG4gIGxpc3QgPSBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFsgbGlzdCBdO1xuXG4gIGlmICgha2VlcE9sZCkge1xuICAgIHRoaXMuX190bGRzX18gPSBsaXN0LnNsaWNlKCk7XG4gICAgdGhpcy5fX3RsZHNfcmVwbGFjZWRfXyA9IHRydWU7XG4gICAgY29tcGlsZSh0aGlzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHRoaXMuX190bGRzX18gPSB0aGlzLl9fdGxkc19fLmNvbmNhdChsaXN0KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5zb3J0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKGZ1bmN0aW9uKGVsLCBpZHgsIGFycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGVsICE9PSBhcnJbaWR4IC0gMV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmV2ZXJzZSgpO1xuXG4gIGNvbXBpbGUodGhpcyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBMaW5raWZ5SXQjbm9ybWFsaXplKG1hdGNoKVxuICpcbiAqIERlZmF1bHQgbm9ybWFsaXplciAoaWYgc2NoZW1hIGRvZXMgbm90IGRlZmluZSBpdCdzIG93bikuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLm5vcm1hbGl6ZSA9IGZ1bmN0aW9uIG5vcm1hbGl6ZShtYXRjaCkge1xuXG4gIC8vIERvIG1pbmltYWwgcG9zc2libGUgY2hhbmdlcyBieSBkZWZhdWx0LiBOZWVkIHRvIGNvbGxlY3QgZmVlZGJhY2sgcHJpb3JcbiAgLy8gdG8gbW92ZSBmb3J3YXJkIGh0dHBzOi8vZ2l0aHViLmNvbS9tYXJrZG93bi1pdC9saW5raWZ5LWl0L2lzc3Vlcy8xXG5cbiAgaWYgKCFtYXRjaC5zY2hlbWEpIHsgbWF0Y2gudXJsID0gJ2h0dHA6Ly8nICsgbWF0Y2gudXJsOyB9XG5cbiAgaWYgKG1hdGNoLnNjaGVtYSA9PT0gJ21haWx0bzonICYmICEvXm1haWx0bzovaS50ZXN0KG1hdGNoLnVybCkpIHtcbiAgICBtYXRjaC51cmwgPSAnbWFpbHRvOicgKyBtYXRjaC51cmw7XG4gIH1cbn07XG5cblxubW9kdWxlLmV4cG9ydHMgPSBMaW5raWZ5SXQ7XG4iLCIndXNlIHN0cmljdCc7XG5cbi8vIFVzZSBkaXJlY3QgZXh0cmFjdCBpbnN0ZWFkIG9mIGByZWdlbmVyYXRlYCB0byByZWR1c2UgYnJvd3NlcmlmaWVkIHNpemVcbnZhciBzcmNfQW55ID0gZXhwb3J0cy5zcmNfQW55ID0gcmVxdWlyZSgndWMubWljcm8vcHJvcGVydGllcy9BbnkvcmVnZXgnKS5zb3VyY2U7XG52YXIgc3JjX0NjICA9IGV4cG9ydHMuc3JjX0NjID0gcmVxdWlyZSgndWMubWljcm8vY2F0ZWdvcmllcy9DYy9yZWdleCcpLnNvdXJjZTtcbnZhciBzcmNfWiAgID0gZXhwb3J0cy5zcmNfWiAgPSByZXF1aXJlKCd1Yy5taWNyby9jYXRlZ29yaWVzL1ovcmVnZXgnKS5zb3VyY2U7XG52YXIgc3JjX1AgICA9IGV4cG9ydHMuc3JjX1AgID0gcmVxdWlyZSgndWMubWljcm8vY2F0ZWdvcmllcy9QL3JlZ2V4Jykuc291cmNlO1xuXG4vLyBcXHB7XFxaXFxQXFxDY1xcQ0Z9ICh3aGl0ZSBzcGFjZXMgKyBjb250cm9sICsgZm9ybWF0ICsgcHVuY3R1YXRpb24pXG52YXIgc3JjX1pQQ2MgPSBleHBvcnRzLnNyY19aUENjID0gWyBzcmNfWiwgc3JjX1AsIHNyY19DYyBdLmpvaW4oJ3wnKTtcblxuLy8gXFxwe1xcWlxcQ2N9ICh3aGl0ZSBzcGFjZXMgKyBjb250cm9sKVxudmFyIHNyY19aQ2MgPSBleHBvcnRzLnNyY19aQ2MgPSBbIHNyY19aLCBzcmNfQ2MgXS5qb2luKCd8Jyk7XG5cbi8vIEFsbCBwb3NzaWJsZSB3b3JkIGNoYXJhY3RlcnMgKGV2ZXJ5dGhpbmcgd2l0aG91dCBwdW5jdHVhdGlvbiwgc3BhY2VzICYgY29udHJvbHMpXG4vLyBEZWZpbmVkIHZpYSBwdW5jdHVhdGlvbiAmIHNwYWNlcyB0byBzYXZlIHNwYWNlXG4vLyBTaG91bGQgYmUgc29tZXRoaW5nIGxpa2UgXFxwe1xcTFxcTlxcU1xcTX0gKFxcdyBidXQgd2l0aG91dCBgX2ApXG52YXIgc3JjX3BzZXVkb19sZXR0ZXIgICAgICAgPSAnKD86KD8hJyArIHNyY19aUENjICsgJyknICsgc3JjX0FueSArICcpJztcbi8vIFRoZSBzYW1lIGFzIGFib3RoZSBidXQgd2l0aG91dCBbMC05XVxudmFyIHNyY19wc2V1ZG9fbGV0dGVyX25vbl9kID0gJyg/Oig/IVswLTldfCcgKyBzcmNfWlBDYyArICcpJyArIHNyY19BbnkgKyAnKSc7XG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbnZhciBzcmNfaXA0ID0gZXhwb3J0cy5zcmNfaXA0ID1cblxuICAnKD86KDI1WzAtNV18MlswLTRdWzAtOV18WzAxXT9bMC05XVswLTldPylcXFxcLil7M30oMjVbMC01XXwyWzAtNF1bMC05XXxbMDFdP1swLTldWzAtOV0/KSc7XG5cbmV4cG9ydHMuc3JjX2F1dGggICAgPSAnKD86KD86KD8hJyArIHNyY19aQ2MgKyAnKS4pK0ApPyc7XG5cbnZhciBzcmNfcG9ydCA9IGV4cG9ydHMuc3JjX3BvcnQgPVxuXG4gICcoPzo6KD86Nig/OlswLTRdXFxcXGR7M318NSg/OlswLTRdXFxcXGR7Mn18NSg/OlswLTJdXFxcXGR8M1swLTVdKSkpfFsxLTVdP1xcXFxkezEsNH0pKT8nO1xuXG52YXIgc3JjX2hvc3RfdGVybWluYXRvciA9IGV4cG9ydHMuc3JjX2hvc3RfdGVybWluYXRvciA9XG5cbiAgJyg/PSR8JyArIHNyY19aUENjICsgJykoPyEtfF98OlxcXFxkfFxcXFwuLXxcXFxcLig/ISR8JyArIHNyY19aUENjICsgJykpJztcblxudmFyIHNyY19wYXRoID0gZXhwb3J0cy5zcmNfcGF0aCA9XG5cbiAgJyg/OicgK1xuICAgICdbLz8jXScgK1xuICAgICAgJyg/OicgK1xuICAgICAgICAnKD8hJyArIHNyY19aQ2MgKyAnfFsoKVtcXFxcXXt9LixcIlxcJz8hXFxcXC1dKS58JyArXG4gICAgICAgICdcXFxcWyg/Oig/IScgKyBzcmNfWkNjICsgJ3xcXFxcXSkuKSpcXFxcXXwnICtcbiAgICAgICAgJ1xcXFwoKD86KD8hJyArIHNyY19aQ2MgKyAnfFspXSkuKSpcXFxcKXwnICtcbiAgICAgICAgJ1xcXFx7KD86KD8hJyArIHNyY19aQ2MgKyAnfFt9XSkuKSpcXFxcfXwnICtcbiAgICAgICAgJ1xcXFxcIig/Oig/IScgKyBzcmNfWkNjICsgJ3xbXCJdKS4pK1xcXFxcInwnICtcbiAgICAgICAgXCJcXFxcJyg/Oig/IVwiICsgc3JjX1pDYyArIFwifFsnXSkuKStcXFxcJ3xcIiArXG4gICAgICAgIFwiXFxcXCcoPz1cIiArIHNyY19wc2V1ZG9fbGV0dGVyICsgJykufCcgKyAgLy8gYWxsb3cgYEknbV9raW5nYCBpZiBubyBwYWlyIGZvdW5kXG4gICAgICAgICdcXFxcLnsyLDN9W2EtekEtWjAtOSUvXXwnICsgLy8gZ2l0aHViIGhhcyAuLi4gaW4gY29tbWl0IHJhbmdlIGxpbmtzLiBSZXN0cmljdCB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAtIGVuZ2xpc2hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gLSBwZXJjZW50LWVuY29kZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gLSBwYXJ0cyBvZiBmaWxlIHBhdGhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdW50aWwgbW9yZSBleGFtcGxlcyBmb3VuZC5cbiAgICAgICAgJ1xcXFwuKD8hJyArIHNyY19aQ2MgKyAnfFsuXSkufCcgK1xuICAgICAgICAnXFxcXC0oPyEtLSg/OlteLV18JCkpKD86LSopfCcgKyAgLy8gYC0tLWAgPT4gbG9uZyBkYXNoLCB0ZXJtaW5hdGVcbiAgICAgICAgJ1xcXFwsKD8hJyArIHNyY19aQ2MgKyAnKS58JyArICAgICAgLy8gYWxsb3cgYCwsLGAgaW4gcGF0aHNcbiAgICAgICAgJ1xcXFwhKD8hJyArIHNyY19aQ2MgKyAnfFshXSkufCcgK1xuICAgICAgICAnXFxcXD8oPyEnICsgc3JjX1pDYyArICd8Wz9dKS4nICtcbiAgICAgICcpKycgK1xuICAgICd8XFxcXC8nICtcbiAgJyk/JztcblxudmFyIHNyY19lbWFpbF9uYW1lID0gZXhwb3J0cy5zcmNfZW1haWxfbmFtZSA9XG5cbiAgJ1tcXFxcLTs6Jj1cXFxcK1xcXFwkLFxcXFxcIlxcXFwuYS16QS1aMC05X10rJztcblxudmFyIHNyY194biA9IGV4cG9ydHMuc3JjX3huID1cblxuICAneG4tLVthLXowLTlcXFxcLV17MSw1OX0nO1xuXG4vLyBNb3JlIHRvIHJlYWQgYWJvdXQgZG9tYWluIG5hbWVzXG4vLyBodHRwOi8vc2VydmVyZmF1bHQuY29tL3F1ZXN0aW9ucy82MzgyNjAvXG5cbnZhciBzcmNfZG9tYWluX3Jvb3QgPSBleHBvcnRzLnNyY19kb21haW5fcm9vdCA9XG5cbiAgLy8gQ2FuJ3QgaGF2ZSBkaWdpdHMgYW5kIGRhc2hlc1xuICAnKD86JyArXG4gICAgc3JjX3huICtcbiAgICAnfCcgK1xuICAgIHNyY19wc2V1ZG9fbGV0dGVyX25vbl9kICsgJ3sxLDYzfScgK1xuICAnKSc7XG5cbnZhciBzcmNfZG9tYWluID0gZXhwb3J0cy5zcmNfZG9tYWluID1cblxuICAnKD86JyArXG4gICAgc3JjX3huICtcbiAgICAnfCcgK1xuICAgICcoPzonICsgc3JjX3BzZXVkb19sZXR0ZXIgKyAnKScgK1xuICAgICd8JyArXG4gICAgLy8gZG9uJ3QgYWxsb3cgYC0tYCBpbiBkb21haW4gbmFtZXMsIGJlY2F1c2U6XG4gICAgLy8gLSB0aGF0IGNhbiBjb25mbGljdCB3aXRoIG1hcmtkb3duICZtZGFzaDsgLyAmbmRhc2g7XG4gICAgLy8gLSBub2JvZHkgdXNlIHRob3NlIGFueXdheVxuICAgICcoPzonICsgc3JjX3BzZXVkb19sZXR0ZXIgKyAnKD86LSg/IS0pfCcgKyBzcmNfcHNldWRvX2xldHRlciArICcpezAsNjF9JyArIHNyY19wc2V1ZG9fbGV0dGVyICsgJyknICtcbiAgJyknO1xuXG52YXIgc3JjX2hvc3QgPSBleHBvcnRzLnNyY19ob3N0ID1cblxuICAnKD86JyArXG4gICAgc3JjX2lwNCArXG4gICd8JyArXG4gICAgJyg/Oig/Oig/OicgKyBzcmNfZG9tYWluICsgJylcXFxcLikqJyArIHNyY19kb21haW5fcm9vdCArICcpJyArXG4gICcpJztcblxudmFyIHRwbF9ob3N0X2Z1enp5ID0gZXhwb3J0cy50cGxfaG9zdF9mdXp6eSA9XG5cbiAgJyg/OicgK1xuICAgIHNyY19pcDQgK1xuICAnfCcgK1xuICAgICcoPzooPzooPzonICsgc3JjX2RvbWFpbiArICcpXFxcXC4pKyg/OiVUTERTJSkpJyArXG4gICcpJztcblxudmFyIHRwbF9ob3N0X25vX2lwX2Z1enp5ID0gZXhwb3J0cy50cGxfaG9zdF9ub19pcF9mdXp6eSA9XG5cbiAgJyg/Oig/Oig/OicgKyBzcmNfZG9tYWluICsgJylcXFxcLikrKD86JVRMRFMlKSknO1xuXG5leHBvcnRzLnNyY19ob3N0X3N0cmljdCA9XG5cbiAgc3JjX2hvc3QgKyBzcmNfaG9zdF90ZXJtaW5hdG9yO1xuXG52YXIgdHBsX2hvc3RfZnV6enlfc3RyaWN0ID0gZXhwb3J0cy50cGxfaG9zdF9mdXp6eV9zdHJpY3QgPVxuXG4gIHRwbF9ob3N0X2Z1enp5ICsgc3JjX2hvc3RfdGVybWluYXRvcjtcblxuZXhwb3J0cy5zcmNfaG9zdF9wb3J0X3N0cmljdCA9XG5cbiAgc3JjX2hvc3QgKyBzcmNfcG9ydCArIHNyY19ob3N0X3Rlcm1pbmF0b3I7XG5cbnZhciB0cGxfaG9zdF9wb3J0X2Z1enp5X3N0cmljdCA9IGV4cG9ydHMudHBsX2hvc3RfcG9ydF9mdXp6eV9zdHJpY3QgPVxuXG4gIHRwbF9ob3N0X2Z1enp5ICsgc3JjX3BvcnQgKyBzcmNfaG9zdF90ZXJtaW5hdG9yO1xuXG52YXIgdHBsX2hvc3RfcG9ydF9ub19pcF9mdXp6eV9zdHJpY3QgPSBleHBvcnRzLnRwbF9ob3N0X3BvcnRfbm9faXBfZnV6enlfc3RyaWN0ID1cblxuICB0cGxfaG9zdF9ub19pcF9mdXp6eSArIHNyY19wb3J0ICsgc3JjX2hvc3RfdGVybWluYXRvcjtcblxuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuLy8gTWFpbiBydWxlc1xuXG4vLyBSdWRlIHRlc3QgZnV6enkgbGlua3MgYnkgaG9zdCwgZm9yIHF1aWNrIGRlbnlcbmV4cG9ydHMudHBsX2hvc3RfZnV6enlfdGVzdCA9XG5cbiAgJ2xvY2FsaG9zdHxcXFxcLlxcXFxkezEsM31cXFxcLnwoPzpcXFxcLig/OiVUTERTJSkoPzonICsgc3JjX1pQQ2MgKyAnfCQpKSc7XG5cbmV4cG9ydHMudHBsX2VtYWlsX2Z1enp5ID1cblxuICAgICcoXnw+fCcgKyBzcmNfWkNjICsgJykoJyArIHNyY19lbWFpbF9uYW1lICsgJ0AnICsgdHBsX2hvc3RfZnV6enlfc3RyaWN0ICsgJyknO1xuXG5leHBvcnRzLnRwbF9saW5rX2Z1enp5ID1cbiAgICAvLyBGdXp6eSBsaW5rIGNhbid0IGJlIHByZXBlbmRlZCB3aXRoIC46L1xcLSBhbmQgbm9uIHB1bmN0dWF0aW9uLlxuICAgIC8vIGJ1dCBjYW4gc3RhcnQgd2l0aCA+IChtYXJrZG93biBibG9ja3F1b3RlKVxuICAgICcoXnwoPyFbLjovXFxcXC1fQF0pKD86WyQrPD0+XmB8XXwnICsgc3JjX1pQQ2MgKyAnKSknICtcbiAgICAnKCg/IVskKzw9Pl5gfF0pJyArIHRwbF9ob3N0X3BvcnRfZnV6enlfc3RyaWN0ICsgc3JjX3BhdGggKyAnKSc7XG5cbmV4cG9ydHMudHBsX2xpbmtfbm9faXBfZnV6enkgPVxuICAgIC8vIEZ1enp5IGxpbmsgY2FuJ3QgYmUgcHJlcGVuZGVkIHdpdGggLjovXFwtIGFuZCBub24gcHVuY3R1YXRpb24uXG4gICAgLy8gYnV0IGNhbiBzdGFydCB3aXRoID4gKG1hcmtkb3duIGJsb2NrcXVvdGUpXG4gICAgJyhefCg/IVsuOi9cXFxcLV9AXSkoPzpbJCs8PT5eYHxdfCcgKyBzcmNfWlBDYyArICcpKScgK1xuICAgICcoKD8hWyQrPD0+XmB8XSknICsgdHBsX2hvc3RfcG9ydF9ub19pcF9mdXp6eV9zdHJpY3QgKyBzcmNfcGF0aCArICcpJztcbiIsIm1vZHVsZS5leHBvcnRzPS9bXFwwLVxceDFGXFx4N0YtXFx4OUZdLyIsIm1vZHVsZS5leHBvcnRzPS9bIS0jJS1cXCosLS86O1xcP0BcXFstXFxdX1xce1xcfVxceEExXFx4QTdcXHhBQlxceEI2XFx4QjdcXHhCQlxceEJGXFx1MDM3RVxcdTAzODdcXHUwNTVBLVxcdTA1NUZcXHUwNTg5XFx1MDU4QVxcdTA1QkVcXHUwNUMwXFx1MDVDM1xcdTA1QzZcXHUwNUYzXFx1MDVGNFxcdTA2MDlcXHUwNjBBXFx1MDYwQ1xcdTA2MERcXHUwNjFCXFx1MDYxRVxcdTA2MUZcXHUwNjZBLVxcdTA2NkRcXHUwNkQ0XFx1MDcwMC1cXHUwNzBEXFx1MDdGNy1cXHUwN0Y5XFx1MDgzMC1cXHUwODNFXFx1MDg1RVxcdTA5NjRcXHUwOTY1XFx1MDk3MFxcdTBBRjBcXHUwREY0XFx1MEU0RlxcdTBFNUFcXHUwRTVCXFx1MEYwNC1cXHUwRjEyXFx1MEYxNFxcdTBGM0EtXFx1MEYzRFxcdTBGODVcXHUwRkQwLVxcdTBGRDRcXHUwRkQ5XFx1MEZEQVxcdTEwNEEtXFx1MTA0RlxcdTEwRkJcXHUxMzYwLVxcdTEzNjhcXHUxNDAwXFx1MTY2RFxcdTE2NkVcXHUxNjlCXFx1MTY5Q1xcdTE2RUItXFx1MTZFRFxcdTE3MzVcXHUxNzM2XFx1MTdENC1cXHUxN0Q2XFx1MTdEOC1cXHUxN0RBXFx1MTgwMC1cXHUxODBBXFx1MTk0NFxcdTE5NDVcXHUxQTFFXFx1MUExRlxcdTFBQTAtXFx1MUFBNlxcdTFBQTgtXFx1MUFBRFxcdTFCNUEtXFx1MUI2MFxcdTFCRkMtXFx1MUJGRlxcdTFDM0ItXFx1MUMzRlxcdTFDN0VcXHUxQzdGXFx1MUNDMC1cXHUxQ0M3XFx1MUNEM1xcdTIwMTAtXFx1MjAyN1xcdTIwMzAtXFx1MjA0M1xcdTIwNDUtXFx1MjA1MVxcdTIwNTMtXFx1MjA1RVxcdTIwN0RcXHUyMDdFXFx1MjA4RFxcdTIwOEVcXHUyMzA4LVxcdTIzMEJcXHUyMzI5XFx1MjMyQVxcdTI3NjgtXFx1Mjc3NVxcdTI3QzVcXHUyN0M2XFx1MjdFNi1cXHUyN0VGXFx1Mjk4My1cXHUyOTk4XFx1MjlEOC1cXHUyOURCXFx1MjlGQ1xcdTI5RkRcXHUyQ0Y5LVxcdTJDRkNcXHUyQ0ZFXFx1MkNGRlxcdTJENzBcXHUyRTAwLVxcdTJFMkVcXHUyRTMwLVxcdTJFNDJcXHUzMDAxLVxcdTMwMDNcXHUzMDA4LVxcdTMwMTFcXHUzMDE0LVxcdTMwMUZcXHUzMDMwXFx1MzAzRFxcdTMwQTBcXHUzMEZCXFx1QTRGRVxcdUE0RkZcXHVBNjBELVxcdUE2MEZcXHVBNjczXFx1QTY3RVxcdUE2RjItXFx1QTZGN1xcdUE4NzQtXFx1QTg3N1xcdUE4Q0VcXHVBOENGXFx1QThGOC1cXHVBOEZBXFx1QTkyRVxcdUE5MkZcXHVBOTVGXFx1QTlDMS1cXHVBOUNEXFx1QTlERVxcdUE5REZcXHVBQTVDLVxcdUFBNUZcXHVBQURFXFx1QUFERlxcdUFBRjBcXHVBQUYxXFx1QUJFQlxcdUZEM0VcXHVGRDNGXFx1RkUxMC1cXHVGRTE5XFx1RkUzMC1cXHVGRTUyXFx1RkU1NC1cXHVGRTYxXFx1RkU2M1xcdUZFNjhcXHVGRTZBXFx1RkU2QlxcdUZGMDEtXFx1RkYwM1xcdUZGMDUtXFx1RkYwQVxcdUZGMEMtXFx1RkYwRlxcdUZGMUFcXHVGRjFCXFx1RkYxRlxcdUZGMjBcXHVGRjNCLVxcdUZGM0RcXHVGRjNGXFx1RkY1QlxcdUZGNURcXHVGRjVGLVxcdUZGNjVdfFxcdUQ4MDBbXFx1REQwMC1cXHVERDAyXFx1REY5RlxcdURGRDBdfFxcdUQ4MDFcXHVERDZGfFxcdUQ4MDJbXFx1REM1N1xcdUREMUZcXHVERDNGXFx1REU1MC1cXHVERTU4XFx1REU3RlxcdURFRjAtXFx1REVGNlxcdURGMzktXFx1REYzRlxcdURGOTktXFx1REY5Q118XFx1RDgwNFtcXHVEQzQ3LVxcdURDNERcXHVEQ0JCXFx1RENCQ1xcdURDQkUtXFx1RENDMVxcdURENDAtXFx1REQ0M1xcdURENzRcXHVERDc1XFx1RERDNS1cXHVEREM4XFx1RERDRFxcdURFMzgtXFx1REUzRF18XFx1RDgwNVtcXHVEQ0M2XFx1RERDMS1cXHVEREM5XFx1REU0MS1cXHVERTQzXXxcXHVEODA5W1xcdURDNzAtXFx1REM3NF18XFx1RDgxQVtcXHVERTZFXFx1REU2RlxcdURFRjVcXHVERjM3LVxcdURGM0JcXHVERjQ0XXxcXHVEODJGXFx1REM5Ri8iLCJtb2R1bGUuZXhwb3J0cz0vWyBcXHhBMFxcdTE2ODBcXHUyMDAwLVxcdTIwMEFcXHUyMDI4XFx1MjAyOVxcdTIwMkZcXHUyMDVGXFx1MzAwMF0vIiwibW9kdWxlLmV4cG9ydHM9L1tcXDAtXFx1RDdGRlxcdURDMDAtXFx1RkZGRl18W1xcdUQ4MDAtXFx1REJGRl1bXFx1REMwMC1cXHVERkZGXXxbXFx1RDgwMC1cXHVEQkZGXS8iLCIvKiBlc2xpbnQtZGlzYWJsZSBuby11bnVzZWQtdmFycyAqL1xuJ3VzZSBzdHJpY3QnO1xudmFyIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbnZhciBwcm9wSXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcblxuZnVuY3Rpb24gdG9PYmplY3QodmFsKSB7XG5cdGlmICh2YWwgPT09IG51bGwgfHwgdmFsID09PSB1bmRlZmluZWQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKCdPYmplY3QuYXNzaWduIGNhbm5vdCBiZSBjYWxsZWQgd2l0aCBudWxsIG9yIHVuZGVmaW5lZCcpO1xuXHR9XG5cblx0cmV0dXJuIE9iamVjdCh2YWwpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gKHRhcmdldCwgc291cmNlKSB7XG5cdHZhciBmcm9tO1xuXHR2YXIgdG8gPSB0b09iamVjdCh0YXJnZXQpO1xuXHR2YXIgc3ltYm9scztcblxuXHRmb3IgKHZhciBzID0gMTsgcyA8IGFyZ3VtZW50cy5sZW5ndGg7IHMrKykge1xuXHRcdGZyb20gPSBPYmplY3QoYXJndW1lbnRzW3NdKTtcblxuXHRcdGZvciAodmFyIGtleSBpbiBmcm9tKSB7XG5cdFx0XHRpZiAoaGFzT3duUHJvcGVydHkuY2FsbChmcm9tLCBrZXkpKSB7XG5cdFx0XHRcdHRvW2tleV0gPSBmcm9tW2tleV07XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0aWYgKE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMpIHtcblx0XHRcdHN5bWJvbHMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKGZyb20pO1xuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBzeW1ib2xzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRcdGlmIChwcm9wSXNFbnVtZXJhYmxlLmNhbGwoZnJvbSwgc3ltYm9sc1tpXSkpIHtcblx0XHRcdFx0XHR0b1tzeW1ib2xzW2ldXSA9IGZyb21bc3ltYm9sc1tpXV07XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdG87XG59O1xuIl19
