(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.wpml = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var debug = require('debug')('wpml:compiler');
var assign = require('object-assign');
var escape = require('escape-html');
var linkify = require('./linkify');
var config = require('./config');

// generate long enough string for code indenation
var INDENT = (function (len) {
  for (var str = '    '; str.length < len; str += str);
  return str;
})(80);

function filter(value, re) {
  var src = value.split(' ');
  var res = [];
  for (var i = 0; i < src.length; i++) {
    if (re.test(src[i])) res.push(src[i]);
  }
  return res.join(' ');
}

function isDisabledTag(worker, tag) {
  var opts = worker.opts;
  var name = tag.name.toLowerCase().trim();
  if (name === 'script' && !opts.javascript) return true;
  if (opts.whitelist && opts.whitelist.indexOf(name) === -1) return true;
}

function attr(opts, name, value) {
  if (!opts.javascript && opts.inlineJsTest.test(value)) return '';
  if (name === 'id' && opts.idTest && !opts.idTest.test(value)) value = '';
  if (name === 'class' && opts.classTest) value = filter(value, opts.classTest);

  if (value) return escape(name) + '=\"' + escape(value) + '\"';else return '';
}

function compileAttrs(worker, attrs) {
  var str = '';
  for (var name in attrs || {}) {
    if (attrs.hasOwnProperty(name)) {
      var v = attr(worker.opts, name, attrs[name]);
      if (v) str += ' ' + v;
    }
  }
  debug('attrs', attrs, str);
  return str;
}

//FIX: make configurable from app
function truncateUrl(url, limit) {
  limit = limit || 30;
  url = url.replace(/http[s]?:\/\/(www\.)?/i, '');
  if (url.length <= limit) return url;
  var segment = Math.floor(limit / 2) - 1;
  return url.slice(0, segment) + '..' + url.slice(url.length - segment);
}

/**
   Escape and urlize text.
*/
function urlize(worker, text) {
  if (!linkify.test(text)) return escape(text);
  var matches = linkify.match(text);
  var lastIndex = 0;
  var buf = [];
  for (var i = 0, match; match = matches[i++];) {
    buf.push(escape(text.slice(lastIndex, match.index)));
    var link = { tag: true, name: 'a',
      attrs: { href: match.url },
      value: escape(match.type === 'hashtag' ? match.text : truncateUrl(match.text)) };
    if (match.type === 'hashtag') {
      link.attrs['class'] = 'p-category';
    } else {
      link.attrs.rel = 'nofollow';
      link.attrs.target = '_blank';
    }
    buf = buf.concat(tagBuffer(worker, link, true));
    lastIndex = match.lastIndex;
  }
  buf.push(escape(text.slice(lastIndex)));
  debug('urlize', matches, buf);
  return buf.join('');
}

function tagBuffer(worker, data, urlized) {
  var name = escape(data.name);
  var buf = ['<', name, compileAttrs(worker, data.attrs || {}), '>'];
  if (data.tag && data.value) {
    buf.push(urlized ? data.value : urlize(worker, data.value));
    buf.push('</', name, '>');
  }
  debug('tagBuffer', buf);
  return buf;
}

/**
   @return Escaped verison of the disabled markup.
*/
function escapeDisabledTag(worker, data) {
  var content = typeof data.value === 'string' ? data.value : '...';
  worker.format(escape('<' + data.name + compileAttrs(worker, data.attrs) + '>' + content + '</' + data.name + '>'));
}

function openTag(worker, data) {
  worker.format.apply(null, tagBuffer(worker, data));
}

function compileTag(data, worker) {
  var name = data.name;
  var plugin = worker.opts.plugins[name];
  if (plugin) return worker.format(plugin(data));

  if (data.name && isDisabledTag(worker, data)) {
    if (worker.opts.excludeDisabledTags) return;
    return escapeDisabledTag(worker, data);
  }

  if (data.block) {
    openTag(worker, data);
    worker.stack.push(name);
    for (var i = 0, len = data.value.length; i < len; i++) {
      compileLine(data.value[i], worker);
    }
    worker.stack.pop();
    worker.format('</', name, '>');
  } else {
    // single or one-line tag
    openTag(worker, data);
  }
}

function formatTag(name, escaped, worker) {
  worker.format('<', name, '>', escaped, '</', name, '>');
}

function getSingleLineUrl(line) {
  var matches = linkify.match(line);
  var single = matches && matches.length === 1 && matches[0];
  if (single && single.index === 0 && single.lastIndex === line.length) return single.url;
}

function compileValue(data, worker) {
  if (worker.stack.length) return worker.format(urlize(worker, data.value));

  var linkPlugin = worker.opts.plugins[worker.opts.linkPlugin];
  var singleUrl = getSingleLineUrl(data.value);
  //debug('compileValue', singleUrl, linkPlugin)
  if (linkPlugin && singleUrl) worker.format(linkPlugin(data));else worker.format('<', config.defaultTag, '>', urlize(worker, data.value), '</', config.defaultTag, '>');
}

function slice(data) {
  return Array.prototype.slice.call(data);
}

function compileLine(data, worker) {
  debug('compileLine', data);
  if (data.name) compileTag(data, worker);else if (data.value) compileValue(data, worker);else console.log('Invalid line: ', data);
}

function makeWorker(opts) {
  var buf = [];
  var stack = [];

  function format() {
    //debug('new line: ', slice(arguments).join(''))
    if (buf.length) buf.push('\n');
    if (opts.indent && stack.length) buf.push(INDENT.slice(0, stack.length * opts.indent));
    buf.push.apply(buf, slice(arguments));
  }

  return { opts: opts, buf: buf, stack: stack, format: format };
}

/**
   Compile parsed MML-document into HTML.
   @param {object} ast Parsed WPML document
   @param {object} opts Same as opts in mml.doc
   @return{ string} Generated html string. 
*/
function compile(ast, opts) {
  opts = assign({}, config.defaultOpts, opts);
  debug('compile', opts, ast);
  var worker = makeWorker(opts);
  for (var i = 0, text = ast.value, len = text.length; i < len; i++) {
    compileLine(text[i], worker);
  }
  return worker.buf.join('');
}

module.exports = compile;

},{"./config":2,"./linkify":4,"debug":6,"escape-html":9,"object-assign":16}],2:[function(require,module,exports){
'use strict';

module.exports = {
  defaultTag: 'p',
  defaultOpts: {
    javascript: false,
    inlineJsTest: /^javascript:/i,
    indent: 0,
    plugins: {},
    linkPlugin: null
  }
};

},{}],3:[function(require,module,exports){
'use strict';

var parser = require('./parser');
var compiler = require('./compiler');
var linkify = require('./linkify');

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
  var parsed = parser(text);
  return {
    meta: parsed.attrs,
    html: compiler(parsed, opts)
  };
}

function meta(text) {
  return parser(text).attrs;
}

function render(text, opts) {
  return compiler(parser(text), opts);
}

function hashtags(text) {
  var res = [];
  var matches = linkify.test(text) ? linkify.match(text) : [];
  for (var i = 0, match; match = matches[i++];) {
    if (match.type === 'hashtag') res.push(match.text.slice(1));
  }
  return res;
}

module.exports = {
  parse: parser,
  renderParsed: compiler,
  render: render,
  html: render,
  doc: doc,
  meta: meta,
  hashtags: hashtags
};

},{"./compiler":1,"./linkify":4,"./parser":5}],4:[function(require,module,exports){
'use strict';

var linkify = require('linkify-it')({}, { fuzzyEmail: false }).tlds('.onion', true);

linkify.add('#', {
  validate: function validate(text, pos, self) {
    var tail = text.slice(pos);
    if (!self.re.hashtag) {
      self.re.hashtag = new RegExp('^([a-zA-Z]+\\w{2,20})(?=$|' + self.re.src_ZPCc + ')');
    }
    var match = tail.match(self.re.hashtag);
    return match ? match[0].length : 0;
  },
  normalize: function normalize(match) {
    match.type = 'hashtag';
    match.url = '/t/' + match.url.replace(/^#/, '').toLowerCase();
  }
});

module.exports = linkify;

},{"linkify-it":10}],5:[function(require,module,exports){
'use strict';

var debug = require('debug')('wpml:parser');
var config = require('./config');

// http://www.unicode.org/reports/tr18/#Line_Boundaries
var LINE_RE = /\s*(?:\r\n|[\n\r\v\f\x85\u2028\u2029])+/;

var OPEN_TAG_RE = /^\s*([a-z]+[\w\-\.#]*):$/;
var CLOSE_TAG_RE = /^\s*:([a-z]+[\w\-]*)$/;
var FULL_TAG_RE = /^\s*([!\.]?)([a-z]+[\w\-\.#]*):\s+(.+)$/;
var INVALID_TAG_RE = /([\.#]{2,}|#.+#|[\.#]$)/;

var SINGLE_TAGS = /^(img|hr|br)$/;

function mergeMeta(meta, target) {
  target[meta.name] = meta.value;
}

function parseAttrs(tokens) {
  var attrs = {};
  for (var i = 0, len = tokens.length - 1; i < len; i += 2) {
    var separator = tokens[i];
    var token = tokens[i + 1];
    switch (separator) {
      case '#':
        attrs.id = token;
        break;
      case '.':
        if (!attrs['class']) attrs['class'] = token;else attrs['class'] += ' ' + token;
        break;
    }
  }
  return attrs;
}

function parseTag(str, type, value) {
  var tokens = str.split(/(\.|#)/);
  var tag = { name: tokens.shift() || config.defaultTag };
  var attrs = parseAttrs(tokens);
  if (Object.keys(attrs).length) tag.attrs = attrs;
  if (type) tag[type] = true;
  if (value) tag.value = value;else if (tag.block) tag.value = [];
  debug('tokens', tokens, '->', tag);
  return tag;
}

function prefixType(prefix) {
  switch (prefix) {
    case '!':
      return 'root';
    case '.':
      return 'attr';
  }
  return 'tag';
}

function parseLine(line) {
  var match, data;
  if ((match = line.match(FULL_TAG_RE)) && !INVALID_TAG_RE.test(match[2])) {
    return parseTag(match[2], prefixType(match[1]), match[3]);
  } else if ((match = line.match(OPEN_TAG_RE)) && !INVALID_TAG_RE.test(match[1])) {
    var single = SINGLE_TAGS.test(match[1]) || match[2];
    return parseTag(match[1], single ? 'tag' : 'block');
  } else if (match = line.match(CLOSE_TAG_RE)) {
    return parseTag(match[1], 'blockend');
  } else {
    return { value: line };
  }
}

function mergeIntoParent(parent, child) {
  if (!parent.attrs) parent.attrs = {};
  parent.attrs[child.name] = child.value;
}

function processLine(line, doc, stack) {
  if (line.blockend) {
    if (stack.length) stack.pop();else console.error('No open tag for ', line);
    return;
  }

  var target = (stack.length ? stack[stack.length - 1] : doc).value;
  target.push(line);

  if (line.block) {
    stack.push(line);
  }
}

function parseLines(lines) {
  var doc = { attrs: {}, value: [] };
  var stack = [];
  var lastTag;
  for (var i = 0, len = lines.length; i < len; i++) {
    var parsed = parseLine(lines[i]);
    if (parsed.root) doc.attrs[parsed.name] = parsed.value;else if (parsed.attr) {
      if (lastTag) mergeIntoParent(lastTag, parsed);else console.error('No parent tag for', parsed);
    } else {
      lastTag = parsed.name ? parsed : null;
      processLine(parsed, doc, stack);
    }
  }
  if (stack.length) {
    console.warn('Parser finished with unclosed tags:\n', stack);
  }
  return doc;
}

function splitLines(text) {
  var raw = text.split(LINE_RE);
  var lines = [];
  for (var i = 0, len = raw.length; i < len; i++) {
    var line = raw[i];
    if (line) lines.push(line);
  }
  return lines;
}

/**
   Parse text in WPML format and return JSON structure of a document.
   @param {string} text
   @return {object}
*/
function parse(text) {
  return parseLines(splitLines(text));
}

module.exports = parse;

},{"./config":2,"debug":6}],6:[function(require,module,exports){

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

},{"./debug":7}],7:[function(require,module,exports){

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

},{"ms":8}],8:[function(require,module,exports){
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

},{}],9:[function(require,module,exports){
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

},{}],10:[function(require,module,exports){
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

},{"./lib/re":11}],11:[function(require,module,exports){
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

},{"uc.micro/categories/Cc/regex":12,"uc.micro/categories/P/regex":13,"uc.micro/categories/Z/regex":14,"uc.micro/properties/Any/regex":15}],12:[function(require,module,exports){
module.exports=/[\0-\x1F\x7F-\x9F]/
},{}],13:[function(require,module,exports){
module.exports=/[!-#%-\*,-/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E42\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDE38-\uDE3D]|\uD805[\uDCC6\uDDC1-\uDDC9\uDE41-\uDE43]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD82F\uDC9F/
},{}],14:[function(require,module,exports){
module.exports=/[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/
},{}],15:[function(require,module,exports){
module.exports=/[\0-\uD7FF\uDC00-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF]/
},{}],16:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi9ob21lL2RvZ2FkYS9wcm9qZWN0cy9Db2VjdC9XUE1ML2xpYi9jb21waWxlci5qcyIsIi9ob21lL2RvZ2FkYS9wcm9qZWN0cy9Db2VjdC9XUE1ML2xpYi9jb25maWcuanMiLCIvaG9tZS9kb2dhZGEvcHJvamVjdHMvQ29lY3QvV1BNTC9saWIvaW5kZXguanMiLCIvaG9tZS9kb2dhZGEvcHJvamVjdHMvQ29lY3QvV1BNTC9saWIvbGlua2lmeS5qcyIsIi9ob21lL2RvZ2FkYS9wcm9qZWN0cy9Db2VjdC9XUE1ML2xpYi9wYXJzZXIuanMiLCJub2RlX21vZHVsZXMvZGVidWcvYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9kZWJ1Zy9kZWJ1Zy5qcyIsIm5vZGVfbW9kdWxlcy9kZWJ1Zy9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZXNjYXBlLWh0bWwvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbGlua2lmeS1pdC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9saW5raWZ5LWl0L2xpYi9yZS5qcyIsIm5vZGVfbW9kdWxlcy9saW5raWZ5LWl0L25vZGVfbW9kdWxlcy91Yy5taWNyby9jYXRlZ29yaWVzL0NjL3JlZ2V4LmpzIiwibm9kZV9tb2R1bGVzL2xpbmtpZnktaXQvbm9kZV9tb2R1bGVzL3VjLm1pY3JvL2NhdGVnb3JpZXMvUC9yZWdleC5qcyIsIm5vZGVfbW9kdWxlcy9saW5raWZ5LWl0L25vZGVfbW9kdWxlcy91Yy5taWNyby9jYXRlZ29yaWVzL1ovcmVnZXguanMiLCJub2RlX21vZHVsZXMvbGlua2lmeS1pdC9ub2RlX21vZHVsZXMvdWMubWljcm8vcHJvcGVydGllcy9BbnkvcmVnZXguanMiLCJub2RlX21vZHVsZXMvb2JqZWN0LWFzc2lnbi9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBLFlBQVksQ0FBQzs7QUFFYixJQUFJLEtBQUssR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUE7QUFDN0MsSUFBSSxNQUFNLEdBQUcsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFBO0FBQ3JDLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQTtBQUNuQyxJQUFJLE9BQU8sR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUE7QUFDbEMsSUFBSSxNQUFNLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFBOzs7QUFHaEMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxVQUFVLEdBQUcsRUFBRTtBQUMzQixPQUFLLElBQUksR0FBRyxHQUFHLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsRUFBRSxHQUFHLElBQUksR0FBRyxFQUFFO0FBQ3JELFNBQU8sR0FBRyxDQUFBO0NBQ1gsQ0FBQSxDQUFFLEVBQUUsQ0FBQyxDQUFDOztBQUVQLFNBQVMsTUFBTSxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7QUFDekIsTUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtBQUMxQixNQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7QUFDWixPQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtBQUNuQyxRQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtHQUN0QztBQUNELFNBQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtDQUNyQjs7QUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFO0FBQ2xDLE1BQUksSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUE7QUFDdEIsTUFBSSxJQUFJLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtBQUN4QyxNQUFJLElBQUksS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLE9BQU8sSUFBSSxDQUFBO0FBQ3RELE1BQUksSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxPQUFPLElBQUksQ0FBQTtDQUN2RTs7QUFFRCxTQUFTLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtBQUMvQixNQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUNqRSxNQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLEtBQUssR0FBRyxFQUFFLENBQUE7QUFDeEUsTUFBSSxJQUFJLEtBQUssT0FBTyxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBOztBQUU3RSxNQUFJLEtBQUssRUFBRSxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxLQUFLLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQSxLQUN4RCxPQUFPLEVBQUUsQ0FBQTtDQUNmOztBQUdELFNBQVMsWUFBWSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUU7QUFDbkMsTUFBSSxHQUFHLEdBQUcsRUFBRSxDQUFBO0FBQ1osT0FBSyxJQUFJLElBQUksSUFBSyxLQUFLLElBQUksRUFBRSxFQUFHO0FBQzlCLFFBQUksS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsRUFBRTtBQUM5QixVQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUE7QUFDNUMsVUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUE7S0FDdEI7R0FDRjtBQUNELE9BQUssQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQzFCLFNBQU8sR0FBRyxDQUFBO0NBQ1g7OztBQUdELFNBQVMsV0FBVyxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUU7QUFDL0IsT0FBSyxHQUFHLEtBQUssSUFBSSxFQUFFLENBQUE7QUFDbkIsS0FBRyxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsd0JBQXdCLEVBQUUsRUFBRSxDQUFDLENBQUE7QUFDL0MsTUFBSSxHQUFHLENBQUMsTUFBTSxJQUFJLEtBQUssRUFBRSxPQUFPLEdBQUcsQ0FBQTtBQUNuQyxNQUFJLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUE7QUFDdkMsU0FBTyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFBO0NBQ3RFOzs7OztBQUtELFNBQVMsTUFBTSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUU7QUFDNUIsTUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7QUFDNUMsTUFBSSxPQUFPLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtBQUNqQyxNQUFJLFNBQVMsR0FBRyxDQUFDLENBQUM7QUFDbEIsTUFBSSxHQUFHLEdBQUcsRUFBRSxDQUFBO0FBQ1osT0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsS0FBSyxFQUFHLEtBQUssR0FBRyxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBSztBQUMvQyxPQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO0FBQ3BELFFBQUksSUFBSSxHQUFHLEVBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsR0FBRztBQUNwQixXQUFLLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLEdBQUcsRUFBQztBQUN4QixXQUFLLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLEtBQUssQ0FBQyxJQUFJLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFDLENBQUE7QUFDM0YsUUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFNBQVMsRUFBRTtBQUM1QixVQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFHLFlBQVksQ0FBQTtLQUNuQyxNQUNJO0FBQ0gsVUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsVUFBVSxDQUFBO0FBQzNCLFVBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQTtLQUM3QjtBQUNELE9BQUcsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUE7QUFDL0MsYUFBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUE7R0FDNUI7QUFDRCxLQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUN2QyxPQUFLLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQTtBQUM3QixTQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7Q0FDcEI7O0FBRUQsU0FBUyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUU7QUFDeEMsTUFBSSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtBQUM1QixNQUFJLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsWUFBWSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQ2xFLE1BQUksSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFO0FBQzFCLE9BQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtBQUMzRCxPQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUE7R0FDMUI7QUFDRCxPQUFLLENBQUMsV0FBVyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQ3ZCLFNBQU8sR0FBRyxDQUFBO0NBQ1g7Ozs7O0FBTUQsU0FBUyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFO0FBQ3ZDLE1BQUksT0FBTyxHQUFJLE9BQU8sSUFBSSxDQUFDLEtBQUssS0FBSyxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLEFBQUMsQ0FBQTtBQUNuRSxRQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FDbEIsR0FBRyxHQUFHLElBQUksQ0FBQyxJQUFJLEdBQUcsWUFBWSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsR0FBRyxHQUN0RCxPQUFPLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQTtDQUN2Qzs7QUFFRCxTQUFTLE9BQU8sQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFO0FBQzdCLFFBQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUE7Q0FDbkQ7O0FBRUQsU0FBUyxVQUFVLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtBQUNoQyxNQUFJLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFBO0FBQ3BCLE1BQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ3RDLE1BQUksTUFBTSxFQUFFLE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTs7QUFFOUMsTUFBSSxJQUFJLENBQUMsSUFBSSxJQUFJLGFBQWEsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUU7QUFDNUMsUUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLE9BQU07QUFDM0MsV0FBTyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7R0FDdkM7O0FBRUQsTUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFO0FBQ2QsV0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUNyQixVQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtBQUN2QixTQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRTtBQUNyRCxpQkFBVyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUE7S0FDbkM7QUFDRCxVQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFBO0FBQ2xCLFVBQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQTtHQUMvQixNQUFNOztBQUVMLFdBQU8sQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7R0FDdEI7Q0FDRjs7QUFFRCxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRTtBQUN4QyxRQUFNLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFBO0NBQ3hEOztBQUVELFNBQVMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFO0FBQzlCLE1BQUksT0FBTyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUE7QUFDakMsTUFBSSxNQUFNLEdBQUcsT0FBTyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUMxRCxNQUFJLE1BQU0sSUFBSSxNQUFNLENBQUMsS0FBSyxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFBO0NBQ3hGOztBQUVELFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUU7QUFDbEMsTUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTs7QUFFekUsTUFBSSxVQUFVLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtBQUM1RCxNQUFJLFNBQVMsR0FBRyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7O0FBRTVDLE1BQUksVUFBVSxJQUFJLFNBQVMsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBLEtBQ3ZELE1BQU0sQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxVQUFVLEVBQUUsR0FBRyxFQUMzQixNQUFNLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsRUFDMUIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUE7Q0FDakQ7O0FBRUQsU0FBUyxLQUFLLENBQUMsSUFBSSxFQUFFO0FBQ25CLFNBQU8sS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0NBQ3hDOztBQUdELFNBQVMsV0FBVyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUU7QUFDakMsT0FBSyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUMxQixNQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQSxLQUNsQyxJQUFJLElBQUksQ0FBQyxLQUFLLEVBQUUsWUFBWSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQSxLQUMxQyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxDQUFBO0NBQ3pDOztBQUdELFNBQVMsVUFBVSxDQUFDLElBQUksRUFBRTtBQUN4QixNQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7QUFDWixNQUFJLEtBQUssR0FBRyxFQUFFLENBQUE7O0FBRWQsV0FBUyxNQUFNLEdBQUc7O0FBRWhCLFFBQUksR0FBRyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQzlCLFFBQUksSUFBSSxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtBQUN0RixPQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7R0FDdEM7O0FBRUQsU0FBTyxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUMsQ0FBQTtDQUM1RDs7Ozs7Ozs7QUFTRCxTQUFTLE9BQU8sQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFO0FBQzFCLE1BQUksR0FBRyxNQUFNLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUE7QUFDM0MsT0FBSyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFDM0IsTUFBSSxNQUFNLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQzdCLE9BQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxFQUFFLEdBQUcsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUU7QUFDakUsZUFBVyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQTtHQUM3QjtBQUNELFNBQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7Q0FDM0I7O0FBR0QsTUFBTSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7Ozs7O0FDOU14QixNQUFNLENBQUMsT0FBTyxHQUFHO0FBQ2YsWUFBVSxFQUFFLEdBQUc7QUFDZixhQUFXLEVBQUU7QUFDWCxjQUFVLEVBQUUsS0FBSztBQUNqQixnQkFBWSxFQUFFLGVBQWU7QUFDN0IsVUFBTSxFQUFFLENBQUM7QUFDVCxXQUFPLEVBQUUsRUFBRTtBQUNYLGNBQVUsRUFBRSxJQUFJO0dBQ2pCO0NBQ0YsQ0FBQTs7O0FDVEQsWUFBWSxDQUFDOztBQUViLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTtBQUNoQyxJQUFJLFFBQVEsR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUE7QUFDcEMsSUFBSSxPQUFPLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFxQmxDLFNBQVMsR0FBRyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUU7QUFDdkIsTUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ3pCLFNBQU87QUFDTCxRQUFJLEVBQUUsTUFBTSxDQUFDLEtBQUs7QUFDbEIsUUFBSSxFQUFFLFFBQVEsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDO0dBQzdCLENBQUE7Q0FDRjs7QUFFRCxTQUFTLElBQUksQ0FBQyxJQUFJLEVBQUU7QUFDbEIsU0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFBO0NBQzFCOztBQUVELFNBQVMsTUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUU7QUFDMUIsU0FBTyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFBO0NBQ3BDOztBQUVELFNBQVMsUUFBUSxDQUFDLElBQUksRUFBRTtBQUN0QixNQUFJLEdBQUcsR0FBRyxFQUFFLENBQUE7QUFDWixNQUFJLE9BQU8sR0FBSSxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxBQUFDLENBQUE7QUFDN0QsT0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsS0FBSyxFQUFHLEtBQUssR0FBRyxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBSztBQUMvQyxRQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssU0FBUyxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtHQUM1RDtBQUNELFNBQU8sR0FBRyxDQUFBO0NBQ1g7O0FBRUQsTUFBTSxDQUFDLE9BQU8sR0FBRztBQUNmLE9BQUssRUFBRSxNQUFNO0FBQ2IsY0FBWSxFQUFFLFFBQVE7QUFDdEIsUUFBTSxFQUFFLE1BQU07QUFDZCxNQUFJLEVBQUUsTUFBTTtBQUNaLEtBQUcsRUFBRSxHQUFHO0FBQ1IsTUFBSSxFQUFFLElBQUk7QUFDVixVQUFRLEVBQVIsUUFBUTtDQUNULENBQUE7Ozs7O0FDMURELElBQUksT0FBTyxHQUFHLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFBOztBQUVqRixPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRTtBQUNmLFVBQVEsRUFBRSxrQkFBVSxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRTtBQUNuQyxRQUFJLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0FBQzFCLFFBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRTtBQUNwQixVQUFJLENBQUMsRUFBRSxDQUFDLE9BQU8sR0FBSSxJQUFJLE1BQU0sQ0FDM0IsNEJBQTRCLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLENBQUE7S0FDekQ7QUFDRCxRQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUE7QUFDdkMsV0FBUSxLQUFLLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7R0FDckM7QUFDRCxXQUFTLEVBQUUsbUJBQVUsS0FBSyxFQUFFO0FBQzFCLFNBQUssQ0FBQyxJQUFJLEdBQUcsU0FBUyxDQUFBO0FBQ3RCLFNBQUssQ0FBQyxHQUFHLEdBQUcsS0FBSyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtHQUM5RDtDQUNGLENBQUMsQ0FBQTs7QUFFRixNQUFNLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTs7O0FDbEJ4QixZQUFZLENBQUM7O0FBRWIsSUFBSSxLQUFLLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0FBQzNDLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTs7O0FBR2hDLElBQUksT0FBTyxHQUFHLHlDQUF5QyxDQUFBOztBQUV2RCxJQUFJLFdBQVcsR0FBRywwQkFBMEIsQ0FBQTtBQUM1QyxJQUFJLFlBQVksR0FBRyx1QkFBdUIsQ0FBQTtBQUMxQyxJQUFJLFdBQVcsR0FBRyx5Q0FBeUMsQ0FBQTtBQUMzRCxJQUFJLGNBQWMsR0FBRyx5QkFBeUIsQ0FBQTs7QUFFOUMsSUFBSSxXQUFXLEdBQUcsZUFBZSxDQUFBOztBQUdqQyxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFO0FBQy9CLFFBQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQTtDQUMvQjs7QUFFRCxTQUFTLFVBQVUsQ0FBQyxNQUFNLEVBQUU7QUFDMUIsTUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFBO0FBQ2QsT0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRTtBQUN4RCxRQUFJLFNBQVMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDekIsUUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtBQUN6QixZQUFRLFNBQVM7QUFDakIsV0FBSyxHQUFHO0FBQ04sYUFBSyxDQUFDLEVBQUUsR0FBRyxLQUFLLENBQUE7QUFDaEIsY0FBSztBQUFBLEFBQ1AsV0FBSyxHQUFHO0FBQ04sWUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsS0FBSyxDQUFBLEtBQ3RDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFBO0FBQ2xDLGNBQUs7QUFBQSxLQUNOO0dBQ0Y7QUFDRCxTQUFPLEtBQUssQ0FBQTtDQUNiOztBQUVELFNBQVMsUUFBUSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFO0FBQ2xDLE1BQUksTUFBTSxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUE7QUFDaEMsTUFBSSxHQUFHLEdBQUcsRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEtBQUssRUFBRSxJQUFJLE1BQU0sQ0FBQyxVQUFVLEVBQUMsQ0FBQTtBQUNyRCxNQUFJLEtBQUssR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUE7QUFDOUIsTUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtBQUNoRCxNQUFJLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFBO0FBQzFCLE1BQUksS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBLEtBQ3ZCLElBQUksR0FBRyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsS0FBSyxHQUFHLEVBQUUsQ0FBQTtBQUNsQyxPQUFLLENBQUMsUUFBUSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFDbEMsU0FBTyxHQUFHLENBQUE7Q0FDWDs7QUFFRCxTQUFTLFVBQVUsQ0FBQyxNQUFNLEVBQUU7QUFDMUIsVUFBUSxNQUFNO0FBQ2QsU0FBSyxHQUFHO0FBQ04sYUFBTyxNQUFNLENBQUE7QUFBQSxBQUNmLFNBQUssR0FBRztBQUNOLGFBQU8sTUFBTSxDQUFBO0FBQUEsR0FDZDtBQUNELFNBQU8sS0FBSyxDQUFBO0NBQ2I7O0FBRUQsU0FBUyxTQUFTLENBQUMsSUFBSSxFQUFFO0FBQ3ZCLE1BQUksS0FBSyxFQUFFLElBQUksQ0FBQTtBQUNmLE1BQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQSxJQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtBQUN2RSxXQUFPLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0dBQzFELE1BQU0sSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFBLElBQUssQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFO0FBQzlFLFFBQUksTUFBTSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO0FBQ25ELFdBQU8sUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxNQUFNLEdBQUcsS0FBSyxHQUFHLE9BQU8sQ0FBQyxDQUFBO0dBQ3BELE1BQU0sSUFBSyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBRztBQUM3QyxXQUFPLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsVUFBVSxDQUFDLENBQUE7R0FDdEMsTUFBTTtBQUNMLFdBQU8sRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUE7R0FDckI7Q0FDRjs7QUFFRCxTQUFTLGVBQWUsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFO0FBQ3RDLE1BQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFBO0FBQ3BDLFFBQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUE7Q0FDdkM7O0FBRUQsU0FBUyxXQUFXLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUU7QUFDckMsTUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFO0FBQ2pCLFFBQUksS0FBSyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUEsS0FDeEIsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsQ0FBQTtBQUM1QyxXQUFNO0dBQ1A7O0FBRUQsTUFBSSxNQUFNLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQSxDQUFFLEtBQUssQ0FBQTtBQUNqRSxRQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBOztBQUVqQixNQUFJLElBQUksQ0FBQyxLQUFLLEVBQUU7QUFDZCxTQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0dBQ2pCO0NBQ0Y7O0FBRUQsU0FBUyxVQUFVLENBQUMsS0FBSyxFQUFFO0FBQ3pCLE1BQUksR0FBRyxHQUFHLEVBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFDLENBQUE7QUFDaEMsTUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFBO0FBQ2QsTUFBSSxPQUFPLENBQUE7QUFDWCxPQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFO0FBQ2hELFFBQUksTUFBTSxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUNoQyxRQUFJLE1BQU0sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQSxLQUNqRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLEVBQUU7QUFDcEIsVUFBSSxPQUFPLEVBQUUsZUFBZSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQSxLQUN4QyxPQUFPLENBQUMsS0FBSyxDQUFDLG1CQUFtQixFQUFFLE1BQU0sQ0FBQyxDQUFBO0tBQ2hELE1BQU07QUFDTCxhQUFPLEdBQUksTUFBTSxDQUFDLElBQUksR0FBRyxNQUFNLEdBQUcsSUFBSSxBQUFDLENBQUE7QUFDdkMsaUJBQVcsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFBO0tBQ2hDO0dBQ0Y7QUFDRCxNQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUU7QUFDaEIsV0FBTyxDQUFDLElBQUksQ0FBQyx1Q0FBdUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtHQUM3RDtBQUNELFNBQU8sR0FBRyxDQUFBO0NBQ1g7O0FBRUQsU0FBUyxVQUFVLENBQUMsSUFBSSxFQUFFO0FBQ3hCLE1BQUksR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7QUFDN0IsTUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFBO0FBQ2QsT0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxHQUFHLEdBQUcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRTtBQUM5QyxRQUFJLElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDakIsUUFBSSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtHQUMzQjtBQUNELFNBQU8sS0FBSyxDQUFBO0NBQ2I7Ozs7Ozs7QUFPRCxTQUFTLEtBQUssQ0FBQyxJQUFJLEVBQUU7QUFDbkIsU0FBTyxVQUFVLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUE7Q0FDcEM7O0FBRUQsTUFBTSxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUE7OztBQ3RJdEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeG1CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hLQTs7QUNBQTs7QUNBQTs7QUNBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XG5cbnZhciBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ3dwbWw6Y29tcGlsZXInKVxudmFyIGFzc2lnbiA9IHJlcXVpcmUoJ29iamVjdC1hc3NpZ24nKVxudmFyIGVzY2FwZSA9IHJlcXVpcmUoJ2VzY2FwZS1odG1sJylcbnZhciBsaW5raWZ5ID0gcmVxdWlyZSgnLi9saW5raWZ5JylcbnZhciBjb25maWcgPSByZXF1aXJlKCcuL2NvbmZpZycpXG5cbi8vIGdlbmVyYXRlIGxvbmcgZW5vdWdoIHN0cmluZyBmb3IgY29kZSBpbmRlbmF0aW9uXG52YXIgSU5ERU5UID0gKGZ1bmN0aW9uIChsZW4pIHtcbiAgZm9yICh2YXIgc3RyID0gJyAgICAnOyBzdHIubGVuZ3RoIDwgbGVuOyBzdHIgKz0gc3RyKTtcbiAgcmV0dXJuIHN0clxufSkoODApO1xuXG5mdW5jdGlvbiBmaWx0ZXIodmFsdWUsIHJlKSB7XG4gIHZhciBzcmMgPSB2YWx1ZS5zcGxpdCgnICcpXG4gIHZhciByZXMgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHNyYy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZS50ZXN0KHNyY1tpXSkpIHJlcy5wdXNoKHNyY1tpXSlcbiAgfVxuICByZXR1cm4gcmVzLmpvaW4oJyAnKVxufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVGFnKHdvcmtlciwgdGFnKSB7XG4gIHZhciBvcHRzID0gd29ya2VyLm9wdHNcbiAgdmFyIG5hbWUgPSB0YWcubmFtZS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICBpZiAobmFtZSA9PT0gJ3NjcmlwdCcgJiYgIW9wdHMuamF2YXNjcmlwdCkgcmV0dXJuIHRydWVcbiAgaWYgKG9wdHMud2hpdGVsaXN0ICYmIG9wdHMud2hpdGVsaXN0LmluZGV4T2YobmFtZSkgPT09IC0xKSByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiBhdHRyKG9wdHMsIG5hbWUsIHZhbHVlKSB7XG4gIGlmICghb3B0cy5qYXZhc2NyaXB0ICYmIG9wdHMuaW5saW5lSnNUZXN0LnRlc3QodmFsdWUpKSByZXR1cm4gJyc7XG4gIGlmIChuYW1lID09PSAnaWQnICYmIG9wdHMuaWRUZXN0ICYmICFvcHRzLmlkVGVzdC50ZXN0KHZhbHVlKSkgdmFsdWUgPSAnJ1xuICBpZiAobmFtZSA9PT0gJ2NsYXNzJyAmJiBvcHRzLmNsYXNzVGVzdCkgdmFsdWUgPSBmaWx0ZXIodmFsdWUsIG9wdHMuY2xhc3NUZXN0KVxuICBcbiAgaWYgKHZhbHVlKSByZXR1cm4gZXNjYXBlKG5hbWUpICsgJz1cXFwiJyArIGVzY2FwZSh2YWx1ZSkgKyAnXFxcIidcbiAgZWxzZSByZXR1cm4gJydcbn1cblxuXG5mdW5jdGlvbiBjb21waWxlQXR0cnMod29ya2VyLCBhdHRycykge1xuICB2YXIgc3RyID0gJydcbiAgZm9yICh2YXIgbmFtZSBpbiAoYXR0cnMgfHwge30pKSB7XG4gICAgaWYgKGF0dHJzLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICB2YXIgdiA9IGF0dHIod29ya2VyLm9wdHMsIG5hbWUsIGF0dHJzW25hbWVdKVxuICAgICAgaWYgKHYpIHN0ciArPSAnICcgKyB2XG4gICAgfVxuICB9XG4gIGRlYnVnKCdhdHRycycsIGF0dHJzLCBzdHIpXG4gIHJldHVybiBzdHJcbn1cblxuLy9GSVg6IG1ha2UgY29uZmlndXJhYmxlIGZyb20gYXBwXG5mdW5jdGlvbiB0cnVuY2F0ZVVybCh1cmwsIGxpbWl0KSB7XG4gIGxpbWl0ID0gbGltaXQgfHwgMzBcbiAgdXJsID0gdXJsLnJlcGxhY2UoL2h0dHBbc10/OlxcL1xcLyh3d3dcXC4pPy9pLCAnJylcbiAgaWYgKHVybC5sZW5ndGggPD0gbGltaXQpIHJldHVybiB1cmxcbiAgdmFyIHNlZ21lbnQgPSBNYXRoLmZsb29yKGxpbWl0IC8gMikgLSAxXG4gIHJldHVybiB1cmwuc2xpY2UoMCwgc2VnbWVudCkgKyAnLi4nICsgdXJsLnNsaWNlKHVybC5sZW5ndGggLSBzZWdtZW50KSBcbn1cblxuLyoqXG4gICBFc2NhcGUgYW5kIHVybGl6ZSB0ZXh0LlxuKi9cbmZ1bmN0aW9uIHVybGl6ZSh3b3JrZXIsIHRleHQpIHtcbiAgaWYgKCFsaW5raWZ5LnRlc3QodGV4dCkpIHJldHVybiBlc2NhcGUodGV4dClcbiAgdmFyIG1hdGNoZXMgPSBsaW5raWZ5Lm1hdGNoKHRleHQpXG4gIHZhciBsYXN0SW5kZXggPSAwO1xuICB2YXIgYnVmID0gW11cbiAgZm9yICh2YXIgaSA9IDAsIG1hdGNoOyAobWF0Y2ggPSBtYXRjaGVzW2krK10pOyApIHtcbiAgICBidWYucHVzaChlc2NhcGUodGV4dC5zbGljZShsYXN0SW5kZXgsIG1hdGNoLmluZGV4KSkpXG4gICAgdmFyIGxpbmsgPSB7dGFnOiB0cnVlLCBuYW1lOiAnYScsXG4gICAgICAgICAgICAgICAgYXR0cnM6IHtocmVmOiBtYXRjaC51cmx9LCBcbiAgICAgICAgICAgICAgICB2YWx1ZTogZXNjYXBlKG1hdGNoLnR5cGUgPT09ICdoYXNodGFnJyA/IG1hdGNoLnRleHQgOiB0cnVuY2F0ZVVybChtYXRjaC50ZXh0KSl9XG4gICAgaWYgKG1hdGNoLnR5cGUgPT09ICdoYXNodGFnJykge1xuICAgICAgbGluay5hdHRyc1snY2xhc3MnXSA9ICdwLWNhdGVnb3J5J1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIGxpbmsuYXR0cnMucmVsID0gJ25vZm9sbG93J1xuICAgICAgbGluay5hdHRycy50YXJnZXQgPSAnX2JsYW5rJ1xuICAgIH1cbiAgICBidWYgPSBidWYuY29uY2F0KHRhZ0J1ZmZlcih3b3JrZXIsIGxpbmssIHRydWUpKVxuICAgIGxhc3RJbmRleCA9IG1hdGNoLmxhc3RJbmRleFxuICB9XG4gIGJ1Zi5wdXNoKGVzY2FwZSh0ZXh0LnNsaWNlKGxhc3RJbmRleCkpKVxuICBkZWJ1ZygndXJsaXplJywgbWF0Y2hlcywgYnVmKVxuICByZXR1cm4gYnVmLmpvaW4oJycpXG59XG5cbmZ1bmN0aW9uIHRhZ0J1ZmZlcih3b3JrZXIsIGRhdGEsIHVybGl6ZWQpIHtcbiAgdmFyIG5hbWUgPSBlc2NhcGUoZGF0YS5uYW1lKVxuICB2YXIgYnVmID0gWyc8JywgbmFtZSwgY29tcGlsZUF0dHJzKHdvcmtlciwgZGF0YS5hdHRycyB8fCB7fSksICc+J11cbiAgaWYgKGRhdGEudGFnICYmIGRhdGEudmFsdWUpIHtcbiAgICBidWYucHVzaCh1cmxpemVkID8gZGF0YS52YWx1ZSA6IHVybGl6ZSh3b3JrZXIsIGRhdGEudmFsdWUpKVxuICAgIGJ1Zi5wdXNoKCc8LycsIG5hbWUsICc+JylcbiAgfVxuICBkZWJ1ZygndGFnQnVmZmVyJywgYnVmKVxuICByZXR1cm4gYnVmXG59XG5cblxuLyoqXG4gICBAcmV0dXJuIEVzY2FwZWQgdmVyaXNvbiBvZiB0aGUgZGlzYWJsZWQgbWFya3VwLlxuKi9cbmZ1bmN0aW9uIGVzY2FwZURpc2FibGVkVGFnKHdvcmtlciwgZGF0YSkge1xuICB2YXIgY29udGVudCA9ICh0eXBlb2YgZGF0YS52YWx1ZSA9PT0gJ3N0cmluZycgPyBkYXRhLnZhbHVlIDogJy4uLicpXG4gIHdvcmtlci5mb3JtYXQoZXNjYXBlKFxuICAgICc8JyArIGRhdGEubmFtZSArIGNvbXBpbGVBdHRycyh3b3JrZXIsIGRhdGEuYXR0cnMpICsgJz4nICtcbiAgICAgIGNvbnRlbnQgKyAnPC8nICsgZGF0YS5uYW1lICsgJz4nKSlcbn1cblxuZnVuY3Rpb24gb3BlblRhZyh3b3JrZXIsIGRhdGEpIHtcbiAgd29ya2VyLmZvcm1hdC5hcHBseShudWxsLCB0YWdCdWZmZXIod29ya2VyLCBkYXRhKSlcbn1cblxuZnVuY3Rpb24gY29tcGlsZVRhZyhkYXRhLCB3b3JrZXIpIHtcbiAgdmFyIG5hbWUgPSBkYXRhLm5hbWVcbiAgdmFyIHBsdWdpbiA9IHdvcmtlci5vcHRzLnBsdWdpbnNbbmFtZV1cbiAgaWYgKHBsdWdpbikgcmV0dXJuIHdvcmtlci5mb3JtYXQocGx1Z2luKGRhdGEpKVxuXG4gIGlmIChkYXRhLm5hbWUgJiYgaXNEaXNhYmxlZFRhZyh3b3JrZXIsIGRhdGEpKSB7XG4gICAgaWYgKHdvcmtlci5vcHRzLmV4Y2x1ZGVEaXNhYmxlZFRhZ3MpIHJldHVyblxuICAgIHJldHVybiBlc2NhcGVEaXNhYmxlZFRhZyh3b3JrZXIsIGRhdGEpXG4gIH1cblxuICBpZiAoZGF0YS5ibG9jaykge1xuICAgIG9wZW5UYWcod29ya2VyLCBkYXRhKVxuICAgIHdvcmtlci5zdGFjay5wdXNoKG5hbWUpXG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGRhdGEudmFsdWUubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGNvbXBpbGVMaW5lKGRhdGEudmFsdWVbaV0sIHdvcmtlcilcbiAgICB9XG4gICAgd29ya2VyLnN0YWNrLnBvcCgpXG4gICAgd29ya2VyLmZvcm1hdCgnPC8nLCBuYW1lLCAnPicpXG4gIH0gZWxzZSB7XG4gICAgLy8gc2luZ2xlIG9yIG9uZS1saW5lIHRhZ1xuICAgIG9wZW5UYWcod29ya2VyLCBkYXRhKVxuICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFRhZyhuYW1lLCBlc2NhcGVkLCB3b3JrZXIpIHtcbiAgd29ya2VyLmZvcm1hdCgnPCcsIG5hbWUsICc+JywgZXNjYXBlZCwgJzwvJywgbmFtZSwgJz4nKVxufVxuXG5mdW5jdGlvbiBnZXRTaW5nbGVMaW5lVXJsKGxpbmUpIHtcbiAgdmFyIG1hdGNoZXMgPSBsaW5raWZ5Lm1hdGNoKGxpbmUpXG4gIHZhciBzaW5nbGUgPSBtYXRjaGVzICYmIG1hdGNoZXMubGVuZ3RoID09PSAxICYmIG1hdGNoZXNbMF1cbiAgaWYgKHNpbmdsZSAmJiBzaW5nbGUuaW5kZXggPT09IDAgJiYgc2luZ2xlLmxhc3RJbmRleCA9PT0gbGluZS5sZW5ndGgpIHJldHVybiBzaW5nbGUudXJsXG59XG5cbmZ1bmN0aW9uIGNvbXBpbGVWYWx1ZShkYXRhLCB3b3JrZXIpIHtcbiAgaWYgKHdvcmtlci5zdGFjay5sZW5ndGgpIHJldHVybiB3b3JrZXIuZm9ybWF0KHVybGl6ZSh3b3JrZXIsIGRhdGEudmFsdWUpKVxuXG4gIHZhciBsaW5rUGx1Z2luID0gd29ya2VyLm9wdHMucGx1Z2luc1t3b3JrZXIub3B0cy5saW5rUGx1Z2luXVxuICB2YXIgc2luZ2xlVXJsID0gZ2V0U2luZ2xlTGluZVVybChkYXRhLnZhbHVlKVxuICAvL2RlYnVnKCdjb21waWxlVmFsdWUnLCBzaW5nbGVVcmwsIGxpbmtQbHVnaW4pXG4gIGlmIChsaW5rUGx1Z2luICYmIHNpbmdsZVVybCkgd29ya2VyLmZvcm1hdChsaW5rUGx1Z2luKGRhdGEpKVxuICBlbHNlIHdvcmtlci5mb3JtYXQoJzwnLCBjb25maWcuZGVmYXVsdFRhZywgJz4nLFxuICAgICAgICAgICAgICAgICAgICAgdXJsaXplKHdvcmtlciwgZGF0YS52YWx1ZSksXG4gICAgICAgICAgICAgICAgICAgICAnPC8nLCBjb25maWcuZGVmYXVsdFRhZywgJz4nKVxufVxuXG5mdW5jdGlvbiBzbGljZShkYXRhKSB7XG4gIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChkYXRhKVxufVxuXG5cbmZ1bmN0aW9uIGNvbXBpbGVMaW5lKGRhdGEsIHdvcmtlcikge1xuICBkZWJ1ZygnY29tcGlsZUxpbmUnLCBkYXRhKVxuICBpZiAoZGF0YS5uYW1lKSBjb21waWxlVGFnKGRhdGEsIHdvcmtlcilcbiAgZWxzZSBpZiAoZGF0YS52YWx1ZSkgY29tcGlsZVZhbHVlKGRhdGEsIHdvcmtlcilcbiAgZWxzZSBjb25zb2xlLmxvZygnSW52YWxpZCBsaW5lOiAnLCBkYXRhKVxufVxuXG5cbmZ1bmN0aW9uIG1ha2VXb3JrZXIob3B0cykge1xuICB2YXIgYnVmID0gW11cbiAgdmFyIHN0YWNrID0gW11cblxuICBmdW5jdGlvbiBmb3JtYXQoKSB7XG4gICAgLy9kZWJ1ZygnbmV3IGxpbmU6ICcsIHNsaWNlKGFyZ3VtZW50cykuam9pbignJykpXG4gICAgaWYgKGJ1Zi5sZW5ndGgpIGJ1Zi5wdXNoKCdcXG4nKVxuICAgIGlmIChvcHRzLmluZGVudCAmJiBzdGFjay5sZW5ndGgpIGJ1Zi5wdXNoKElOREVOVC5zbGljZSgwLCBzdGFjay5sZW5ndGggKiBvcHRzLmluZGVudCkpXG4gICAgYnVmLnB1c2guYXBwbHkoYnVmLCBzbGljZShhcmd1bWVudHMpKVxuICB9XG4gIFxuICByZXR1cm4ge29wdHM6IG9wdHMsIGJ1ZjogYnVmLCBzdGFjazogc3RhY2ssIGZvcm1hdDogZm9ybWF0fVxufVxuXG5cbi8qKlxuICAgQ29tcGlsZSBwYXJzZWQgTU1MLWRvY3VtZW50IGludG8gSFRNTC5cbiAgIEBwYXJhbSB7b2JqZWN0fSBhc3QgUGFyc2VkIFdQTUwgZG9jdW1lbnRcbiAgIEBwYXJhbSB7b2JqZWN0fSBvcHRzIFNhbWUgYXMgb3B0cyBpbiBtbWwuZG9jXG4gICBAcmV0dXJueyBzdHJpbmd9IEdlbmVyYXRlZCBodG1sIHN0cmluZy4gXG4qL1xuZnVuY3Rpb24gY29tcGlsZShhc3QsIG9wdHMpIHtcbiAgb3B0cyA9IGFzc2lnbih7fSwgY29uZmlnLmRlZmF1bHRPcHRzLCBvcHRzKVxuICBkZWJ1ZygnY29tcGlsZScsIG9wdHMsIGFzdClcbiAgdmFyIHdvcmtlciA9IG1ha2VXb3JrZXIob3B0cylcbiAgZm9yICh2YXIgaSA9IDAsIHRleHQgPSBhc3QudmFsdWUsIGxlbiA9IHRleHQubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBjb21waWxlTGluZSh0ZXh0W2ldLCB3b3JrZXIpXG4gIH1cbiAgcmV0dXJuIHdvcmtlci5idWYuam9pbignJylcbn1cblxuXG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBpbGVcblxuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gIGRlZmF1bHRUYWc6ICdwJyxcbiAgZGVmYXVsdE9wdHM6IHtcbiAgICBqYXZhc2NyaXB0OiBmYWxzZSxcbiAgICBpbmxpbmVKc1Rlc3Q6IC9eamF2YXNjcmlwdDovaSxcbiAgICBpbmRlbnQ6IDAsXG4gICAgcGx1Z2luczoge30sXG4gICAgbGlua1BsdWdpbjogbnVsbFxuICB9XG59XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBwYXJzZXIgPSByZXF1aXJlKCcuL3BhcnNlcicpXG52YXIgY29tcGlsZXIgPSByZXF1aXJlKCcuL2NvbXBpbGVyJylcbnZhciBsaW5raWZ5ID0gcmVxdWlyZSgnLi9saW5raWZ5JylcblxuLyoqXG4gICBDb252ZXJ0cyB0ZXh0IGluIFdQTUwgZm9ybWF0IHRvIFdQTUwgZG9jdW1lbnQuXG4gICBAcGFyYW0ge3N0cmluZ30gdGV4dCBXUE1MIHRleHRcbiAgIEBwYXJhbSB7b2JqZWN0fSBvcHRzXG4gICBAcGFyYW0ge2Jvb2xlYW59IFtqYXZhc2NyaXB0PWZhbHNlXSBBbGxvdyBpbmxpbmUgSlMgYW5kIHNjcmlwdCB0YWdzIGluc2lkZSBXUE1MIGRvYy5cbiAgIEBwYXJhbSB7bnVtYmVyfSBbaW5kZW50PTBdIE51bWJlciBvZiBzcGFjZXMgdXNlZCBmb3IgaW5kZW50YXRpb24gb2YgZ2VuZXJhdGVkIGh0bWwuXG4gICBAcGFyYW0ge29iamVjdH0gW29wdHMudHJhbnNmb3Jtcz17fV0gTGlzdCBvZiB0YWdzIHRyYW5zZm9ybXMsIGZvciBleGFtcGxlIHRvXG4gICB0cmFuc2Zvcm0gYWxsIHR5cGVzIG9mIGhlYWRpbmdzIHRvIGg0XG4gICB7XCJoMVwiOiBcImg0XCIsIFwiaDJcIjogXCJoNFwiLCBcImgzXCI6IFwiaDRcIn0uXG4gICBAcGFyYW0ge29iamVjdDxzdHJpbmcsIGZ1bmN0aW9uPn0gW29wdHMucGx1Z2luc10gQ29udmVydGVycyBvZiBlbWJlZGRlZCBjb250ZW50IG9iamVjdHNcbiAgIChcInlvdXR1YmVcIiwgXCJmYWNlYm9va1wiLCBcImdhbGxlcnlcIiwgXCJodG1sXCIuIEVhY2ggY29udmVydGVyIHNob3VsZCBwcm9kdWNlIGh0bWxcbiAgIHN0cmluZyB0byByZXBsYWNlIGNvbnRlbnQgb2JqZWN0OlxuICAge1wieW91dHViZVwiOiBmdW5jdGlvbihvYmopIHsuLi59fVxuICAgXG4gICBAcmV0dXJuIHtvYmplY3R9IGRvYyBXUE1MIGRvY3VtZW50XG4gICBAcmV0dXJuIHtvYmplY3R9IGRvYy5tZXRhIE1ldGEgaW5mb3JtYXRpb24gKHRpdGxlLCB0YWdzLCBldGMpXG4gICBAcmV0dXJuIHtzdHJpbmd9IGRvYy5odG1sIEdlbmVyYXRlZCBIVE1MXG4gICBcbiovXG5mdW5jdGlvbiBkb2ModGV4dCwgb3B0cykge1xuICB2YXIgcGFyc2VkID0gcGFyc2VyKHRleHQpXG4gIHJldHVybiB7XG4gICAgbWV0YTogcGFyc2VkLmF0dHJzLFxuICAgIGh0bWw6IGNvbXBpbGVyKHBhcnNlZCwgb3B0cylcbiAgfVxufVxuXG5mdW5jdGlvbiBtZXRhKHRleHQpIHtcbiAgcmV0dXJuIHBhcnNlcih0ZXh0KS5hdHRyc1xufVxuXG5mdW5jdGlvbiByZW5kZXIodGV4dCwgb3B0cykge1xuICByZXR1cm4gY29tcGlsZXIocGFyc2VyKHRleHQpLCBvcHRzKVxufVxuXG5mdW5jdGlvbiBoYXNodGFncyh0ZXh0KSB7XG4gIHZhciByZXMgPSBbXVxuICB2YXIgbWF0Y2hlcyA9IChsaW5raWZ5LnRlc3QodGV4dCkgPyBsaW5raWZ5Lm1hdGNoKHRleHQpIDogW10pXG4gIGZvciAodmFyIGkgPSAwLCBtYXRjaDsgKG1hdGNoID0gbWF0Y2hlc1tpKytdKTsgKSB7XG4gICAgaWYgKG1hdGNoLnR5cGUgPT09ICdoYXNodGFnJykgcmVzLnB1c2gobWF0Y2gudGV4dC5zbGljZSgxKSlcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBwYXJzZTogcGFyc2VyLFxuICByZW5kZXJQYXJzZWQ6IGNvbXBpbGVyLFxuICByZW5kZXI6IHJlbmRlcixcbiAgaHRtbDogcmVuZGVyLFxuICBkb2M6IGRvYyxcbiAgbWV0YTogbWV0YSxcbiAgaGFzaHRhZ3Ncbn1cbiIsInZhciBsaW5raWZ5ID0gcmVxdWlyZSgnbGlua2lmeS1pdCcpKHt9LCB7ZnV6enlFbWFpbDogZmFsc2V9KS50bGRzKCcub25pb24nLCB0cnVlKVxuXG5saW5raWZ5LmFkZCgnIycsIHtcbiAgdmFsaWRhdGU6IGZ1bmN0aW9uICh0ZXh0LCBwb3MsIHNlbGYpIHtcbiAgICB2YXIgdGFpbCA9IHRleHQuc2xpY2UocG9zKVxuICAgIGlmICghc2VsZi5yZS5oYXNodGFnKSB7XG4gICAgICBzZWxmLnJlLmhhc2h0YWcgPSAgbmV3IFJlZ0V4cChcbiAgICAgICAgJ14oW2EtekEtWl0rXFxcXHd7MiwyMH0pKD89JHwnICsgc2VsZi5yZS5zcmNfWlBDYyArICcpJylcbiAgICB9XG4gICAgdmFyIG1hdGNoID0gdGFpbC5tYXRjaChzZWxmLnJlLmhhc2h0YWcpXG4gICAgcmV0dXJuIChtYXRjaCA/IG1hdGNoWzBdLmxlbmd0aCA6IDApIFxuICB9LFxuICBub3JtYWxpemU6IGZ1bmN0aW9uIChtYXRjaCkge1xuICAgIG1hdGNoLnR5cGUgPSAnaGFzaHRhZydcbiAgICBtYXRjaC51cmwgPSAnL3QvJyArIG1hdGNoLnVybC5yZXBsYWNlKC9eIy8sICcnKS50b0xvd2VyQ2FzZSgpXG4gIH1cbn0pXG5cbm1vZHVsZS5leHBvcnRzID0gbGlua2lmeVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCd3cG1sOnBhcnNlcicpXG52YXIgY29uZmlnID0gcmVxdWlyZSgnLi9jb25maWcnKVxuXG4vLyBodHRwOi8vd3d3LnVuaWNvZGUub3JnL3JlcG9ydHMvdHIxOC8jTGluZV9Cb3VuZGFyaWVzXG52YXIgTElORV9SRSA9IC9cXHMqKD86XFxyXFxufFtcXG5cXHJcXHZcXGZcXHg4NVxcdTIwMjhcXHUyMDI5XSkrL1xuXG52YXIgT1BFTl9UQUdfUkUgPSAvXlxccyooW2Etel0rW1xcd1xcLVxcLiNdKik6JC9cbnZhciBDTE9TRV9UQUdfUkUgPSAvXlxccyo6KFthLXpdK1tcXHdcXC1dKikkL1xudmFyIEZVTExfVEFHX1JFID0gL15cXHMqKFshXFwuXT8pKFthLXpdK1tcXHdcXC1cXC4jXSopOlxccysoLispJC9cbnZhciBJTlZBTElEX1RBR19SRSA9IC8oW1xcLiNdezIsfXwjLisjfFtcXC4jXSQpL1xuXG52YXIgU0lOR0xFX1RBR1MgPSAvXihpbWd8aHJ8YnIpJC9cblxuXG5mdW5jdGlvbiBtZXJnZU1ldGEobWV0YSwgdGFyZ2V0KSB7XG4gIHRhcmdldFttZXRhLm5hbWVdID0gbWV0YS52YWx1ZVxufVxuXG5mdW5jdGlvbiBwYXJzZUF0dHJzKHRva2Vucykge1xuICB2YXIgYXR0cnMgPSB7fVxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gdG9rZW5zLmxlbmd0aCAtIDE7IGkgPCBsZW47IGkgKz0gMikge1xuICAgIHZhciBzZXBhcmF0b3IgPSB0b2tlbnNbaV1cbiAgICB2YXIgdG9rZW4gPSB0b2tlbnNbaSArIDFdXG4gICAgc3dpdGNoIChzZXBhcmF0b3IpIHtcbiAgICBjYXNlICcjJzpcbiAgICAgIGF0dHJzLmlkID0gdG9rZW5cbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnLic6XG4gICAgICBpZiAoIWF0dHJzWydjbGFzcyddKSBhdHRyc1snY2xhc3MnXSA9IHRva2VuXG4gICAgICBlbHNlIGF0dHJzWydjbGFzcyddICs9ICcgJyArIHRva2VuXG4gICAgICBicmVha1xuICAgIH1cbiAgfVxuICByZXR1cm4gYXR0cnNcbn1cblxuZnVuY3Rpb24gcGFyc2VUYWcoc3RyLCB0eXBlLCB2YWx1ZSkge1xuICB2YXIgdG9rZW5zID0gc3RyLnNwbGl0KC8oXFwufCMpLylcbiAgdmFyIHRhZyA9IHtuYW1lOiB0b2tlbnMuc2hpZnQoKSB8fCBjb25maWcuZGVmYXVsdFRhZ31cbiAgdmFyIGF0dHJzID0gcGFyc2VBdHRycyh0b2tlbnMpXG4gIGlmIChPYmplY3Qua2V5cyhhdHRycykubGVuZ3RoKSB0YWcuYXR0cnMgPSBhdHRyc1xuICBpZiAodHlwZSkgdGFnW3R5cGVdID0gdHJ1ZVxuICBpZiAodmFsdWUpIHRhZy52YWx1ZSA9IHZhbHVlXG4gIGVsc2UgaWYgKHRhZy5ibG9jaykgdGFnLnZhbHVlID0gW11cbiAgZGVidWcoJ3Rva2VucycsIHRva2VucywgJy0+JywgdGFnKVxuICByZXR1cm4gdGFnXG59XG5cbmZ1bmN0aW9uIHByZWZpeFR5cGUocHJlZml4KSB7XG4gIHN3aXRjaCAocHJlZml4KSB7XG4gIGNhc2UgJyEnOlxuICAgIHJldHVybiAncm9vdCdcbiAgY2FzZSAnLic6XG4gICAgcmV0dXJuICdhdHRyJ1xuICB9XG4gIHJldHVybiAndGFnJ1xufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmUobGluZSkge1xuICB2YXIgbWF0Y2gsIGRhdGFcbiAgaWYgKChtYXRjaCA9IGxpbmUubWF0Y2goRlVMTF9UQUdfUkUpKSAmJiAhSU5WQUxJRF9UQUdfUkUudGVzdChtYXRjaFsyXSkpIHtcbiAgICByZXR1cm4gcGFyc2VUYWcobWF0Y2hbMl0sIHByZWZpeFR5cGUobWF0Y2hbMV0pLCBtYXRjaFszXSlcbiAgfSBlbHNlIGlmICgobWF0Y2ggPSBsaW5lLm1hdGNoKE9QRU5fVEFHX1JFKSkgJiYgIUlOVkFMSURfVEFHX1JFLnRlc3QobWF0Y2hbMV0pKSB7XG4gICAgdmFyIHNpbmdsZSA9IFNJTkdMRV9UQUdTLnRlc3QobWF0Y2hbMV0pIHx8IG1hdGNoWzJdXG4gICAgcmV0dXJuIHBhcnNlVGFnKG1hdGNoWzFdLCBzaW5nbGUgPyAndGFnJyA6ICdibG9jaycpXG4gIH0gZWxzZSBpZiAoKG1hdGNoID0gbGluZS5tYXRjaChDTE9TRV9UQUdfUkUpKSkge1xuICAgIHJldHVybiBwYXJzZVRhZyhtYXRjaFsxXSwgJ2Jsb2NrZW5kJylcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4ge3ZhbHVlOiBsaW5lfVxuICB9XG59XG5cbmZ1bmN0aW9uIG1lcmdlSW50b1BhcmVudChwYXJlbnQsIGNoaWxkKSB7XG4gIGlmICghcGFyZW50LmF0dHJzKSBwYXJlbnQuYXR0cnMgPSB7fVxuICBwYXJlbnQuYXR0cnNbY2hpbGQubmFtZV0gPSBjaGlsZC52YWx1ZVxufVxuXG5mdW5jdGlvbiBwcm9jZXNzTGluZShsaW5lLCBkb2MsIHN0YWNrKSB7XG4gIGlmIChsaW5lLmJsb2NrZW5kKSB7XG4gICAgaWYgKHN0YWNrLmxlbmd0aCkgc3RhY2sucG9wKClcbiAgICBlbHNlIGNvbnNvbGUuZXJyb3IoJ05vIG9wZW4gdGFnIGZvciAnLCBsaW5lKVxuICAgIHJldHVyblxuICB9XG5cbiAgdmFyIHRhcmdldCA9IChzdGFjay5sZW5ndGggPyBzdGFja1tzdGFjay5sZW5ndGggLSAxXSA6IGRvYykudmFsdWVcbiAgdGFyZ2V0LnB1c2gobGluZSlcblxuICBpZiAobGluZS5ibG9jaykge1xuICAgIHN0YWNrLnB1c2gobGluZSlcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmVzKGxpbmVzKSB7XG4gIHZhciBkb2MgPSB7YXR0cnM6IHt9LCB2YWx1ZTogW119XG4gIHZhciBzdGFjayA9IFtdXG4gIHZhciBsYXN0VGFnXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBsaW5lcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZUxpbmUobGluZXNbaV0pXG4gICAgaWYgKHBhcnNlZC5yb290KSBkb2MuYXR0cnNbcGFyc2VkLm5hbWVdID0gcGFyc2VkLnZhbHVlXG4gICAgZWxzZSBpZiAocGFyc2VkLmF0dHIpIHtcbiAgICAgIGlmIChsYXN0VGFnKSBtZXJnZUludG9QYXJlbnQobGFzdFRhZywgcGFyc2VkKVxuICAgICAgZWxzZSBjb25zb2xlLmVycm9yKCdObyBwYXJlbnQgdGFnIGZvcicsIHBhcnNlZClcbiAgICB9IGVsc2Uge1xuICAgICAgbGFzdFRhZyA9IChwYXJzZWQubmFtZSA/IHBhcnNlZCA6IG51bGwpXG4gICAgICBwcm9jZXNzTGluZShwYXJzZWQsIGRvYywgc3RhY2spXG4gICAgfVxuICB9XG4gIGlmIChzdGFjay5sZW5ndGgpIHtcbiAgICBjb25zb2xlLndhcm4oJ1BhcnNlciBmaW5pc2hlZCB3aXRoIHVuY2xvc2VkIHRhZ3M6XFxuJywgc3RhY2spXG4gIH1cbiAgcmV0dXJuIGRvY1xufVxuXG5mdW5jdGlvbiBzcGxpdExpbmVzKHRleHQpIHtcbiAgdmFyIHJhdyA9IHRleHQuc3BsaXQoTElORV9SRSlcbiAgdmFyIGxpbmVzID0gW11cbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHJhdy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIHZhciBsaW5lID0gcmF3W2ldXG4gICAgaWYgKGxpbmUpIGxpbmVzLnB1c2gobGluZSlcbiAgfVxuICByZXR1cm4gbGluZXNcbn1cblxuLyoqXG4gICBQYXJzZSB0ZXh0IGluIFdQTUwgZm9ybWF0IGFuZCByZXR1cm4gSlNPTiBzdHJ1Y3R1cmUgb2YgYSBkb2N1bWVudC5cbiAgIEBwYXJhbSB7c3RyaW5nfSB0ZXh0XG4gICBAcmV0dXJuIHtvYmplY3R9XG4qL1xuZnVuY3Rpb24gcGFyc2UodGV4dCkge1xuICByZXR1cm4gcGFyc2VMaW5lcyhzcGxpdExpbmVzKHRleHQpKVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHBhcnNlXG4iLCJcbi8qKlxuICogVGhpcyBpcyB0aGUgd2ViIGJyb3dzZXIgaW1wbGVtZW50YXRpb24gb2YgYGRlYnVnKClgLlxuICpcbiAqIEV4cG9zZSBgZGVidWcoKWAgYXMgdGhlIG1vZHVsZS5cbiAqL1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2RlYnVnJyk7XG5leHBvcnRzLmxvZyA9IGxvZztcbmV4cG9ydHMuZm9ybWF0QXJncyA9IGZvcm1hdEFyZ3M7XG5leHBvcnRzLnNhdmUgPSBzYXZlO1xuZXhwb3J0cy5sb2FkID0gbG9hZDtcbmV4cG9ydHMudXNlQ29sb3JzID0gdXNlQ29sb3JzO1xuZXhwb3J0cy5zdG9yYWdlID0gJ3VuZGVmaW5lZCcgIT0gdHlwZW9mIGNocm9tZVxuICAgICAgICAgICAgICAgJiYgJ3VuZGVmaW5lZCcgIT0gdHlwZW9mIGNocm9tZS5zdG9yYWdlXG4gICAgICAgICAgICAgICAgICA/IGNocm9tZS5zdG9yYWdlLmxvY2FsXG4gICAgICAgICAgICAgICAgICA6IGxvY2Fsc3RvcmFnZSgpO1xuXG4vKipcbiAqIENvbG9ycy5cbiAqL1xuXG5leHBvcnRzLmNvbG9ycyA9IFtcbiAgJ2xpZ2h0c2VhZ3JlZW4nLFxuICAnZm9yZXN0Z3JlZW4nLFxuICAnZ29sZGVucm9kJyxcbiAgJ2RvZGdlcmJsdWUnLFxuICAnZGFya29yY2hpZCcsXG4gICdjcmltc29uJ1xuXTtcblxuLyoqXG4gKiBDdXJyZW50bHkgb25seSBXZWJLaXQtYmFzZWQgV2ViIEluc3BlY3RvcnMsIEZpcmVmb3ggPj0gdjMxLFxuICogYW5kIHRoZSBGaXJlYnVnIGV4dGVuc2lvbiAoYW55IEZpcmVmb3ggdmVyc2lvbikgYXJlIGtub3duXG4gKiB0byBzdXBwb3J0IFwiJWNcIiBDU1MgY3VzdG9taXphdGlvbnMuXG4gKlxuICogVE9ETzogYWRkIGEgYGxvY2FsU3RvcmFnZWAgdmFyaWFibGUgdG8gZXhwbGljaXRseSBlbmFibGUvZGlzYWJsZSBjb2xvcnNcbiAqL1xuXG5mdW5jdGlvbiB1c2VDb2xvcnMoKSB7XG4gIC8vIGlzIHdlYmtpdD8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMTY0NTk2MDYvMzc2NzczXG4gIHJldHVybiAoJ1dlYmtpdEFwcGVhcmFuY2UnIGluIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZSkgfHxcbiAgICAvLyBpcyBmaXJlYnVnPyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8zOTgxMjAvMzc2NzczXG4gICAgKHdpbmRvdy5jb25zb2xlICYmIChjb25zb2xlLmZpcmVidWcgfHwgKGNvbnNvbGUuZXhjZXB0aW9uICYmIGNvbnNvbGUudGFibGUpKSkgfHxcbiAgICAvLyBpcyBmaXJlZm94ID49IHYzMT9cbiAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1Rvb2xzL1dlYl9Db25zb2xlI1N0eWxpbmdfbWVzc2FnZXNcbiAgICAobmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC9maXJlZm94XFwvKFxcZCspLykgJiYgcGFyc2VJbnQoUmVnRXhwLiQxLCAxMCkgPj0gMzEpO1xufVxuXG4vKipcbiAqIE1hcCAlaiB0byBgSlNPTi5zdHJpbmdpZnkoKWAsIHNpbmNlIG5vIFdlYiBJbnNwZWN0b3JzIGRvIHRoYXQgYnkgZGVmYXVsdC5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdHRlcnMuaiA9IGZ1bmN0aW9uKHYpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpO1xufTtcblxuXG4vKipcbiAqIENvbG9yaXplIGxvZyBhcmd1bWVudHMgaWYgZW5hYmxlZC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGZvcm1hdEFyZ3MoKSB7XG4gIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICB2YXIgdXNlQ29sb3JzID0gdGhpcy51c2VDb2xvcnM7XG5cbiAgYXJnc1swXSA9ICh1c2VDb2xvcnMgPyAnJWMnIDogJycpXG4gICAgKyB0aGlzLm5hbWVzcGFjZVxuICAgICsgKHVzZUNvbG9ycyA/ICcgJWMnIDogJyAnKVxuICAgICsgYXJnc1swXVxuICAgICsgKHVzZUNvbG9ycyA/ICclYyAnIDogJyAnKVxuICAgICsgJysnICsgZXhwb3J0cy5odW1hbml6ZSh0aGlzLmRpZmYpO1xuXG4gIGlmICghdXNlQ29sb3JzKSByZXR1cm4gYXJncztcblxuICB2YXIgYyA9ICdjb2xvcjogJyArIHRoaXMuY29sb3I7XG4gIGFyZ3MgPSBbYXJnc1swXSwgYywgJ2NvbG9yOiBpbmhlcml0J10uY29uY2F0KEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3MsIDEpKTtcblxuICAvLyB0aGUgZmluYWwgXCIlY1wiIGlzIHNvbWV3aGF0IHRyaWNreSwgYmVjYXVzZSB0aGVyZSBjb3VsZCBiZSBvdGhlclxuICAvLyBhcmd1bWVudHMgcGFzc2VkIGVpdGhlciBiZWZvcmUgb3IgYWZ0ZXIgdGhlICVjLCBzbyB3ZSBuZWVkIHRvXG4gIC8vIGZpZ3VyZSBvdXQgdGhlIGNvcnJlY3QgaW5kZXggdG8gaW5zZXJ0IHRoZSBDU1MgaW50b1xuICB2YXIgaW5kZXggPSAwO1xuICB2YXIgbGFzdEMgPSAwO1xuICBhcmdzWzBdLnJlcGxhY2UoLyVbYS16JV0vZywgZnVuY3Rpb24obWF0Y2gpIHtcbiAgICBpZiAoJyUlJyA9PT0gbWF0Y2gpIHJldHVybjtcbiAgICBpbmRleCsrO1xuICAgIGlmICgnJWMnID09PSBtYXRjaCkge1xuICAgICAgLy8gd2Ugb25seSBhcmUgaW50ZXJlc3RlZCBpbiB0aGUgKmxhc3QqICVjXG4gICAgICAvLyAodGhlIHVzZXIgbWF5IGhhdmUgcHJvdmlkZWQgdGhlaXIgb3duKVxuICAgICAgbGFzdEMgPSBpbmRleDtcbiAgICB9XG4gIH0pO1xuXG4gIGFyZ3Muc3BsaWNlKGxhc3RDLCAwLCBjKTtcbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8qKlxuICogSW52b2tlcyBgY29uc29sZS5sb2coKWAgd2hlbiBhdmFpbGFibGUuXG4gKiBOby1vcCB3aGVuIGBjb25zb2xlLmxvZ2AgaXMgbm90IGEgXCJmdW5jdGlvblwiLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyB0aGlzIGhhY2tlcnkgaXMgcmVxdWlyZWQgZm9yIElFOC85LCB3aGVyZVxuICAvLyB0aGUgYGNvbnNvbGUubG9nYCBmdW5jdGlvbiBkb2Vzbid0IGhhdmUgJ2FwcGx5J1xuICByZXR1cm4gJ29iamVjdCcgPT09IHR5cGVvZiBjb25zb2xlXG4gICAgJiYgY29uc29sZS5sb2dcbiAgICAmJiBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHkuY2FsbChjb25zb2xlLmxvZywgY29uc29sZSwgYXJndW1lbnRzKTtcbn1cblxuLyoqXG4gKiBTYXZlIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2F2ZShuYW1lc3BhY2VzKSB7XG4gIHRyeSB7XG4gICAgaWYgKG51bGwgPT0gbmFtZXNwYWNlcykge1xuICAgICAgZXhwb3J0cy5zdG9yYWdlLnJlbW92ZUl0ZW0oJ2RlYnVnJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cG9ydHMuc3RvcmFnZS5kZWJ1ZyA9IG5hbWVzcGFjZXM7XG4gICAgfVxuICB9IGNhdGNoKGUpIHt9XG59XG5cbi8qKlxuICogTG9hZCBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHJldHVybiB7U3RyaW5nfSByZXR1cm5zIHRoZSBwcmV2aW91c2x5IHBlcnNpc3RlZCBkZWJ1ZyBtb2Rlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9hZCgpIHtcbiAgdmFyIHI7XG4gIHRyeSB7XG4gICAgciA9IGV4cG9ydHMuc3RvcmFnZS5kZWJ1ZztcbiAgfSBjYXRjaChlKSB7fVxuICByZXR1cm4gcjtcbn1cblxuLyoqXG4gKiBFbmFibGUgbmFtZXNwYWNlcyBsaXN0ZWQgaW4gYGxvY2FsU3RvcmFnZS5kZWJ1Z2AgaW5pdGlhbGx5LlxuICovXG5cbmV4cG9ydHMuZW5hYmxlKGxvYWQoKSk7XG5cbi8qKlxuICogTG9jYWxzdG9yYWdlIGF0dGVtcHRzIHRvIHJldHVybiB0aGUgbG9jYWxzdG9yYWdlLlxuICpcbiAqIFRoaXMgaXMgbmVjZXNzYXJ5IGJlY2F1c2Ugc2FmYXJpIHRocm93c1xuICogd2hlbiBhIHVzZXIgZGlzYWJsZXMgY29va2llcy9sb2NhbHN0b3JhZ2VcbiAqIGFuZCB5b3UgYXR0ZW1wdCB0byBhY2Nlc3MgaXQuXG4gKlxuICogQHJldHVybiB7TG9jYWxTdG9yYWdlfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9jYWxzdG9yYWdlKCl7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG4gIH0gY2F0Y2ggKGUpIHt9XG59XG4iLCJcbi8qKlxuICogVGhpcyBpcyB0aGUgY29tbW9uIGxvZ2ljIGZvciBib3RoIHRoZSBOb2RlLmpzIGFuZCB3ZWIgYnJvd3NlclxuICogaW1wbGVtZW50YXRpb25zIG9mIGBkZWJ1ZygpYC5cbiAqXG4gKiBFeHBvc2UgYGRlYnVnKClgIGFzIHRoZSBtb2R1bGUuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gZGVidWc7XG5leHBvcnRzLmNvZXJjZSA9IGNvZXJjZTtcbmV4cG9ydHMuZGlzYWJsZSA9IGRpc2FibGU7XG5leHBvcnRzLmVuYWJsZSA9IGVuYWJsZTtcbmV4cG9ydHMuZW5hYmxlZCA9IGVuYWJsZWQ7XG5leHBvcnRzLmh1bWFuaXplID0gcmVxdWlyZSgnbXMnKTtcblxuLyoqXG4gKiBUaGUgY3VycmVudGx5IGFjdGl2ZSBkZWJ1ZyBtb2RlIG5hbWVzLCBhbmQgbmFtZXMgdG8gc2tpcC5cbiAqL1xuXG5leHBvcnRzLm5hbWVzID0gW107XG5leHBvcnRzLnNraXBzID0gW107XG5cbi8qKlxuICogTWFwIG9mIHNwZWNpYWwgXCIlblwiIGhhbmRsaW5nIGZ1bmN0aW9ucywgZm9yIHRoZSBkZWJ1ZyBcImZvcm1hdFwiIGFyZ3VtZW50LlxuICpcbiAqIFZhbGlkIGtleSBuYW1lcyBhcmUgYSBzaW5nbGUsIGxvd2VyY2FzZWQgbGV0dGVyLCBpLmUuIFwiblwiLlxuICovXG5cbmV4cG9ydHMuZm9ybWF0dGVycyA9IHt9O1xuXG4vKipcbiAqIFByZXZpb3VzbHkgYXNzaWduZWQgY29sb3IuXG4gKi9cblxudmFyIHByZXZDb2xvciA9IDA7XG5cbi8qKlxuICogUHJldmlvdXMgbG9nIHRpbWVzdGFtcC5cbiAqL1xuXG52YXIgcHJldlRpbWU7XG5cbi8qKlxuICogU2VsZWN0IGEgY29sb3IuXG4gKlxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2VsZWN0Q29sb3IoKSB7XG4gIHJldHVybiBleHBvcnRzLmNvbG9yc1twcmV2Q29sb3IrKyAlIGV4cG9ydHMuY29sb3JzLmxlbmd0aF07XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgZGVidWdnZXIgd2l0aCB0aGUgZ2l2ZW4gYG5hbWVzcGFjZWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZVxuICogQHJldHVybiB7RnVuY3Rpb259XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGRlYnVnKG5hbWVzcGFjZSkge1xuXG4gIC8vIGRlZmluZSB0aGUgYGRpc2FibGVkYCB2ZXJzaW9uXG4gIGZ1bmN0aW9uIGRpc2FibGVkKCkge1xuICB9XG4gIGRpc2FibGVkLmVuYWJsZWQgPSBmYWxzZTtcblxuICAvLyBkZWZpbmUgdGhlIGBlbmFibGVkYCB2ZXJzaW9uXG4gIGZ1bmN0aW9uIGVuYWJsZWQoKSB7XG5cbiAgICB2YXIgc2VsZiA9IGVuYWJsZWQ7XG5cbiAgICAvLyBzZXQgYGRpZmZgIHRpbWVzdGFtcFxuICAgIHZhciBjdXJyID0gK25ldyBEYXRlKCk7XG4gICAgdmFyIG1zID0gY3VyciAtIChwcmV2VGltZSB8fCBjdXJyKTtcbiAgICBzZWxmLmRpZmYgPSBtcztcbiAgICBzZWxmLnByZXYgPSBwcmV2VGltZTtcbiAgICBzZWxmLmN1cnIgPSBjdXJyO1xuICAgIHByZXZUaW1lID0gY3VycjtcblxuICAgIC8vIGFkZCB0aGUgYGNvbG9yYCBpZiBub3Qgc2V0XG4gICAgaWYgKG51bGwgPT0gc2VsZi51c2VDb2xvcnMpIHNlbGYudXNlQ29sb3JzID0gZXhwb3J0cy51c2VDb2xvcnMoKTtcbiAgICBpZiAobnVsbCA9PSBzZWxmLmNvbG9yICYmIHNlbGYudXNlQ29sb3JzKSBzZWxmLmNvbG9yID0gc2VsZWN0Q29sb3IoKTtcblxuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcblxuICAgIGFyZ3NbMF0gPSBleHBvcnRzLmNvZXJjZShhcmdzWzBdKTtcblxuICAgIGlmICgnc3RyaW5nJyAhPT0gdHlwZW9mIGFyZ3NbMF0pIHtcbiAgICAgIC8vIGFueXRoaW5nIGVsc2UgbGV0J3MgaW5zcGVjdCB3aXRoICVvXG4gICAgICBhcmdzID0gWyclbyddLmNvbmNhdChhcmdzKTtcbiAgICB9XG5cbiAgICAvLyBhcHBseSBhbnkgYGZvcm1hdHRlcnNgIHRyYW5zZm9ybWF0aW9uc1xuICAgIHZhciBpbmRleCA9IDA7XG4gICAgYXJnc1swXSA9IGFyZ3NbMF0ucmVwbGFjZSgvJShbYS16JV0pL2csIGZ1bmN0aW9uKG1hdGNoLCBmb3JtYXQpIHtcbiAgICAgIC8vIGlmIHdlIGVuY291bnRlciBhbiBlc2NhcGVkICUgdGhlbiBkb24ndCBpbmNyZWFzZSB0aGUgYXJyYXkgaW5kZXhcbiAgICAgIGlmIChtYXRjaCA9PT0gJyUlJykgcmV0dXJuIG1hdGNoO1xuICAgICAgaW5kZXgrKztcbiAgICAgIHZhciBmb3JtYXR0ZXIgPSBleHBvcnRzLmZvcm1hdHRlcnNbZm9ybWF0XTtcbiAgICAgIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgZm9ybWF0dGVyKSB7XG4gICAgICAgIHZhciB2YWwgPSBhcmdzW2luZGV4XTtcbiAgICAgICAgbWF0Y2ggPSBmb3JtYXR0ZXIuY2FsbChzZWxmLCB2YWwpO1xuXG4gICAgICAgIC8vIG5vdyB3ZSBuZWVkIHRvIHJlbW92ZSBgYXJnc1tpbmRleF1gIHNpbmNlIGl0J3MgaW5saW5lZCBpbiB0aGUgYGZvcm1hdGBcbiAgICAgICAgYXJncy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICBpbmRleC0tO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1hdGNoO1xuICAgIH0pO1xuXG4gICAgaWYgKCdmdW5jdGlvbicgPT09IHR5cGVvZiBleHBvcnRzLmZvcm1hdEFyZ3MpIHtcbiAgICAgIGFyZ3MgPSBleHBvcnRzLmZvcm1hdEFyZ3MuYXBwbHkoc2VsZiwgYXJncyk7XG4gICAgfVxuICAgIHZhciBsb2dGbiA9IGVuYWJsZWQubG9nIHx8IGV4cG9ydHMubG9nIHx8IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG4gICAgbG9nRm4uYXBwbHkoc2VsZiwgYXJncyk7XG4gIH1cbiAgZW5hYmxlZC5lbmFibGVkID0gdHJ1ZTtcblxuICB2YXIgZm4gPSBleHBvcnRzLmVuYWJsZWQobmFtZXNwYWNlKSA/IGVuYWJsZWQgOiBkaXNhYmxlZDtcblxuICBmbi5uYW1lc3BhY2UgPSBuYW1lc3BhY2U7XG5cbiAgcmV0dXJuIGZuO1xufVxuXG4vKipcbiAqIEVuYWJsZXMgYSBkZWJ1ZyBtb2RlIGJ5IG5hbWVzcGFjZXMuIFRoaXMgY2FuIGluY2x1ZGUgbW9kZXNcbiAqIHNlcGFyYXRlZCBieSBhIGNvbG9uIGFuZCB3aWxkY2FyZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZW5hYmxlKG5hbWVzcGFjZXMpIHtcbiAgZXhwb3J0cy5zYXZlKG5hbWVzcGFjZXMpO1xuXG4gIHZhciBzcGxpdCA9IChuYW1lc3BhY2VzIHx8ICcnKS5zcGxpdCgvW1xccyxdKy8pO1xuICB2YXIgbGVuID0gc3BsaXQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZiAoIXNwbGl0W2ldKSBjb250aW51ZTsgLy8gaWdub3JlIGVtcHR5IHN0cmluZ3NcbiAgICBuYW1lc3BhY2VzID0gc3BsaXRbaV0ucmVwbGFjZSgvXFwqL2csICcuKj8nKTtcbiAgICBpZiAobmFtZXNwYWNlc1swXSA9PT0gJy0nKSB7XG4gICAgICBleHBvcnRzLnNraXBzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzLnN1YnN0cigxKSArICckJykpO1xuICAgIH0gZWxzZSB7XG4gICAgICBleHBvcnRzLm5hbWVzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzICsgJyQnKSk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogRGlzYWJsZSBkZWJ1ZyBvdXRwdXQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBkaXNhYmxlKCkge1xuICBleHBvcnRzLmVuYWJsZSgnJyk7XG59XG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGlmIHRoZSBnaXZlbiBtb2RlIG5hbWUgaXMgZW5hYmxlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBlbmFibGVkKG5hbWUpIHtcbiAgdmFyIGksIGxlbjtcbiAgZm9yIChpID0gMCwgbGVuID0gZXhwb3J0cy5za2lwcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGlmIChleHBvcnRzLnNraXBzW2ldLnRlc3QobmFtZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgZm9yIChpID0gMCwgbGVuID0gZXhwb3J0cy5uYW1lcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGlmIChleHBvcnRzLm5hbWVzW2ldLnRlc3QobmFtZSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogQ29lcmNlIGB2YWxgLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IHZhbFxuICogQHJldHVybiB7TWl4ZWR9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBjb2VyY2UodmFsKSB7XG4gIGlmICh2YWwgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIHZhbC5zdGFjayB8fCB2YWwubWVzc2FnZTtcbiAgcmV0dXJuIHZhbDtcbn1cbiIsIi8qKlxuICogSGVscGVycy5cbiAqL1xuXG52YXIgcyA9IDEwMDA7XG52YXIgbSA9IHMgKiA2MDtcbnZhciBoID0gbSAqIDYwO1xudmFyIGQgPSBoICogMjQ7XG52YXIgeSA9IGQgKiAzNjUuMjU7XG5cbi8qKlxuICogUGFyc2Ugb3IgZm9ybWF0IHRoZSBnaXZlbiBgdmFsYC5cbiAqXG4gKiBPcHRpb25zOlxuICpcbiAqICAtIGBsb25nYCB2ZXJib3NlIGZvcm1hdHRpbmcgW2ZhbHNlXVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gdmFsXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQHJldHVybiB7U3RyaW5nfE51bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWwsIG9wdGlvbnMpe1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgaWYgKCdzdHJpbmcnID09IHR5cGVvZiB2YWwpIHJldHVybiBwYXJzZSh2YWwpO1xuICByZXR1cm4gb3B0aW9ucy5sb25nXG4gICAgPyBsb25nKHZhbClcbiAgICA6IHNob3J0KHZhbCk7XG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBgc3RyYCBhbmQgcmV0dXJuIG1pbGxpc2Vjb25kcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgc3RyID0gJycgKyBzdHI7XG4gIGlmIChzdHIubGVuZ3RoID4gMTAwMDApIHJldHVybjtcbiAgdmFyIG1hdGNoID0gL14oKD86XFxkKyk/XFwuP1xcZCspICoobWlsbGlzZWNvbmRzP3xtc2Vjcz98bXN8c2Vjb25kcz98c2Vjcz98c3xtaW51dGVzP3xtaW5zP3xtfGhvdXJzP3xocnM/fGh8ZGF5cz98ZHx5ZWFycz98eXJzP3x5KT8kL2kuZXhlYyhzdHIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG4gIHZhciBuID0gcGFyc2VGbG9hdChtYXRjaFsxXSk7XG4gIHZhciB0eXBlID0gKG1hdGNoWzJdIHx8ICdtcycpLnRvTG93ZXJDYXNlKCk7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ3llYXJzJzpcbiAgICBjYXNlICd5ZWFyJzpcbiAgICBjYXNlICd5cnMnOlxuICAgIGNhc2UgJ3lyJzpcbiAgICBjYXNlICd5JzpcbiAgICAgIHJldHVybiBuICogeTtcbiAgICBjYXNlICdkYXlzJzpcbiAgICBjYXNlICdkYXknOlxuICAgIGNhc2UgJ2QnOlxuICAgICAgcmV0dXJuIG4gKiBkO1xuICAgIGNhc2UgJ2hvdXJzJzpcbiAgICBjYXNlICdob3VyJzpcbiAgICBjYXNlICdocnMnOlxuICAgIGNhc2UgJ2hyJzpcbiAgICBjYXNlICdoJzpcbiAgICAgIHJldHVybiBuICogaDtcbiAgICBjYXNlICdtaW51dGVzJzpcbiAgICBjYXNlICdtaW51dGUnOlxuICAgIGNhc2UgJ21pbnMnOlxuICAgIGNhc2UgJ21pbic6XG4gICAgY2FzZSAnbSc6XG4gICAgICByZXR1cm4gbiAqIG07XG4gICAgY2FzZSAnc2Vjb25kcyc6XG4gICAgY2FzZSAnc2Vjb25kJzpcbiAgICBjYXNlICdzZWNzJzpcbiAgICBjYXNlICdzZWMnOlxuICAgIGNhc2UgJ3MnOlxuICAgICAgcmV0dXJuIG4gKiBzO1xuICAgIGNhc2UgJ21pbGxpc2Vjb25kcyc6XG4gICAgY2FzZSAnbWlsbGlzZWNvbmQnOlxuICAgIGNhc2UgJ21zZWNzJzpcbiAgICBjYXNlICdtc2VjJzpcbiAgICBjYXNlICdtcyc6XG4gICAgICByZXR1cm4gbjtcbiAgfVxufVxuXG4vKipcbiAqIFNob3J0IGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNob3J0KG1zKSB7XG4gIGlmIChtcyA+PSBkKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGQpICsgJ2QnO1xuICBpZiAobXMgPj0gaCkgcmV0dXJuIE1hdGgucm91bmQobXMgLyBoKSArICdoJztcbiAgaWYgKG1zID49IG0pIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gbSkgKyAnbSc7XG4gIGlmIChtcyA+PSBzKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIHMpICsgJ3MnO1xuICByZXR1cm4gbXMgKyAnbXMnO1xufVxuXG4vKipcbiAqIExvbmcgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9uZyhtcykge1xuICByZXR1cm4gcGx1cmFsKG1zLCBkLCAnZGF5JylcbiAgICB8fCBwbHVyYWwobXMsIGgsICdob3VyJylcbiAgICB8fCBwbHVyYWwobXMsIG0sICdtaW51dGUnKVxuICAgIHx8IHBsdXJhbChtcywgcywgJ3NlY29uZCcpXG4gICAgfHwgbXMgKyAnIG1zJztcbn1cblxuLyoqXG4gKiBQbHVyYWxpemF0aW9uIGhlbHBlci5cbiAqL1xuXG5mdW5jdGlvbiBwbHVyYWwobXMsIG4sIG5hbWUpIHtcbiAgaWYgKG1zIDwgbikgcmV0dXJuO1xuICBpZiAobXMgPCBuICogMS41KSByZXR1cm4gTWF0aC5mbG9vcihtcyAvIG4pICsgJyAnICsgbmFtZTtcbiAgcmV0dXJuIE1hdGguY2VpbChtcyAvIG4pICsgJyAnICsgbmFtZSArICdzJztcbn1cbiIsIi8qIVxuICogZXNjYXBlLWh0bWxcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTMgVEogSG9sb3dheWNodWtcbiAqIE1JVCBMaWNlbnNlZFxuICovXG5cbi8qKlxuICogTW9kdWxlIGV4cG9ydHMuXG4gKiBAcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBlc2NhcGVIdG1sO1xuXG4vKipcbiAqIEVzY2FwZSBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gdGhlIGdpdmVuIHN0cmluZyBvZiBodG1sLlxuICpcbiAqIEBwYXJhbSAge3N0cmluZ30gc3RyIFRoZSBzdHJpbmcgdG8gZXNjYXBlIGZvciBpbnNlcnRpbmcgaW50byBIVE1MXG4gKiBAcmV0dXJuIHtzdHJpbmd9XG4gKiBAcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZXNjYXBlSHRtbChodG1sKSB7XG4gIHJldHVybiBTdHJpbmcoaHRtbClcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpO1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vLyBIZWxwZXJzXG5cbi8vIE1lcmdlIG9iamVjdHNcbi8vXG5mdW5jdGlvbiBhc3NpZ24ob2JqIC8qZnJvbTEsIGZyb20yLCBmcm9tMywgLi4uKi8pIHtcbiAgdmFyIHNvdXJjZXMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuXG4gIHNvdXJjZXMuZm9yRWFjaChmdW5jdGlvbiAoc291cmNlKSB7XG4gICAgaWYgKCFzb3VyY2UpIHsgcmV0dXJuOyB9XG5cbiAgICBPYmplY3Qua2V5cyhzb3VyY2UpLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgb2JqW2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgcmV0dXJuIG9iajtcbn1cblxuZnVuY3Rpb24gX2NsYXNzKG9iaikgeyByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaik7IH1cbmZ1bmN0aW9uIGlzU3RyaW5nKG9iaikgeyByZXR1cm4gX2NsYXNzKG9iaikgPT09ICdbb2JqZWN0IFN0cmluZ10nOyB9XG5mdW5jdGlvbiBpc09iamVjdChvYmopIHsgcmV0dXJuIF9jbGFzcyhvYmopID09PSAnW29iamVjdCBPYmplY3RdJzsgfVxuZnVuY3Rpb24gaXNSZWdFeHAob2JqKSB7IHJldHVybiBfY2xhc3Mob2JqKSA9PT0gJ1tvYmplY3QgUmVnRXhwXSc7IH1cbmZ1bmN0aW9uIGlzRnVuY3Rpb24ob2JqKSB7IHJldHVybiBfY2xhc3Mob2JqKSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJzsgfVxuXG5cbmZ1bmN0aW9uIGVzY2FwZVJFIChzdHIpIHsgcmV0dXJuIHN0ci5yZXBsYWNlKC9bLj8qK14kW1xcXVxcXFwoKXt9fC1dL2csICdcXFxcJCYnKTsgfVxuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG5cbnZhciBkZWZhdWx0T3B0aW9ucyA9IHtcbiAgZnV6enlMaW5rOiB0cnVlLFxuICBmdXp6eUVtYWlsOiB0cnVlLFxuICBmdXp6eUlQOiBmYWxzZVxufTtcblxuXG5mdW5jdGlvbiBpc09wdGlvbnNPYmoob2JqKSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhvYmogfHwge30pLnJlZHVjZShmdW5jdGlvbiAoYWNjLCBrKSB7XG4gICAgcmV0dXJuIGFjYyB8fCBkZWZhdWx0T3B0aW9ucy5oYXNPd25Qcm9wZXJ0eShrKTtcbiAgfSwgZmFsc2UpO1xufVxuXG5cbnZhciBkZWZhdWx0U2NoZW1hcyA9IHtcbiAgJ2h0dHA6Jzoge1xuICAgIHZhbGlkYXRlOiBmdW5jdGlvbiAodGV4dCwgcG9zLCBzZWxmKSB7XG4gICAgICB2YXIgdGFpbCA9IHRleHQuc2xpY2UocG9zKTtcblxuICAgICAgaWYgKCFzZWxmLnJlLmh0dHApIHtcbiAgICAgICAgLy8gY29tcGlsZSBsYXppbHksIGJlY2F1c2UgXCJob3N0XCItY29udGFpbmluZyB2YXJpYWJsZXMgY2FuIGNoYW5nZSBvbiB0bGRzIHVwZGF0ZS5cbiAgICAgICAgc2VsZi5yZS5odHRwID0gIG5ldyBSZWdFeHAoXG4gICAgICAgICAgJ15cXFxcL1xcXFwvJyArIHNlbGYucmUuc3JjX2F1dGggKyBzZWxmLnJlLnNyY19ob3N0X3BvcnRfc3RyaWN0ICsgc2VsZi5yZS5zcmNfcGF0aCwgJ2knXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoc2VsZi5yZS5odHRwLnRlc3QodGFpbCkpIHtcbiAgICAgICAgcmV0dXJuIHRhaWwubWF0Y2goc2VsZi5yZS5odHRwKVswXS5sZW5ndGg7XG4gICAgICB9XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG4gIH0sXG4gICdodHRwczonOiAgJ2h0dHA6JyxcbiAgJ2Z0cDonOiAgICAnaHR0cDonLFxuICAnLy8nOiAgICAgIHtcbiAgICB2YWxpZGF0ZTogZnVuY3Rpb24gKHRleHQsIHBvcywgc2VsZikge1xuICAgICAgdmFyIHRhaWwgPSB0ZXh0LnNsaWNlKHBvcyk7XG5cbiAgICAgIGlmICghc2VsZi5yZS5ub19odHRwKSB7XG4gICAgICAvLyBjb21waWxlIGxhemlseSwgYmVjYXlzZSBcImhvc3RcIi1jb250YWluaW5nIHZhcmlhYmxlcyBjYW4gY2hhbmdlIG9uIHRsZHMgdXBkYXRlLlxuICAgICAgICBzZWxmLnJlLm5vX2h0dHAgPSAgbmV3IFJlZ0V4cChcbiAgICAgICAgICAnXicgKyBzZWxmLnJlLnNyY19hdXRoICsgc2VsZi5yZS5zcmNfaG9zdF9wb3J0X3N0cmljdCArIHNlbGYucmUuc3JjX3BhdGgsICdpJ1xuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAoc2VsZi5yZS5ub19odHRwLnRlc3QodGFpbCkpIHtcbiAgICAgICAgLy8gc2hvdWxkIG5vdCBiZSBgOi8vYCwgdGhhdCBwcm90ZWN0cyBmcm9tIGVycm9ycyBpbiBwcm90b2NvbCBuYW1lXG4gICAgICAgIGlmIChwb3MgPj0gMyAmJiB0ZXh0W3BvcyAtIDNdID09PSAnOicpIHsgcmV0dXJuIDA7IH1cbiAgICAgICAgcmV0dXJuIHRhaWwubWF0Y2goc2VsZi5yZS5ub19odHRwKVswXS5sZW5ndGg7XG4gICAgICB9XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG4gIH0sXG4gICdtYWlsdG86Jzoge1xuICAgIHZhbGlkYXRlOiBmdW5jdGlvbiAodGV4dCwgcG9zLCBzZWxmKSB7XG4gICAgICB2YXIgdGFpbCA9IHRleHQuc2xpY2UocG9zKTtcblxuICAgICAgaWYgKCFzZWxmLnJlLm1haWx0bykge1xuICAgICAgICBzZWxmLnJlLm1haWx0byA9ICBuZXcgUmVnRXhwKFxuICAgICAgICAgICdeJyArIHNlbGYucmUuc3JjX2VtYWlsX25hbWUgKyAnQCcgKyBzZWxmLnJlLnNyY19ob3N0X3N0cmljdCwgJ2knXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoc2VsZi5yZS5tYWlsdG8udGVzdCh0YWlsKSkge1xuICAgICAgICByZXR1cm4gdGFpbC5tYXRjaChzZWxmLnJlLm1haWx0bylbMF0ubGVuZ3RoO1xuICAgICAgfVxuICAgICAgcmV0dXJuIDA7XG4gICAgfVxuICB9XG59O1xuXG4vKmVzbGludC1kaXNhYmxlIG1heC1sZW4qL1xuXG4vLyBSRSBwYXR0ZXJuIGZvciAyLWNoYXJhY3RlciB0bGRzIChhdXRvZ2VuZXJhdGVkIGJ5IC4vc3VwcG9ydC90bGRzXzJjaGFyX2dlbi5qcylcbnZhciB0bGRzXzJjaF9zcmNfcmUgPSAnYVtjZGVmZ2lsbW5vcXJzdHV3eHpdfGJbYWJkZWZnaGlqbW5vcnN0dnd5el18Y1thY2RmZ2hpa2xtbm9ydXZ3eHl6XXxkW2Vqa21vel18ZVtjZWdyc3R1XXxmW2lqa21vcl18Z1thYmRlZmdoaWxtbnBxcnN0dXd5XXxoW2ttbnJ0dV18aVtkZWxtbm9xcnN0XXxqW2Vtb3BdfGtbZWdoaW1ucHJ3eXpdfGxbYWJjaWtyc3R1dnldfG1bYWNkZWdoa2xtbm9wcXJzdHV2d3h5el18blthY2VmZ2lsb3BydXpdfG9tfHBbYWVmZ2hrbG1ucnN0d3ldfHFhfHJbZW9zdXddfHNbYWJjZGVnaGlqa2xtbm9ydHV2eHl6XXx0W2NkZmdoamtsbW5vcnR2d3pdfHVbYWdrc3l6XXx2W2FjZWdpbnVdfHdbZnNdfHlbZXRdfHpbYW13XSc7XG5cbi8vIERPTidUIHRyeSB0byBtYWtlIFBScyB3aXRoIGNoYW5nZXMuIEV4dGVuZCBUTERzIHdpdGggTGlua2lmeUl0LnRsZHMoKSBpbnN0ZWFkXG52YXIgdGxkc19kZWZhdWx0ID0gJ2Jpenxjb218ZWR1fGdvdnxuZXR8b3JnfHByb3x3ZWJ8eHh4fGFlcm98YXNpYXxjb29wfGluZm98bXVzZXVtfG5hbWV8c2hvcHzRgNGEJy5zcGxpdCgnfCcpO1xuXG4vKmVzbGludC1lbmFibGUgbWF4LWxlbiovXG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbmZ1bmN0aW9uIHJlc2V0U2NhbkNhY2hlKHNlbGYpIHtcbiAgc2VsZi5fX2luZGV4X18gPSAtMTtcbiAgc2VsZi5fX3RleHRfY2FjaGVfXyAgID0gJyc7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVZhbGlkYXRvcihyZSkge1xuICByZXR1cm4gZnVuY3Rpb24gKHRleHQsIHBvcykge1xuICAgIHZhciB0YWlsID0gdGV4dC5zbGljZShwb3MpO1xuXG4gICAgaWYgKHJlLnRlc3QodGFpbCkpIHtcbiAgICAgIHJldHVybiB0YWlsLm1hdGNoKHJlKVswXS5sZW5ndGg7XG4gICAgfVxuICAgIHJldHVybiAwO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVOb3JtYWxpemVyKCkge1xuICByZXR1cm4gZnVuY3Rpb24gKG1hdGNoLCBzZWxmKSB7XG4gICAgc2VsZi5ub3JtYWxpemUobWF0Y2gpO1xuICB9O1xufVxuXG4vLyBTY2hlbWFzIGNvbXBpbGVyLiBCdWlsZCByZWdleHBzLlxuLy9cbmZ1bmN0aW9uIGNvbXBpbGUoc2VsZikge1xuXG4gIC8vIExvYWQgJiBjbG9uZSBSRSBwYXR0ZXJucy5cbiAgdmFyIHJlID0gc2VsZi5yZSA9IGFzc2lnbih7fSwgcmVxdWlyZSgnLi9saWIvcmUnKSk7XG5cbiAgLy8gRGVmaW5lIGR5bmFtaWMgcGF0dGVybnNcbiAgdmFyIHRsZHMgPSBzZWxmLl9fdGxkc19fLnNsaWNlKCk7XG5cbiAgaWYgKCFzZWxmLl9fdGxkc19yZXBsYWNlZF9fKSB7XG4gICAgdGxkcy5wdXNoKHRsZHNfMmNoX3NyY19yZSk7XG4gIH1cbiAgdGxkcy5wdXNoKHJlLnNyY194bik7XG5cbiAgcmUuc3JjX3RsZHMgPSB0bGRzLmpvaW4oJ3wnKTtcblxuICBmdW5jdGlvbiB1bnRwbCh0cGwpIHsgcmV0dXJuIHRwbC5yZXBsYWNlKCclVExEUyUnLCByZS5zcmNfdGxkcyk7IH1cblxuICByZS5lbWFpbF9mdXp6eSAgICAgID0gUmVnRXhwKHVudHBsKHJlLnRwbF9lbWFpbF9mdXp6eSksICdpJyk7XG4gIHJlLmxpbmtfZnV6enkgICAgICAgPSBSZWdFeHAodW50cGwocmUudHBsX2xpbmtfZnV6enkpLCAnaScpO1xuICByZS5saW5rX25vX2lwX2Z1enp5ID0gUmVnRXhwKHVudHBsKHJlLnRwbF9saW5rX25vX2lwX2Z1enp5KSwgJ2knKTtcbiAgcmUuaG9zdF9mdXp6eV90ZXN0ICA9IFJlZ0V4cCh1bnRwbChyZS50cGxfaG9zdF9mdXp6eV90ZXN0KSwgJ2knKTtcblxuICAvL1xuICAvLyBDb21waWxlIGVhY2ggc2NoZW1hXG4gIC8vXG5cbiAgdmFyIGFsaWFzZXMgPSBbXTtcblxuICBzZWxmLl9fY29tcGlsZWRfXyA9IHt9OyAvLyBSZXNldCBjb21waWxlZCBkYXRhXG5cbiAgZnVuY3Rpb24gc2NoZW1hRXJyb3IobmFtZSwgdmFsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCcoTGlua2lmeUl0KSBJbnZhbGlkIHNjaGVtYSBcIicgKyBuYW1lICsgJ1wiOiAnICsgdmFsKTtcbiAgfVxuXG4gIE9iamVjdC5rZXlzKHNlbGYuX19zY2hlbWFzX18pLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB2YXIgdmFsID0gc2VsZi5fX3NjaGVtYXNfX1tuYW1lXTtcblxuICAgIC8vIHNraXAgZGlzYWJsZWQgbWV0aG9kc1xuICAgIGlmICh2YWwgPT09IG51bGwpIHsgcmV0dXJuOyB9XG5cbiAgICB2YXIgY29tcGlsZWQgPSB7IHZhbGlkYXRlOiBudWxsLCBsaW5rOiBudWxsIH07XG5cbiAgICBzZWxmLl9fY29tcGlsZWRfX1tuYW1lXSA9IGNvbXBpbGVkO1xuXG4gICAgaWYgKGlzT2JqZWN0KHZhbCkpIHtcbiAgICAgIGlmIChpc1JlZ0V4cCh2YWwudmFsaWRhdGUpKSB7XG4gICAgICAgIGNvbXBpbGVkLnZhbGlkYXRlID0gY3JlYXRlVmFsaWRhdG9yKHZhbC52YWxpZGF0ZSk7XG4gICAgICB9IGVsc2UgaWYgKGlzRnVuY3Rpb24odmFsLnZhbGlkYXRlKSkge1xuICAgICAgICBjb21waWxlZC52YWxpZGF0ZSA9IHZhbC52YWxpZGF0ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNjaGVtYUVycm9yKG5hbWUsIHZhbCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc0Z1bmN0aW9uKHZhbC5ub3JtYWxpemUpKSB7XG4gICAgICAgIGNvbXBpbGVkLm5vcm1hbGl6ZSA9IHZhbC5ub3JtYWxpemU7XG4gICAgICB9IGVsc2UgaWYgKCF2YWwubm9ybWFsaXplKSB7XG4gICAgICAgIGNvbXBpbGVkLm5vcm1hbGl6ZSA9IGNyZWF0ZU5vcm1hbGl6ZXIoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNjaGVtYUVycm9yKG5hbWUsIHZhbCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoaXNTdHJpbmcodmFsKSkge1xuICAgICAgYWxpYXNlcy5wdXNoKG5hbWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHNjaGVtYUVycm9yKG5hbWUsIHZhbCk7XG4gIH0pO1xuXG4gIC8vXG4gIC8vIENvbXBpbGUgcG9zdHBvbmVkIGFsaWFzZXNcbiAgLy9cblxuICBhbGlhc2VzLmZvckVhY2goZnVuY3Rpb24gKGFsaWFzKSB7XG4gICAgaWYgKCFzZWxmLl9fY29tcGlsZWRfX1tzZWxmLl9fc2NoZW1hc19fW2FsaWFzXV0pIHtcbiAgICAgIC8vIFNpbGVudGx5IGZhaWwgb24gbWlzc2VkIHNjaGVtYXMgdG8gYXZvaWQgZXJyb25zIG9uIGRpc2FibGUuXG4gICAgICAvLyBzY2hlbWFFcnJvcihhbGlhcywgc2VsZi5fX3NjaGVtYXNfX1thbGlhc10pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHNlbGYuX19jb21waWxlZF9fW2FsaWFzXS52YWxpZGF0ZSA9XG4gICAgICBzZWxmLl9fY29tcGlsZWRfX1tzZWxmLl9fc2NoZW1hc19fW2FsaWFzXV0udmFsaWRhdGU7XG4gICAgc2VsZi5fX2NvbXBpbGVkX19bYWxpYXNdLm5vcm1hbGl6ZSA9XG4gICAgICBzZWxmLl9fY29tcGlsZWRfX1tzZWxmLl9fc2NoZW1hc19fW2FsaWFzXV0ubm9ybWFsaXplO1xuICB9KTtcblxuICAvL1xuICAvLyBGYWtlIHJlY29yZCBmb3IgZ3Vlc3NlZCBsaW5rc1xuICAvL1xuICBzZWxmLl9fY29tcGlsZWRfX1snJ10gPSB7IHZhbGlkYXRlOiBudWxsLCBub3JtYWxpemU6IGNyZWF0ZU5vcm1hbGl6ZXIoKSB9O1xuXG4gIC8vXG4gIC8vIEJ1aWxkIHNjaGVtYSBjb25kaXRpb25cbiAgLy9cbiAgdmFyIHNsaXN0ID0gT2JqZWN0LmtleXMoc2VsZi5fX2NvbXBpbGVkX18pXG4gICAgICAgICAgICAgICAgICAgICAgLmZpbHRlcihmdW5jdGlvbihuYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBGaWx0ZXIgZGlzYWJsZWQgJiBmYWtlIHNjaGVtYXNcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuYW1lLmxlbmd0aCA+IDAgJiYgc2VsZi5fX2NvbXBpbGVkX19bbmFtZV07XG4gICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAubWFwKGVzY2FwZVJFKVxuICAgICAgICAgICAgICAgICAgICAgIC5qb2luKCd8Jyk7XG4gIC8vICg/IV8pIGNhdXNlIDEuNXggc2xvd2Rvd25cbiAgc2VsZi5yZS5zY2hlbWFfdGVzdCAgID0gUmVnRXhwKCcoXnwoPyFfKSg/Oj58JyArIHJlLnNyY19aUENjICsgJykpKCcgKyBzbGlzdCArICcpJywgJ2knKTtcbiAgc2VsZi5yZS5zY2hlbWFfc2VhcmNoID0gUmVnRXhwKCcoXnwoPyFfKSg/Oj58JyArIHJlLnNyY19aUENjICsgJykpKCcgKyBzbGlzdCArICcpJywgJ2lnJyk7XG5cbiAgc2VsZi5yZS5wcmV0ZXN0ICAgICAgID0gUmVnRXhwKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICcoJyArIHNlbGYucmUuc2NoZW1hX3Rlc3Quc291cmNlICsgJyl8JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJygnICsgc2VsZi5yZS5ob3N0X2Z1enp5X3Rlc3Quc291cmNlICsgJyl8JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ0AnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdpJyk7XG5cbiAgLy9cbiAgLy8gQ2xlYW51cFxuICAvL1xuXG4gIHJlc2V0U2NhbkNhY2hlKHNlbGYpO1xufVxuXG4vKipcbiAqIGNsYXNzIE1hdGNoXG4gKlxuICogTWF0Y2ggcmVzdWx0LiBTaW5nbGUgZWxlbWVudCBvZiBhcnJheSwgcmV0dXJuZWQgYnkgW1tMaW5raWZ5SXQjbWF0Y2hdXVxuICoqL1xuZnVuY3Rpb24gTWF0Y2goc2VsZiwgc2hpZnQpIHtcbiAgdmFyIHN0YXJ0ID0gc2VsZi5fX2luZGV4X18sXG4gICAgICBlbmQgICA9IHNlbGYuX19sYXN0X2luZGV4X18sXG4gICAgICB0ZXh0ICA9IHNlbGYuX190ZXh0X2NhY2hlX18uc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgLyoqXG4gICAqIE1hdGNoI3NjaGVtYSAtPiBTdHJpbmdcbiAgICpcbiAgICogUHJlZml4IChwcm90b2NvbCkgZm9yIG1hdGNoZWQgc3RyaW5nLlxuICAgKiovXG4gIHRoaXMuc2NoZW1hICAgID0gc2VsZi5fX3NjaGVtYV9fLnRvTG93ZXJDYXNlKCk7XG4gIC8qKlxuICAgKiBNYXRjaCNpbmRleCAtPiBOdW1iZXJcbiAgICpcbiAgICogRmlyc3QgcG9zaXRpb24gb2YgbWF0Y2hlZCBzdHJpbmcuXG4gICAqKi9cbiAgdGhpcy5pbmRleCAgICAgPSBzdGFydCArIHNoaWZ0O1xuICAvKipcbiAgICogTWF0Y2gjbGFzdEluZGV4IC0+IE51bWJlclxuICAgKlxuICAgKiBOZXh0IHBvc2l0aW9uIGFmdGVyIG1hdGNoZWQgc3RyaW5nLlxuICAgKiovXG4gIHRoaXMubGFzdEluZGV4ID0gZW5kICsgc2hpZnQ7XG4gIC8qKlxuICAgKiBNYXRjaCNyYXcgLT4gU3RyaW5nXG4gICAqXG4gICAqIE1hdGNoZWQgc3RyaW5nLlxuICAgKiovXG4gIHRoaXMucmF3ICAgICAgID0gdGV4dDtcbiAgLyoqXG4gICAqIE1hdGNoI3RleHQgLT4gU3RyaW5nXG4gICAqXG4gICAqIE5vdG1hbGl6ZWQgdGV4dCBvZiBtYXRjaGVkIHN0cmluZy5cbiAgICoqL1xuICB0aGlzLnRleHQgICAgICA9IHRleHQ7XG4gIC8qKlxuICAgKiBNYXRjaCN1cmwgLT4gU3RyaW5nXG4gICAqXG4gICAqIE5vcm1hbGl6ZWQgdXJsIG9mIG1hdGNoZWQgc3RyaW5nLlxuICAgKiovXG4gIHRoaXMudXJsICAgICAgID0gdGV4dDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWF0Y2goc2VsZiwgc2hpZnQpIHtcbiAgdmFyIG1hdGNoID0gbmV3IE1hdGNoKHNlbGYsIHNoaWZ0KTtcblxuICBzZWxmLl9fY29tcGlsZWRfX1ttYXRjaC5zY2hlbWFdLm5vcm1hbGl6ZShtYXRjaCwgc2VsZik7XG5cbiAgcmV0dXJuIG1hdGNoO1xufVxuXG5cbi8qKlxuICogY2xhc3MgTGlua2lmeUl0XG4gKiovXG5cbi8qKlxuICogbmV3IExpbmtpZnlJdChzY2hlbWFzLCBvcHRpb25zKVxuICogLSBzY2hlbWFzIChPYmplY3QpOiBPcHRpb25hbC4gQWRkaXRpb25hbCBzY2hlbWFzIHRvIHZhbGlkYXRlIChwcmVmaXgvdmFsaWRhdG9yKVxuICogLSBvcHRpb25zIChPYmplY3QpOiB7IGZ1enp5TGlua3xmdXp6eUVtYWlsfGZ1enp5SVA6IHRydWV8ZmFsc2UgfVxuICpcbiAqIENyZWF0ZXMgbmV3IGxpbmtpZmllciBpbnN0YW5jZSB3aXRoIG9wdGlvbmFsIGFkZGl0aW9uYWwgc2NoZW1hcy5cbiAqIENhbiBiZSBjYWxsZWQgd2l0aG91dCBgbmV3YCBrZXl3b3JkIGZvciBjb252ZW5pZW5jZS5cbiAqXG4gKiBCeSBkZWZhdWx0IHVuZGVyc3RhbmRzOlxuICpcbiAqIC0gYGh0dHAocyk6Ly8uLi5gICwgYGZ0cDovLy4uLmAsIGBtYWlsdG86Li4uYCAmIGAvLy4uLmAgbGlua3NcbiAqIC0gXCJmdXp6eVwiIGxpbmtzIGFuZCBlbWFpbHMgKGV4YW1wbGUuY29tLCBmb29AYmFyLmNvbSkuXG4gKlxuICogYHNjaGVtYXNgIGlzIGFuIG9iamVjdCwgd2hlcmUgZWFjaCBrZXkvdmFsdWUgZGVzY3JpYmVzIHByb3RvY29sL3J1bGU6XG4gKlxuICogLSBfX2tleV9fIC0gbGluayBwcmVmaXggKHVzdWFsbHksIHByb3RvY29sIG5hbWUgd2l0aCBgOmAgYXQgdGhlIGVuZCwgYHNreXBlOmBcbiAqICAgZm9yIGV4YW1wbGUpLiBgbGlua2lmeS1pdGAgbWFrZXMgc2h1cmUgdGhhdCBwcmVmaXggaXMgbm90IHByZWNlZWRlZCB3aXRoXG4gKiAgIGFscGhhbnVtZXJpYyBjaGFyIGFuZCBzeW1ib2xzLiBPbmx5IHdoaXRlc3BhY2VzIGFuZCBwdW5jdHVhdGlvbiBhbGxvd2VkLlxuICogLSBfX3ZhbHVlX18gLSBydWxlIHRvIGNoZWNrIHRhaWwgYWZ0ZXIgbGluayBwcmVmaXhcbiAqICAgLSBfU3RyaW5nXyAtIGp1c3QgYWxpYXMgdG8gZXhpc3RpbmcgcnVsZVxuICogICAtIF9PYmplY3RfXG4gKiAgICAgLSBfdmFsaWRhdGVfIC0gdmFsaWRhdG9yIGZ1bmN0aW9uIChzaG91bGQgcmV0dXJuIG1hdGNoZWQgbGVuZ3RoIG9uIHN1Y2Nlc3MpLFxuICogICAgICAgb3IgYFJlZ0V4cGAuXG4gKiAgICAgLSBfbm9ybWFsaXplXyAtIG9wdGlvbmFsIGZ1bmN0aW9uIHRvIG5vcm1hbGl6ZSB0ZXh0ICYgdXJsIG9mIG1hdGNoZWQgcmVzdWx0XG4gKiAgICAgICAoZm9yIGV4YW1wbGUsIGZvciBAdHdpdHRlciBtZW50aW9ucykuXG4gKlxuICogYG9wdGlvbnNgOlxuICpcbiAqIC0gX19mdXp6eUxpbmtfXyAtIHJlY29nbmlnZSBVUkwtcyB3aXRob3V0IGBodHRwKHMpOmAgcHJlZml4LiBEZWZhdWx0IGB0cnVlYC5cbiAqIC0gX19mdXp6eUlQX18gLSBhbGxvdyBJUHMgaW4gZnV6enkgbGlua3MgYWJvdmUuIENhbiBjb25mbGljdCB3aXRoIHNvbWUgdGV4dHNcbiAqICAgbGlrZSB2ZXJzaW9uIG51bWJlcnMuIERlZmF1bHQgYGZhbHNlYC5cbiAqIC0gX19mdXp6eUVtYWlsX18gLSByZWNvZ25pemUgZW1haWxzIHdpdGhvdXQgYG1haWx0bzpgIHByZWZpeC5cbiAqXG4gKiovXG5mdW5jdGlvbiBMaW5raWZ5SXQoc2NoZW1hcywgb3B0aW9ucykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgTGlua2lmeUl0KSkge1xuICAgIHJldHVybiBuZXcgTGlua2lmeUl0KHNjaGVtYXMsIG9wdGlvbnMpO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zKSB7XG4gICAgaWYgKGlzT3B0aW9uc09iaihzY2hlbWFzKSkge1xuICAgICAgb3B0aW9ucyA9IHNjaGVtYXM7XG4gICAgICBzY2hlbWFzID0ge307XG4gICAgfVxuICB9XG5cbiAgdGhpcy5fX29wdHNfXyAgICAgICAgICAgPSBhc3NpZ24oe30sIGRlZmF1bHRPcHRpb25zLCBvcHRpb25zKTtcblxuICAvLyBDYWNoZSBsYXN0IHRlc3RlZCByZXN1bHQuIFVzZWQgdG8gc2tpcCByZXBlYXRpbmcgc3RlcHMgb24gbmV4dCBgbWF0Y2hgIGNhbGwuXG4gIHRoaXMuX19pbmRleF9fICAgICAgICAgID0gLTE7XG4gIHRoaXMuX19sYXN0X2luZGV4X18gICAgID0gLTE7IC8vIE5leHQgc2NhbiBwb3NpdGlvblxuICB0aGlzLl9fc2NoZW1hX18gICAgICAgICA9ICcnO1xuICB0aGlzLl9fdGV4dF9jYWNoZV9fICAgICA9ICcnO1xuXG4gIHRoaXMuX19zY2hlbWFzX18gICAgICAgID0gYXNzaWduKHt9LCBkZWZhdWx0U2NoZW1hcywgc2NoZW1hcyk7XG4gIHRoaXMuX19jb21waWxlZF9fICAgICAgID0ge307XG5cbiAgdGhpcy5fX3RsZHNfXyAgICAgICAgICAgPSB0bGRzX2RlZmF1bHQ7XG4gIHRoaXMuX190bGRzX3JlcGxhY2VkX18gID0gZmFsc2U7XG5cbiAgdGhpcy5yZSA9IHt9O1xuXG4gIGNvbXBpbGUodGhpcyk7XG59XG5cblxuLyoqIGNoYWluYWJsZVxuICogTGlua2lmeUl0I2FkZChzY2hlbWEsIGRlZmluaXRpb24pXG4gKiAtIHNjaGVtYSAoU3RyaW5nKTogcnVsZSBuYW1lIChmaXhlZCBwYXR0ZXJuIHByZWZpeClcbiAqIC0gZGVmaW5pdGlvbiAoU3RyaW5nfFJlZ0V4cHxPYmplY3QpOiBzY2hlbWEgZGVmaW5pdGlvblxuICpcbiAqIEFkZCBuZXcgcnVsZSBkZWZpbml0aW9uLiBTZWUgY29uc3RydWN0b3IgZGVzY3JpcHRpb24gZm9yIGRldGFpbHMuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZChzY2hlbWEsIGRlZmluaXRpb24pIHtcbiAgdGhpcy5fX3NjaGVtYXNfX1tzY2hlbWFdID0gZGVmaW5pdGlvbjtcbiAgY29tcGlsZSh0aGlzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5cbi8qKiBjaGFpbmFibGVcbiAqIExpbmtpZnlJdCNzZXQob3B0aW9ucylcbiAqIC0gb3B0aW9ucyAoT2JqZWN0KTogeyBmdXp6eUxpbmt8ZnV6enlFbWFpbHxmdXp6eUlQOiB0cnVlfGZhbHNlIH1cbiAqXG4gKiBTZXQgcmVjb2duaXRpb24gb3B0aW9ucyBmb3IgbGlua3Mgd2l0aG91dCBzY2hlbWEuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldChvcHRpb25zKSB7XG4gIHRoaXMuX19vcHRzX18gPSBhc3NpZ24odGhpcy5fX29wdHNfXywgb3B0aW9ucyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuXG4vKipcbiAqIExpbmtpZnlJdCN0ZXN0KHRleHQpIC0+IEJvb2xlYW5cbiAqXG4gKiBTZWFyY2hlcyBsaW5raWZpYWJsZSBwYXR0ZXJuIGFuZCByZXR1cm5zIGB0cnVlYCBvbiBzdWNjZXNzIG9yIGBmYWxzZWAgb24gZmFpbC5cbiAqKi9cbkxpbmtpZnlJdC5wcm90b3R5cGUudGVzdCA9IGZ1bmN0aW9uIHRlc3QodGV4dCkge1xuICAvLyBSZXNldCBzY2FuIGNhY2hlXG4gIHRoaXMuX190ZXh0X2NhY2hlX18gPSB0ZXh0O1xuICB0aGlzLl9faW5kZXhfXyAgICAgID0gLTE7XG5cbiAgaWYgKCF0ZXh0Lmxlbmd0aCkgeyByZXR1cm4gZmFsc2U7IH1cblxuICB2YXIgbSwgbWwsIG1lLCBsZW4sIHNoaWZ0LCBuZXh0LCByZSwgdGxkX3BvcywgYXRfcG9zO1xuXG4gIC8vIHRyeSB0byBzY2FuIGZvciBsaW5rIHdpdGggc2NoZW1hIC0gdGhhdCdzIHRoZSBtb3N0IHNpbXBsZSBydWxlXG4gIGlmICh0aGlzLnJlLnNjaGVtYV90ZXN0LnRlc3QodGV4dCkpIHtcbiAgICByZSA9IHRoaXMucmUuc2NoZW1hX3NlYXJjaDtcbiAgICByZS5sYXN0SW5kZXggPSAwO1xuICAgIHdoaWxlICgobSA9IHJlLmV4ZWModGV4dCkpICE9PSBudWxsKSB7XG4gICAgICBsZW4gPSB0aGlzLnRlc3RTY2hlbWFBdCh0ZXh0LCBtWzJdLCByZS5sYXN0SW5kZXgpO1xuICAgICAgaWYgKGxlbikge1xuICAgICAgICB0aGlzLl9fc2NoZW1hX18gICAgID0gbVsyXTtcbiAgICAgICAgdGhpcy5fX2luZGV4X18gICAgICA9IG0uaW5kZXggKyBtWzFdLmxlbmd0aDtcbiAgICAgICAgdGhpcy5fX2xhc3RfaW5kZXhfXyA9IG0uaW5kZXggKyBtWzBdLmxlbmd0aCArIGxlbjtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKHRoaXMuX19vcHRzX18uZnV6enlMaW5rICYmIHRoaXMuX19jb21waWxlZF9fWydodHRwOiddKSB7XG4gICAgLy8gZ3Vlc3Mgc2NoZW1hbGVzcyBsaW5rc1xuICAgIHRsZF9wb3MgPSB0ZXh0LnNlYXJjaCh0aGlzLnJlLmhvc3RfZnV6enlfdGVzdCk7XG4gICAgaWYgKHRsZF9wb3MgPj0gMCkge1xuICAgICAgLy8gaWYgdGxkIGlzIGxvY2F0ZWQgYWZ0ZXIgZm91bmQgbGluayAtIG5vIG5lZWQgdG8gY2hlY2sgZnV6enkgcGF0dGVyblxuICAgICAgaWYgKHRoaXMuX19pbmRleF9fIDwgMCB8fCB0bGRfcG9zIDwgdGhpcy5fX2luZGV4X18pIHtcbiAgICAgICAgaWYgKChtbCA9IHRleHQubWF0Y2godGhpcy5fX29wdHNfXy5mdXp6eUlQID8gdGhpcy5yZS5saW5rX2Z1enp5IDogdGhpcy5yZS5saW5rX25vX2lwX2Z1enp5KSkgIT09IG51bGwpIHtcblxuICAgICAgICAgIHNoaWZ0ID0gbWwuaW5kZXggKyBtbFsxXS5sZW5ndGg7XG5cbiAgICAgICAgICBpZiAodGhpcy5fX2luZGV4X18gPCAwIHx8IHNoaWZ0IDwgdGhpcy5fX2luZGV4X18pIHtcbiAgICAgICAgICAgIHRoaXMuX19zY2hlbWFfXyAgICAgPSAnJztcbiAgICAgICAgICAgIHRoaXMuX19pbmRleF9fICAgICAgPSBzaGlmdDtcbiAgICAgICAgICAgIHRoaXMuX19sYXN0X2luZGV4X18gPSBtbC5pbmRleCArIG1sWzBdLmxlbmd0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAodGhpcy5fX29wdHNfXy5mdXp6eUVtYWlsICYmIHRoaXMuX19jb21waWxlZF9fWydtYWlsdG86J10pIHtcbiAgICAvLyBndWVzcyBzY2hlbWFsZXNzIGVtYWlsc1xuICAgIGF0X3BvcyA9IHRleHQuaW5kZXhPZignQCcpO1xuICAgIGlmIChhdF9wb3MgPj0gMCkge1xuICAgICAgLy8gV2UgY2FuJ3Qgc2tpcCB0aGlzIGNoZWNrLCBiZWNhdXNlIHRoaXMgY2FzZXMgYXJlIHBvc3NpYmxlOlxuICAgICAgLy8gMTkyLjE2OC4xLjFAZ21haWwuY29tLCBteS5pbkBleGFtcGxlLmNvbVxuICAgICAgaWYgKChtZSA9IHRleHQubWF0Y2godGhpcy5yZS5lbWFpbF9mdXp6eSkpICE9PSBudWxsKSB7XG5cbiAgICAgICAgc2hpZnQgPSBtZS5pbmRleCArIG1lWzFdLmxlbmd0aDtcbiAgICAgICAgbmV4dCAgPSBtZS5pbmRleCArIG1lWzBdLmxlbmd0aDtcblxuICAgICAgICBpZiAodGhpcy5fX2luZGV4X18gPCAwIHx8IHNoaWZ0IDwgdGhpcy5fX2luZGV4X18gfHxcbiAgICAgICAgICAgIChzaGlmdCA9PT0gdGhpcy5fX2luZGV4X18gJiYgbmV4dCA+IHRoaXMuX19sYXN0X2luZGV4X18pKSB7XG4gICAgICAgICAgdGhpcy5fX3NjaGVtYV9fICAgICA9ICdtYWlsdG86JztcbiAgICAgICAgICB0aGlzLl9faW5kZXhfXyAgICAgID0gc2hpZnQ7XG4gICAgICAgICAgdGhpcy5fX2xhc3RfaW5kZXhfXyA9IG5leHQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcy5fX2luZGV4X18gPj0gMDtcbn07XG5cblxuLyoqXG4gKiBMaW5raWZ5SXQjcHJldGVzdCh0ZXh0KSAtPiBCb29sZWFuXG4gKlxuICogVmVyeSBxdWljayBjaGVjaywgdGhhdCBjYW4gZ2l2ZSBmYWxzZSBwb3NpdGl2ZXMuIFJldHVybnMgdHJ1ZSBpZiBsaW5rIE1BWSBCRVxuICogY2FuIGV4aXN0cy4gQ2FuIGJlIHVzZWQgZm9yIHNwZWVkIG9wdGltaXphdGlvbiwgd2hlbiB5b3UgbmVlZCB0byBjaGVjayB0aGF0XG4gKiBsaW5rIE5PVCBleGlzdHMuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLnByZXRlc3QgPSBmdW5jdGlvbiBwcmV0ZXN0KHRleHQpIHtcbiAgcmV0dXJuIHRoaXMucmUucHJldGVzdC50ZXN0KHRleHQpO1xufTtcblxuXG4vKipcbiAqIExpbmtpZnlJdCN0ZXN0U2NoZW1hQXQodGV4dCwgbmFtZSwgcG9zaXRpb24pIC0+IE51bWJlclxuICogLSB0ZXh0IChTdHJpbmcpOiB0ZXh0IHRvIHNjYW5cbiAqIC0gbmFtZSAoU3RyaW5nKTogcnVsZSAoc2NoZW1hKSBuYW1lXG4gKiAtIHBvc2l0aW9uIChOdW1iZXIpOiB0ZXh0IG9mZnNldCB0byBjaGVjayBmcm9tXG4gKlxuICogU2ltaWxhciB0byBbW0xpbmtpZnlJdCN0ZXN0XV0gYnV0IGNoZWNrcyBvbmx5IHNwZWNpZmljIHByb3RvY29sIHRhaWwgZXhhY3RseVxuICogYXQgZ2l2ZW4gcG9zaXRpb24uIFJldHVybnMgbGVuZ3RoIG9mIGZvdW5kIHBhdHRlcm4gKDAgb24gZmFpbCkuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLnRlc3RTY2hlbWFBdCA9IGZ1bmN0aW9uIHRlc3RTY2hlbWFBdCh0ZXh0LCBzY2hlbWEsIHBvcykge1xuICAvLyBJZiBub3Qgc3VwcG9ydGVkIHNjaGVtYSBjaGVjayByZXF1ZXN0ZWQgLSB0ZXJtaW5hdGVcbiAgaWYgKCF0aGlzLl9fY29tcGlsZWRfX1tzY2hlbWEudG9Mb3dlckNhc2UoKV0pIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuICByZXR1cm4gdGhpcy5fX2NvbXBpbGVkX19bc2NoZW1hLnRvTG93ZXJDYXNlKCldLnZhbGlkYXRlKHRleHQsIHBvcywgdGhpcyk7XG59O1xuXG5cbi8qKlxuICogTGlua2lmeUl0I21hdGNoKHRleHQpIC0+IEFycmF5fG51bGxcbiAqXG4gKiBSZXR1cm5zIGFycmF5IG9mIGZvdW5kIGxpbmsgZGVzY3JpcHRpb25zIG9yIGBudWxsYCBvbiBmYWlsLiBXZSBzdHJvbmdseVxuICogdG8gdXNlIFtbTGlua2lmeUl0I3Rlc3RdXSBmaXJzdCwgZm9yIGJlc3Qgc3BlZWQuXG4gKlxuICogIyMjIyMgUmVzdWx0IG1hdGNoIGRlc2NyaXB0aW9uXG4gKlxuICogLSBfX3NjaGVtYV9fIC0gbGluayBzY2hlbWEsIGNhbiBiZSBlbXB0eSBmb3IgZnV6enkgbGlua3MsIG9yIGAvL2AgZm9yXG4gKiAgIHByb3RvY29sLW5ldXRyYWwgIGxpbmtzLlxuICogLSBfX2luZGV4X18gLSBvZmZzZXQgb2YgbWF0Y2hlZCB0ZXh0XG4gKiAtIF9fbGFzdEluZGV4X18gLSBpbmRleCBvZiBuZXh0IGNoYXIgYWZ0ZXIgbWF0aGNoIGVuZFxuICogLSBfX3Jhd19fIC0gbWF0Y2hlZCB0ZXh0XG4gKiAtIF9fdGV4dF9fIC0gbm9ybWFsaXplZCB0ZXh0XG4gKiAtIF9fdXJsX18gLSBsaW5rLCBnZW5lcmF0ZWQgZnJvbSBtYXRjaGVkIHRleHRcbiAqKi9cbkxpbmtpZnlJdC5wcm90b3R5cGUubWF0Y2ggPSBmdW5jdGlvbiBtYXRjaCh0ZXh0KSB7XG4gIHZhciBzaGlmdCA9IDAsIHJlc3VsdCA9IFtdO1xuXG4gIC8vIFRyeSB0byB0YWtlIHByZXZpb3VzIGVsZW1lbnQgZnJvbSBjYWNoZSwgaWYgLnRlc3QoKSBjYWxsZWQgYmVmb3JlXG4gIGlmICh0aGlzLl9faW5kZXhfXyA+PSAwICYmIHRoaXMuX190ZXh0X2NhY2hlX18gPT09IHRleHQpIHtcbiAgICByZXN1bHQucHVzaChjcmVhdGVNYXRjaCh0aGlzLCBzaGlmdCkpO1xuICAgIHNoaWZ0ID0gdGhpcy5fX2xhc3RfaW5kZXhfXztcbiAgfVxuXG4gIC8vIEN1dCBoZWFkIGlmIGNhY2hlIHdhcyB1c2VkXG4gIHZhciB0YWlsID0gc2hpZnQgPyB0ZXh0LnNsaWNlKHNoaWZ0KSA6IHRleHQ7XG5cbiAgLy8gU2NhbiBzdHJpbmcgdW50aWwgZW5kIHJlYWNoZWRcbiAgd2hpbGUgKHRoaXMudGVzdCh0YWlsKSkge1xuICAgIHJlc3VsdC5wdXNoKGNyZWF0ZU1hdGNoKHRoaXMsIHNoaWZ0KSk7XG5cbiAgICB0YWlsID0gdGFpbC5zbGljZSh0aGlzLl9fbGFzdF9pbmRleF9fKTtcbiAgICBzaGlmdCArPSB0aGlzLl9fbGFzdF9pbmRleF9fO1xuICB9XG5cbiAgaWYgKHJlc3VsdC5sZW5ndGgpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59O1xuXG5cbi8qKiBjaGFpbmFibGVcbiAqIExpbmtpZnlJdCN0bGRzKGxpc3QgWywga2VlcE9sZF0pIC0+IHRoaXNcbiAqIC0gbGlzdCAoQXJyYXkpOiBsaXN0IG9mIHRsZHNcbiAqIC0ga2VlcE9sZCAoQm9vbGVhbik6IG1lcmdlIHdpdGggY3VycmVudCBsaXN0IGlmIGB0cnVlYCAoYGZhbHNlYCBieSBkZWZhdWx0KVxuICpcbiAqIExvYWQgKG9yIG1lcmdlKSBuZXcgdGxkcyBsaXN0LiBUaG9zZSBhcmUgdXNlciBmb3IgZnV6enkgbGlua3MgKHdpdGhvdXQgcHJlZml4KVxuICogdG8gYXZvaWQgZmFsc2UgcG9zaXRpdmVzLiBCeSBkZWZhdWx0IHRoaXMgYWxnb3J5dGhtIHVzZWQ6XG4gKlxuICogLSBob3N0bmFtZSB3aXRoIGFueSAyLWxldHRlciByb290IHpvbmVzIGFyZSBvay5cbiAqIC0gYml6fGNvbXxlZHV8Z292fG5ldHxvcmd8cHJvfHdlYnx4eHh8YWVyb3xhc2lhfGNvb3B8aW5mb3xtdXNldW18bmFtZXxzaG9wfNGA0YRcbiAqICAgYXJlIG9rLlxuICogLSBlbmNvZGVkIChgeG4tLS4uLmApIHJvb3Qgem9uZXMgYXJlIG9rLlxuICpcbiAqIElmIGxpc3QgaXMgcmVwbGFjZWQsIHRoZW4gZXhhY3QgbWF0Y2ggZm9yIDItY2hhcnMgcm9vdCB6b25lcyB3aWxsIGJlIGNoZWNrZWQuXG4gKiovXG5MaW5raWZ5SXQucHJvdG90eXBlLnRsZHMgPSBmdW5jdGlvbiB0bGRzKGxpc3QsIGtlZXBPbGQpIHtcbiAgbGlzdCA9IEFycmF5LmlzQXJyYXkobGlzdCkgPyBsaXN0IDogWyBsaXN0IF07XG5cbiAgaWYgKCFrZWVwT2xkKSB7XG4gICAgdGhpcy5fX3RsZHNfXyA9IGxpc3Quc2xpY2UoKTtcbiAgICB0aGlzLl9fdGxkc19yZXBsYWNlZF9fID0gdHJ1ZTtcbiAgICBjb21waWxlKHRoaXMpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgdGhpcy5fX3RsZHNfXyA9IHRoaXMuX190bGRzX18uY29uY2F0KGxpc3QpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnNvcnQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoZnVuY3Rpb24oZWwsIGlkeCwgYXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZWwgIT09IGFycltpZHggLSAxXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXZlcnNlKCk7XG5cbiAgY29tcGlsZSh0aGlzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIExpbmtpZnlJdCNub3JtYWxpemUobWF0Y2gpXG4gKlxuICogRGVmYXVsdCBub3JtYWxpemVyIChpZiBzY2hlbWEgZG9lcyBub3QgZGVmaW5lIGl0J3Mgb3duKS5cbiAqKi9cbkxpbmtpZnlJdC5wcm90b3R5cGUubm9ybWFsaXplID0gZnVuY3Rpb24gbm9ybWFsaXplKG1hdGNoKSB7XG5cbiAgLy8gRG8gbWluaW1hbCBwb3NzaWJsZSBjaGFuZ2VzIGJ5IGRlZmF1bHQuIE5lZWQgdG8gY29sbGVjdCBmZWVkYmFjayBwcmlvclxuICAvLyB0byBtb3ZlIGZvcndhcmQgaHR0cHM6Ly9naXRodWIuY29tL21hcmtkb3duLWl0L2xpbmtpZnktaXQvaXNzdWVzLzFcblxuICBpZiAoIW1hdGNoLnNjaGVtYSkgeyBtYXRjaC51cmwgPSAnaHR0cDovLycgKyBtYXRjaC51cmw7IH1cblxuICBpZiAobWF0Y2guc2NoZW1hID09PSAnbWFpbHRvOicgJiYgIS9ebWFpbHRvOi9pLnRlc3QobWF0Y2gudXJsKSkge1xuICAgIG1hdGNoLnVybCA9ICdtYWlsdG86JyArIG1hdGNoLnVybDtcbiAgfVxufTtcblxuXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtpZnlJdDtcbiIsIid1c2Ugc3RyaWN0JztcblxuLy8gVXNlIGRpcmVjdCBleHRyYWN0IGluc3RlYWQgb2YgYHJlZ2VuZXJhdGVgIHRvIHJlZHVzZSBicm93c2VyaWZpZWQgc2l6ZVxudmFyIHNyY19BbnkgPSBleHBvcnRzLnNyY19BbnkgPSByZXF1aXJlKCd1Yy5taWNyby9wcm9wZXJ0aWVzL0FueS9yZWdleCcpLnNvdXJjZTtcbnZhciBzcmNfQ2MgID0gZXhwb3J0cy5zcmNfQ2MgPSByZXF1aXJlKCd1Yy5taWNyby9jYXRlZ29yaWVzL0NjL3JlZ2V4Jykuc291cmNlO1xudmFyIHNyY19aICAgPSBleHBvcnRzLnNyY19aICA9IHJlcXVpcmUoJ3VjLm1pY3JvL2NhdGVnb3JpZXMvWi9yZWdleCcpLnNvdXJjZTtcbnZhciBzcmNfUCAgID0gZXhwb3J0cy5zcmNfUCAgPSByZXF1aXJlKCd1Yy5taWNyby9jYXRlZ29yaWVzL1AvcmVnZXgnKS5zb3VyY2U7XG5cbi8vIFxccHtcXFpcXFBcXENjXFxDRn0gKHdoaXRlIHNwYWNlcyArIGNvbnRyb2wgKyBmb3JtYXQgKyBwdW5jdHVhdGlvbilcbnZhciBzcmNfWlBDYyA9IGV4cG9ydHMuc3JjX1pQQ2MgPSBbIHNyY19aLCBzcmNfUCwgc3JjX0NjIF0uam9pbignfCcpO1xuXG4vLyBcXHB7XFxaXFxDY30gKHdoaXRlIHNwYWNlcyArIGNvbnRyb2wpXG52YXIgc3JjX1pDYyA9IGV4cG9ydHMuc3JjX1pDYyA9IFsgc3JjX1osIHNyY19DYyBdLmpvaW4oJ3wnKTtcblxuLy8gQWxsIHBvc3NpYmxlIHdvcmQgY2hhcmFjdGVycyAoZXZlcnl0aGluZyB3aXRob3V0IHB1bmN0dWF0aW9uLCBzcGFjZXMgJiBjb250cm9scylcbi8vIERlZmluZWQgdmlhIHB1bmN0dWF0aW9uICYgc3BhY2VzIHRvIHNhdmUgc3BhY2Vcbi8vIFNob3VsZCBiZSBzb21ldGhpbmcgbGlrZSBcXHB7XFxMXFxOXFxTXFxNfSAoXFx3IGJ1dCB3aXRob3V0IGBfYClcbnZhciBzcmNfcHNldWRvX2xldHRlciAgICAgICA9ICcoPzooPyEnICsgc3JjX1pQQ2MgKyAnKScgKyBzcmNfQW55ICsgJyknO1xuLy8gVGhlIHNhbWUgYXMgYWJvdGhlIGJ1dCB3aXRob3V0IFswLTldXG52YXIgc3JjX3BzZXVkb19sZXR0ZXJfbm9uX2QgPSAnKD86KD8hWzAtOV18JyArIHNyY19aUENjICsgJyknICsgc3JjX0FueSArICcpJztcblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxudmFyIHNyY19pcDQgPSBleHBvcnRzLnNyY19pcDQgPVxuXG4gICcoPzooMjVbMC01XXwyWzAtNF1bMC05XXxbMDFdP1swLTldWzAtOV0/KVxcXFwuKXszfSgyNVswLTVdfDJbMC00XVswLTldfFswMV0/WzAtOV1bMC05XT8pJztcblxuZXhwb3J0cy5zcmNfYXV0aCAgICA9ICcoPzooPzooPyEnICsgc3JjX1pDYyArICcpLikrQCk/JztcblxudmFyIHNyY19wb3J0ID0gZXhwb3J0cy5zcmNfcG9ydCA9XG5cbiAgJyg/OjooPzo2KD86WzAtNF1cXFxcZHszfXw1KD86WzAtNF1cXFxcZHsyfXw1KD86WzAtMl1cXFxcZHwzWzAtNV0pKSl8WzEtNV0/XFxcXGR7MSw0fSkpPyc7XG5cbnZhciBzcmNfaG9zdF90ZXJtaW5hdG9yID0gZXhwb3J0cy5zcmNfaG9zdF90ZXJtaW5hdG9yID1cblxuICAnKD89JHwnICsgc3JjX1pQQ2MgKyAnKSg/IS18X3w6XFxcXGR8XFxcXC4tfFxcXFwuKD8hJHwnICsgc3JjX1pQQ2MgKyAnKSknO1xuXG52YXIgc3JjX3BhdGggPSBleHBvcnRzLnNyY19wYXRoID1cblxuICAnKD86JyArXG4gICAgJ1svPyNdJyArXG4gICAgICAnKD86JyArXG4gICAgICAgICcoPyEnICsgc3JjX1pDYyArICd8WygpW1xcXFxde30uLFwiXFwnPyFcXFxcLV0pLnwnICtcbiAgICAgICAgJ1xcXFxbKD86KD8hJyArIHNyY19aQ2MgKyAnfFxcXFxdKS4pKlxcXFxdfCcgK1xuICAgICAgICAnXFxcXCgoPzooPyEnICsgc3JjX1pDYyArICd8WyldKS4pKlxcXFwpfCcgK1xuICAgICAgICAnXFxcXHsoPzooPyEnICsgc3JjX1pDYyArICd8W31dKS4pKlxcXFx9fCcgK1xuICAgICAgICAnXFxcXFwiKD86KD8hJyArIHNyY19aQ2MgKyAnfFtcIl0pLikrXFxcXFwifCcgK1xuICAgICAgICBcIlxcXFwnKD86KD8hXCIgKyBzcmNfWkNjICsgXCJ8WyddKS4pK1xcXFwnfFwiICtcbiAgICAgICAgXCJcXFxcJyg/PVwiICsgc3JjX3BzZXVkb19sZXR0ZXIgKyAnKS58JyArICAvLyBhbGxvdyBgSSdtX2tpbmdgIGlmIG5vIHBhaXIgZm91bmRcbiAgICAgICAgJ1xcXFwuezIsM31bYS16QS1aMC05JS9dfCcgKyAvLyBnaXRodWIgaGFzIC4uLiBpbiBjb21taXQgcmFuZ2UgbGlua3MuIFJlc3RyaWN0IHRvXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIC0gZW5nbGlzaFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAtIHBlcmNlbnQtZW5jb2RlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyAtIHBhcnRzIG9mIGZpbGUgcGF0aFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB1bnRpbCBtb3JlIGV4YW1wbGVzIGZvdW5kLlxuICAgICAgICAnXFxcXC4oPyEnICsgc3JjX1pDYyArICd8Wy5dKS58JyArXG4gICAgICAgICdcXFxcLSg/IS0tKD86W14tXXwkKSkoPzotKil8JyArICAvLyBgLS0tYCA9PiBsb25nIGRhc2gsIHRlcm1pbmF0ZVxuICAgICAgICAnXFxcXCwoPyEnICsgc3JjX1pDYyArICcpLnwnICsgICAgICAvLyBhbGxvdyBgLCwsYCBpbiBwYXRoc1xuICAgICAgICAnXFxcXCEoPyEnICsgc3JjX1pDYyArICd8WyFdKS58JyArXG4gICAgICAgICdcXFxcPyg/IScgKyBzcmNfWkNjICsgJ3xbP10pLicgK1xuICAgICAgJykrJyArXG4gICAgJ3xcXFxcLycgK1xuICAnKT8nO1xuXG52YXIgc3JjX2VtYWlsX25hbWUgPSBleHBvcnRzLnNyY19lbWFpbF9uYW1lID1cblxuICAnW1xcXFwtOzomPVxcXFwrXFxcXCQsXFxcXFwiXFxcXC5hLXpBLVowLTlfXSsnO1xuXG52YXIgc3JjX3huID0gZXhwb3J0cy5zcmNfeG4gPVxuXG4gICd4bi0tW2EtejAtOVxcXFwtXXsxLDU5fSc7XG5cbi8vIE1vcmUgdG8gcmVhZCBhYm91dCBkb21haW4gbmFtZXNcbi8vIGh0dHA6Ly9zZXJ2ZXJmYXVsdC5jb20vcXVlc3Rpb25zLzYzODI2MC9cblxudmFyIHNyY19kb21haW5fcm9vdCA9IGV4cG9ydHMuc3JjX2RvbWFpbl9yb290ID1cblxuICAvLyBDYW4ndCBoYXZlIGRpZ2l0cyBhbmQgZGFzaGVzXG4gICcoPzonICtcbiAgICBzcmNfeG4gK1xuICAgICd8JyArXG4gICAgc3JjX3BzZXVkb19sZXR0ZXJfbm9uX2QgKyAnezEsNjN9JyArXG4gICcpJztcblxudmFyIHNyY19kb21haW4gPSBleHBvcnRzLnNyY19kb21haW4gPVxuXG4gICcoPzonICtcbiAgICBzcmNfeG4gK1xuICAgICd8JyArXG4gICAgJyg/OicgKyBzcmNfcHNldWRvX2xldHRlciArICcpJyArXG4gICAgJ3wnICtcbiAgICAvLyBkb24ndCBhbGxvdyBgLS1gIGluIGRvbWFpbiBuYW1lcywgYmVjYXVzZTpcbiAgICAvLyAtIHRoYXQgY2FuIGNvbmZsaWN0IHdpdGggbWFya2Rvd24gJm1kYXNoOyAvICZuZGFzaDtcbiAgICAvLyAtIG5vYm9keSB1c2UgdGhvc2UgYW55d2F5XG4gICAgJyg/OicgKyBzcmNfcHNldWRvX2xldHRlciArICcoPzotKD8hLSl8JyArIHNyY19wc2V1ZG9fbGV0dGVyICsgJyl7MCw2MX0nICsgc3JjX3BzZXVkb19sZXR0ZXIgKyAnKScgK1xuICAnKSc7XG5cbnZhciBzcmNfaG9zdCA9IGV4cG9ydHMuc3JjX2hvc3QgPVxuXG4gICcoPzonICtcbiAgICBzcmNfaXA0ICtcbiAgJ3wnICtcbiAgICAnKD86KD86KD86JyArIHNyY19kb21haW4gKyAnKVxcXFwuKSonICsgc3JjX2RvbWFpbl9yb290ICsgJyknICtcbiAgJyknO1xuXG52YXIgdHBsX2hvc3RfZnV6enkgPSBleHBvcnRzLnRwbF9ob3N0X2Z1enp5ID1cblxuICAnKD86JyArXG4gICAgc3JjX2lwNCArXG4gICd8JyArXG4gICAgJyg/Oig/Oig/OicgKyBzcmNfZG9tYWluICsgJylcXFxcLikrKD86JVRMRFMlKSknICtcbiAgJyknO1xuXG52YXIgdHBsX2hvc3Rfbm9faXBfZnV6enkgPSBleHBvcnRzLnRwbF9ob3N0X25vX2lwX2Z1enp5ID1cblxuICAnKD86KD86KD86JyArIHNyY19kb21haW4gKyAnKVxcXFwuKSsoPzolVExEUyUpKSc7XG5cbmV4cG9ydHMuc3JjX2hvc3Rfc3RyaWN0ID1cblxuICBzcmNfaG9zdCArIHNyY19ob3N0X3Rlcm1pbmF0b3I7XG5cbnZhciB0cGxfaG9zdF9mdXp6eV9zdHJpY3QgPSBleHBvcnRzLnRwbF9ob3N0X2Z1enp5X3N0cmljdCA9XG5cbiAgdHBsX2hvc3RfZnV6enkgKyBzcmNfaG9zdF90ZXJtaW5hdG9yO1xuXG5leHBvcnRzLnNyY19ob3N0X3BvcnRfc3RyaWN0ID1cblxuICBzcmNfaG9zdCArIHNyY19wb3J0ICsgc3JjX2hvc3RfdGVybWluYXRvcjtcblxudmFyIHRwbF9ob3N0X3BvcnRfZnV6enlfc3RyaWN0ID0gZXhwb3J0cy50cGxfaG9zdF9wb3J0X2Z1enp5X3N0cmljdCA9XG5cbiAgdHBsX2hvc3RfZnV6enkgKyBzcmNfcG9ydCArIHNyY19ob3N0X3Rlcm1pbmF0b3I7XG5cbnZhciB0cGxfaG9zdF9wb3J0X25vX2lwX2Z1enp5X3N0cmljdCA9IGV4cG9ydHMudHBsX2hvc3RfcG9ydF9ub19pcF9mdXp6eV9zdHJpY3QgPVxuXG4gIHRwbF9ob3N0X25vX2lwX2Z1enp5ICsgc3JjX3BvcnQgKyBzcmNfaG9zdF90ZXJtaW5hdG9yO1xuXG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vLyBNYWluIHJ1bGVzXG5cbi8vIFJ1ZGUgdGVzdCBmdXp6eSBsaW5rcyBieSBob3N0LCBmb3IgcXVpY2sgZGVueVxuZXhwb3J0cy50cGxfaG9zdF9mdXp6eV90ZXN0ID1cblxuICAnbG9jYWxob3N0fFxcXFwuXFxcXGR7MSwzfVxcXFwufCg/OlxcXFwuKD86JVRMRFMlKSg/OicgKyBzcmNfWlBDYyArICd8JCkpJztcblxuZXhwb3J0cy50cGxfZW1haWxfZnV6enkgPVxuXG4gICAgJyhefD58JyArIHNyY19aQ2MgKyAnKSgnICsgc3JjX2VtYWlsX25hbWUgKyAnQCcgKyB0cGxfaG9zdF9mdXp6eV9zdHJpY3QgKyAnKSc7XG5cbmV4cG9ydHMudHBsX2xpbmtfZnV6enkgPVxuICAgIC8vIEZ1enp5IGxpbmsgY2FuJ3QgYmUgcHJlcGVuZGVkIHdpdGggLjovXFwtIGFuZCBub24gcHVuY3R1YXRpb24uXG4gICAgLy8gYnV0IGNhbiBzdGFydCB3aXRoID4gKG1hcmtkb3duIGJsb2NrcXVvdGUpXG4gICAgJyhefCg/IVsuOi9cXFxcLV9AXSkoPzpbJCs8PT5eYHxdfCcgKyBzcmNfWlBDYyArICcpKScgK1xuICAgICcoKD8hWyQrPD0+XmB8XSknICsgdHBsX2hvc3RfcG9ydF9mdXp6eV9zdHJpY3QgKyBzcmNfcGF0aCArICcpJztcblxuZXhwb3J0cy50cGxfbGlua19ub19pcF9mdXp6eSA9XG4gICAgLy8gRnV6enkgbGluayBjYW4ndCBiZSBwcmVwZW5kZWQgd2l0aCAuOi9cXC0gYW5kIG5vbiBwdW5jdHVhdGlvbi5cbiAgICAvLyBidXQgY2FuIHN0YXJ0IHdpdGggPiAobWFya2Rvd24gYmxvY2txdW90ZSlcbiAgICAnKF58KD8hWy46L1xcXFwtX0BdKSg/OlskKzw9Pl5gfF18JyArIHNyY19aUENjICsgJykpJyArXG4gICAgJygoPyFbJCs8PT5eYHxdKScgKyB0cGxfaG9zdF9wb3J0X25vX2lwX2Z1enp5X3N0cmljdCArIHNyY19wYXRoICsgJyknO1xuIiwibW9kdWxlLmV4cG9ydHM9L1tcXDAtXFx4MUZcXHg3Ri1cXHg5Rl0vIiwibW9kdWxlLmV4cG9ydHM9L1shLSMlLVxcKiwtLzo7XFw/QFxcWy1cXF1fXFx7XFx9XFx4QTFcXHhBN1xceEFCXFx4QjZcXHhCN1xceEJCXFx4QkZcXHUwMzdFXFx1MDM4N1xcdTA1NUEtXFx1MDU1RlxcdTA1ODlcXHUwNThBXFx1MDVCRVxcdTA1QzBcXHUwNUMzXFx1MDVDNlxcdTA1RjNcXHUwNUY0XFx1MDYwOVxcdTA2MEFcXHUwNjBDXFx1MDYwRFxcdTA2MUJcXHUwNjFFXFx1MDYxRlxcdTA2NkEtXFx1MDY2RFxcdTA2RDRcXHUwNzAwLVxcdTA3MERcXHUwN0Y3LVxcdTA3RjlcXHUwODMwLVxcdTA4M0VcXHUwODVFXFx1MDk2NFxcdTA5NjVcXHUwOTcwXFx1MEFGMFxcdTBERjRcXHUwRTRGXFx1MEU1QVxcdTBFNUJcXHUwRjA0LVxcdTBGMTJcXHUwRjE0XFx1MEYzQS1cXHUwRjNEXFx1MEY4NVxcdTBGRDAtXFx1MEZENFxcdTBGRDlcXHUwRkRBXFx1MTA0QS1cXHUxMDRGXFx1MTBGQlxcdTEzNjAtXFx1MTM2OFxcdTE0MDBcXHUxNjZEXFx1MTY2RVxcdTE2OUJcXHUxNjlDXFx1MTZFQi1cXHUxNkVEXFx1MTczNVxcdTE3MzZcXHUxN0Q0LVxcdTE3RDZcXHUxN0Q4LVxcdTE3REFcXHUxODAwLVxcdTE4MEFcXHUxOTQ0XFx1MTk0NVxcdTFBMUVcXHUxQTFGXFx1MUFBMC1cXHUxQUE2XFx1MUFBOC1cXHUxQUFEXFx1MUI1QS1cXHUxQjYwXFx1MUJGQy1cXHUxQkZGXFx1MUMzQi1cXHUxQzNGXFx1MUM3RVxcdTFDN0ZcXHUxQ0MwLVxcdTFDQzdcXHUxQ0QzXFx1MjAxMC1cXHUyMDI3XFx1MjAzMC1cXHUyMDQzXFx1MjA0NS1cXHUyMDUxXFx1MjA1My1cXHUyMDVFXFx1MjA3RFxcdTIwN0VcXHUyMDhEXFx1MjA4RVxcdTIzMDgtXFx1MjMwQlxcdTIzMjlcXHUyMzJBXFx1Mjc2OC1cXHUyNzc1XFx1MjdDNVxcdTI3QzZcXHUyN0U2LVxcdTI3RUZcXHUyOTgzLVxcdTI5OThcXHUyOUQ4LVxcdTI5REJcXHUyOUZDXFx1MjlGRFxcdTJDRjktXFx1MkNGQ1xcdTJDRkVcXHUyQ0ZGXFx1MkQ3MFxcdTJFMDAtXFx1MkUyRVxcdTJFMzAtXFx1MkU0MlxcdTMwMDEtXFx1MzAwM1xcdTMwMDgtXFx1MzAxMVxcdTMwMTQtXFx1MzAxRlxcdTMwMzBcXHUzMDNEXFx1MzBBMFxcdTMwRkJcXHVBNEZFXFx1QTRGRlxcdUE2MEQtXFx1QTYwRlxcdUE2NzNcXHVBNjdFXFx1QTZGMi1cXHVBNkY3XFx1QTg3NC1cXHVBODc3XFx1QThDRVxcdUE4Q0ZcXHVBOEY4LVxcdUE4RkFcXHVBOTJFXFx1QTkyRlxcdUE5NUZcXHVBOUMxLVxcdUE5Q0RcXHVBOURFXFx1QTlERlxcdUFBNUMtXFx1QUE1RlxcdUFBREVcXHVBQURGXFx1QUFGMFxcdUFBRjFcXHVBQkVCXFx1RkQzRVxcdUZEM0ZcXHVGRTEwLVxcdUZFMTlcXHVGRTMwLVxcdUZFNTJcXHVGRTU0LVxcdUZFNjFcXHVGRTYzXFx1RkU2OFxcdUZFNkFcXHVGRTZCXFx1RkYwMS1cXHVGRjAzXFx1RkYwNS1cXHVGRjBBXFx1RkYwQy1cXHVGRjBGXFx1RkYxQVxcdUZGMUJcXHVGRjFGXFx1RkYyMFxcdUZGM0ItXFx1RkYzRFxcdUZGM0ZcXHVGRjVCXFx1RkY1RFxcdUZGNUYtXFx1RkY2NV18XFx1RDgwMFtcXHVERDAwLVxcdUREMDJcXHVERjlGXFx1REZEMF18XFx1RDgwMVxcdURENkZ8XFx1RDgwMltcXHVEQzU3XFx1REQxRlxcdUREM0ZcXHVERTUwLVxcdURFNThcXHVERTdGXFx1REVGMC1cXHVERUY2XFx1REYzOS1cXHVERjNGXFx1REY5OS1cXHVERjlDXXxcXHVEODA0W1xcdURDNDctXFx1REM0RFxcdURDQkJcXHVEQ0JDXFx1RENCRS1cXHVEQ0MxXFx1REQ0MC1cXHVERDQzXFx1REQ3NFxcdURENzVcXHVEREM1LVxcdUREQzhcXHVERENEXFx1REUzOC1cXHVERTNEXXxcXHVEODA1W1xcdURDQzZcXHVEREMxLVxcdUREQzlcXHVERTQxLVxcdURFNDNdfFxcdUQ4MDlbXFx1REM3MC1cXHVEQzc0XXxcXHVEODFBW1xcdURFNkVcXHVERTZGXFx1REVGNVxcdURGMzctXFx1REYzQlxcdURGNDRdfFxcdUQ4MkZcXHVEQzlGLyIsIm1vZHVsZS5leHBvcnRzPS9bIFxceEEwXFx1MTY4MFxcdTIwMDAtXFx1MjAwQVxcdTIwMjhcXHUyMDI5XFx1MjAyRlxcdTIwNUZcXHUzMDAwXS8iLCJtb2R1bGUuZXhwb3J0cz0vW1xcMC1cXHVEN0ZGXFx1REMwMC1cXHVGRkZGXXxbXFx1RDgwMC1cXHVEQkZGXVtcXHVEQzAwLVxcdURGRkZdfFtcXHVEODAwLVxcdURCRkZdLyIsIi8qIGVzbGludC1kaXNhYmxlIG5vLXVudXNlZC12YXJzICovXG4ndXNlIHN0cmljdCc7XG52YXIgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xudmFyIHByb3BJc0VudW1lcmFibGUgPSBPYmplY3QucHJvdG90eXBlLnByb3BlcnR5SXNFbnVtZXJhYmxlO1xuXG5mdW5jdGlvbiB0b09iamVjdCh2YWwpIHtcblx0aWYgKHZhbCA9PT0gbnVsbCB8fCB2YWwgPT09IHVuZGVmaW5lZCkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ09iamVjdC5hc3NpZ24gY2Fubm90IGJlIGNhbGxlZCB3aXRoIG51bGwgb3IgdW5kZWZpbmVkJyk7XG5cdH1cblxuXHRyZXR1cm4gT2JqZWN0KHZhbCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gT2JqZWN0LmFzc2lnbiB8fCBmdW5jdGlvbiAodGFyZ2V0LCBzb3VyY2UpIHtcblx0dmFyIGZyb207XG5cdHZhciB0byA9IHRvT2JqZWN0KHRhcmdldCk7XG5cdHZhciBzeW1ib2xzO1xuXG5cdGZvciAodmFyIHMgPSAxOyBzIDwgYXJndW1lbnRzLmxlbmd0aDsgcysrKSB7XG5cdFx0ZnJvbSA9IE9iamVjdChhcmd1bWVudHNbc10pO1xuXG5cdFx0Zm9yICh2YXIga2V5IGluIGZyb20pIHtcblx0XHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKGZyb20sIGtleSkpIHtcblx0XHRcdFx0dG9ba2V5XSA9IGZyb21ba2V5XTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRpZiAoT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scykge1xuXHRcdFx0c3ltYm9scyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMoZnJvbSk7XG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IHN5bWJvbHMubGVuZ3RoOyBpKyspIHtcblx0XHRcdFx0aWYgKHByb3BJc0VudW1lcmFibGUuY2FsbChmcm9tLCBzeW1ib2xzW2ldKSkge1xuXHRcdFx0XHRcdHRvW3N5bWJvbHNbaV1dID0gZnJvbVtzeW1ib2xzW2ldXTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdHJldHVybiB0bztcbn07XG4iXX0=
