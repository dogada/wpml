'use strict';

var mml = require('../lib');

var config = require('./config');

describe('mml.security', function () {

  it('should escape raw html', function() {
    expect(mml.html('<script>alert(\"xss\")</script>'))
      .eql('<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>')
  })

  it('should escape raw links', function() {
    expect(mml.html('<a href=\"/\">xss</a>'))
      .eql('<p>&lt;a href=&quot;/&quot;&gt;xss&lt;/a&gt;</p>')
  })

  it('should escape single line <script> by default', function() {
    expect(mml.html('script: alert(\"xss\")'))
      .eql('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  });

  it('should escape block <script> by default', function() {
    expect(mml.html('script:\nalert(\"xss\")\n/script:'))
      .eql('&lt;script&gt;...&lt;/script&gt;')
  });

  it('should exclude single line <script> with excludeDisabledTags: true', function() {
    expect(mml.html('script: alert(\"xss\")', {excludeDisabledTags: true}))
      .eql('')
  });

  it('should exclude block <script> with excludeDisabledTags: true', function() {
    expect(mml.html('script:\nalert(\"xss\")\n/script:', {excludeDisabledTags: true}))
      .eql('')
  });

  it('should exclude \"javascript:\" tag attributes', function() {
    expect(mml.html('a: XSS\n.href: javascript: alert(\"XSS\")'))
      .eql('<a>XSS</a>')
  });

  it('should exclude case-insensitive \"JavaScripT:\" tag attributes', function() {
    expect(mml.html('a: XSS\n.href: JavaScripT: alert(\"XSS\")'))
      .eql('<a>XSS</a>')
  });

  it('should escape tags that are not in whitelist', function() {
    expect(mml.html('div:\nblink: Blink me!\nform:\nbutton: Click me\n:form\n:div',
                   {whitelist: "p div h3 h4 a code pre br hr img ul ol li dl dt dd small em b i strong span sub sup cite abbr"}))
      .eql('<div>\n&lt;blink&gt;Blink me!&lt;/blink&gt;\n&lt;form&gt;...&lt;/form&gt;\n</div>')
  });

  it('should not allow <script> inside tags that are not in whitelist', function() {
    expect(mml.html('div:\nblink: Blink me!\nform:\nscript: alert()\nbutton: Click me\n:form\n:div',
                   {whitelist: "p div h3 h4 a code pre br hr img ul ol li dl dt dd small em b i strong span sub sup cite abbr"}))
      .eql('<div>\n&lt;blink&gt;Blink me!&lt;/blink&gt;\n&lt;form&gt;...&lt;/form&gt;\n</div>')
  });

  it('can allow usage of several CSS-classes only', function() {
    expect(mml.html('div.user-class.main:\np.lead.pull-right: Test\nspan.small: Small\n:div',
                   {classTest: /^(user-[\w]*|lead|small)/}))
      .eql('<div class=\"user-class\">\n<p class=\"lead\">Test</p>\n<span class=\"small\">Small</span>\n</div>')
  });

  it('can limit namespace for ids of elements', function() {
    expect(mml.html('div#header:\np#pageId1.lead: Test\n:div',
                   {idTest: /^page[\w]+/}))
      .eql('<div>\n<p id=\"pageId1\" class=\"lead\">Test</p>\n</div>')
  });

});
