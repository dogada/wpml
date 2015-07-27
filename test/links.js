'use strict';

var mml = require('../lib');

var config = require('./config');

describe('mml.links', function () {

  it('should linkify single http link', function() {
    expect(mml.html('p: http://www.coect.net'))
      .eql('<p><a href=\"http://www.coect.net\">http://www.coect.net</a></p>')
  })

  it('should linkify single https link', function() {
    expect(mml.html('p: https://www.coect.net'))
      .eql('<p><a href=\"https://www.coect.net\">https://www.coect.net</a></p>')
  })

  it('should linkify single // link', function() {
    expect(mml.html('p: //www.coect.net'))
      .eql('<p><a href=\"//www.coect.net\">//www.coect.net</a></p>')
  })

  it('should linkify a link without schema as http link', function() {
    expect(mml.html('p: www.coect.net'))
      .eql('<p><a href=\"http://www.coect.net\">www.coect.net</a></p>')
  })

  it('should linkify several links', function() {
    expect(mml.html('p: Look at www.coect.me! It uses http://www.coect.net'))
      .eql('<p>Look at <a href="http://www.coect.me">www.coect.me</a>!' +
           ' It uses <a href="http://www.coect.net">http://www.coect.net</a></p>')
  })

  it('should linkify link that ends a text', function() {
    expect(mml.html('p: Look at http://www.coect.net/'))
      .eql('<p>Look at <a href=\"http://www.coect.net/\">http://www.coect.net/</a></p>')
  })

  it('should linkify and properly escape link with query part', function() {
    expect(mml.html('p: Look at http://www.coect.net/path?x=1&y=2&html=<>'))
      .eql('<p>Look at <a href=\"http://www.coect.net/path?x=1&amp;y=2&amp;html=&lt;&gt;">' +    
           'http://www.coect.net/path?x=1&amp;y=2&amp;html=&lt;&gt;</a></p>')
  })

  it('should linkify .onion links', function() {
    expect(mml.html('p: Use http://search.onion'))
      .eql('<p>Use <a href="http://search.onion">http://search.onion</a></p>')
  })

  it('should not linkify emails', function() {
    expect(mml.html('p: dogada@coect.net'))
      .eql('<p>dogada@coect.net</p>')
  })

});
