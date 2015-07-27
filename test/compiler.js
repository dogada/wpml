'use strict';

var mml = require('../lib');

var config = require('./config');

describe('mml.compile', function () {

  it('should convert empty document', function() {
    expect(mml.html(''))
      .eql('')
  });

  it('should convert single line to <p>', function() {
    expect(mml.html('First'))
      .eql('<p>First</p>')
  });

  it('should convert quote', function() {
    expect(mml.html('Hamlet: To be, or not to be?'))
      .eql('<p>Hamlet: To be, or not to be?</p>')
  });

  it('should convert quote inside <p>', function() {
    expect(mml.html('p: Hamlet: To be, or not to be?'))
      .eql('<p>Hamlet: To be, or not to be?</p>')
  });

  it('should wrap lines with <p>', function() {
    expect(mml.html('First\nSecond')).eql('<p>First</p>\n<p>Second</p>')
  });

  it('should not output head section', function() {
    expect(mml.html('!title: Test\nFirst\nSecond'))
      .eql('<p>First</p>\n<p>Second</p>')
  });

  it('should not create paragraphs inside a block tag', function() {
    expect(mml.html('div:\nFirst\nSecond\n:div'))
      .eql('<div>\nFirst\nSecond\n</div>')
  });

  it('may create paragraphs inside a block tag', function() {
    expect(mml.html('div:\np.lead: First\np: Second\n:div'))
      .eql('<div>\n<p class=\"lead\">First</p>\n<p>Second</p>\n</div>')
  });

  it('should handle div inside other div', function() {
    expect(mml.html('div.lead:\ndiv: Inner1\ndiv: Inner2\n:div'))
      .eql('<div class=\"lead\">\n<div>Inner1</div>\n<div>Inner2</div>\n</div>')
  });

  it('may indent generated html', function() {
    expect(mml.html('ul.test:\nli: First\nli: Second\n:ul', {indent: 2}))
      .eql('<ul class="test">\n  <li>First</li>\n  <li>Second</li>\n</ul>')
  });

  it('should handle several levels of indentation', function() {
    expect(mml.html('div:\nul.test:\nli: First\nli: Second\n:ul\n:div', {indent: 2}))
      .eql('<div>\n  <ul class="test">\n    <li>First</li>\n    <li>Second</li>\n  </ul>\n</div>')
  });

  it('should close unclosed block tags', function() {
    expect(mml.html('div:\nul.test:\nli: First\nli: Second', {indent: 2}))
      .eql('<div>\n  <ul class="test">\n    <li>First</li>\n    <li>Second</li>\n  </ul>\n</div>')
  });

  it('should close last opened tag even if close tag aren\'t match open tag', function() {
    expect(mml.html('div:\nul.test:\nli: First\nli: Second\n:div', {indent: 2}))
      .eql('<div>\n  <ul class="test">\n    <li>First</li>\n    <li>Second</li>\n  </ul>\n</div>')
  });

  it('should properly close opened tag even if order of close tags are incorrect', function() {
    expect(mml.html('div:\nul.test:\nli: First\nli: Second\n:div\n:ul', {indent: 2}))
      .eql('<div>\n  <ul class="test">\n    <li>First</li>\n    <li>Second</li>\n  </ul>\n</div>')
  });


});
