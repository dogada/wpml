'use strict';

var parser = require('./parser')
var compiler = require('./compiler')
var linkify = require('./linkify')

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

function hashtags(text) {
  var res = []
  var matches = (linkify.test(text) ? linkify.match(text) : [])
  for (var i = 0, match; (match = matches[i++]); ) {
    if (match.type === 'hashtag') res.push(match.text.slice(1))
  }
  return res
}

module.exports = {
  parse: parser,
  renderParsed: compiler,
  render: render,
  html: render,
  doc: doc,
  meta: meta,
  hashtags
}
