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
