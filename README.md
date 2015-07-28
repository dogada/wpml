# WPML &mdash; Markup Language for Web Publications

Language designed especially for editing web publications (articles, messages, comments).

Web-site owner can limit allowed tags, classes, ids and HTML-attributes.

WPML-document can contain meta information (title, lang, tags, etc) that is not converted to HTML but available as a javascript dictionary.

Support plugins that allow to embed rich formating in safe mode.

Example of WPML:

```
!title: Hello world!
!lang: en
!tags: hello, world

p.lead: Hello world!

Lorem Ipsum paragraph #1

Lorem Ipsum paragraph #2

pic: userpic.jpg
.caption: Userpic

youtube: https://youtu.be/-Wdwj4JfkrA
 
```

It can be converted to HTML on server-side or client-side.

Configurations looks like:

```js

var _wpml = require('wpml')
var escape = require('escape-html')
var htmlTag = require('html-tag')
var assign = require('object-assign')

var plugins = {
  youtube: function(data) {
    var attrs = assign({
      src: data.value,
      scrolling: 'no',
      frameborder: '0',
      width: '560',
      height: '315',
      allowfullscreen: 1}, data.attrs)
    return tag('iframe', attrs,
               tag('a', {href: data.value}, escape(data.value)))
  }
}


var opts = {
  javascript: false,
  plugins: plugins,
  linkPlugin: 'oembed',
  whitelist: 'iframe p div h3 h4 a code pre br hr img ul ol li dl dt dd small em b i strong span sub sup cite abbr section aside',
  idTest: /^wp[\w]+/,
  classTest: /^(wp-[\w-]+|lead|small)/
}

exports.wpml = {
  doc: function(text) {
    return _wpml.doc(text, opts)
  }
}


```

Example of usage:

```js
var doc = wpml.doc(text)
console.log(doc.title, doc.lang, doc.tags, doc.html)
```


The library works well in browserify environment. To build a standalone version at dist/wpml.js you can use:

```
$ npm run build
```
