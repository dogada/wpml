'use strict';

var wpml = require('../lib');

var config = require('./config');

describe('wpml.links', function () {

  it('should linkify single http link', function() {
    expect(wpml.html('p: http://www.coect.net'))
      .eql('<p><a href=\"http://www.coect.net\" rel=\"nofollow\" target=\"_blank\">coect.net</a></p>')
  })

  it('should linkify single https link', function() {
    expect(wpml.html('p: https://www.coect.net'))
      .eql('<p><a href=\"https://www.coect.net\" rel=\"nofollow\" target=\"_blank\">coect.net</a></p>')
  })

  it('should linkify single // link', function() {
    expect(wpml.html('p: //www.coect.net'))
      .eql('<p><a href=\"//www.coect.net\" rel=\"nofollow\" target=\"_blank\">//www.coect.net</a></p>')
  })

  it('should linkify a link without schema as http link', function() {
    expect(wpml.html('p: www.coect.net'))
      .eql('<p><a href=\"http://www.coect.net\" rel=\"nofollow\" target=\"_blank\">www.coect.net</a></p>')
  })

  it('should linkify several links', function() {
    expect(wpml.html('p: Look at www.coect.me! It uses http://www.coect.net'))
      .eql('<p>Look at <a href="http://www.coect.me" rel=\"nofollow\" target=\"_blank\">www.coect.me</a>!' +
           ' It uses <a href="http://www.coect.net" rel=\"nofollow\" target=\"_blank\">coect.net</a></p>')
  })

  it('should linkify link that ends a text', function() {
    expect(wpml.html('p: Look at http://www.coect.net/'))
      .eql('<p>Look at <a href=\"http://www.coect.net/\" rel=\"nofollow\" target=\"_blank\">coect.net/</a></p>')
  })

  it('should linkify and properly escape link with query part', function() {
    expect(wpml.html('p: Look at http://www.coect.net/path?x=1&y=2&html=<>'))
      .eql('<p>Look at <a href=\"http://www.coect.net/path?x=1&amp;y=2&amp;html=&lt;&gt;" rel=\"nofollow\" target=\"_blank\">' +    
           'coect.net/path?x=1&amp;y=2&amp;html=&lt;&gt;</a></p>')
  })

  it('should linkify .onion links', function() {
    expect(wpml.html('p: Use http://search.onion'))
      .eql('<p>Use <a href="http://search.onion" rel=\"nofollow\" target=\"_blank\">search.onion</a></p>')
  })

  it('should not linkify emails', function() {
    expect(wpml.html('p: dogada@coect.net'))
      .eql('<p>dogada@coect.net</p>')
  })

  it('should truncate long url', function() {
    expect(wpml.html('p: Truncated: http://www.longdomainname.com/longpathsegment/hugepathendingwithouttheend'))
      .eql('<p>Truncated: <a href="http://www.longdomainname.com/longpathsegment/hugepathendingwithouttheend" rel=\"nofollow\" target=\"_blank\">longdomainname..gwithouttheend</a></p>')
  })

});
