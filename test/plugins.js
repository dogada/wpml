'use strict';

var escape = require('escape-html')
var mml = require('../lib');

var config = require('./config');

var plugins = {
  video: function(data) {
    var width = data.attrs && data.attrs.width || 640
    return '<object data=\"' + escape(data.value) + '\" width=\"' +
      escape(width) + '\"></object>'
  },
  oembed: function(data) {
    var url = escape(data.value)
    return '<iframe src=\"/oembed/?url=' + encodeURIComponent(data.value) + '\">\n' +
      '<a href=\"' + url + '\">' + url + '</a>\n' +
      '</iframe>'
  }
}

describe('mml.plugins', function () {

  it('should output unknown plugin as custom tag', function() {
    expect(mml.html('video: movie.swf'))
      .eql('<video>movie.swf</video>')
  });

  it('should render short form of dummy \"video\" plugin', function() {
    expect(mml.html('video: movie.swf', {plugins: plugins}))
      .eql('<object data=\"movie.swf\" width=\"640\"></object>')
  });

  it('should render dummy \"video\" plugin with width attribute', function() {
    expect(mml.html('video: movie.swf\n.width: 720', {plugins: plugins}))
      .eql('<object data=\"movie.swf\" width=\"720\"></object>')
  });

  it('can render oembed plugin as iframe', function() {
    expect(mml.html('oembed: http://youtube.com/cool-video', 
                    {plugins: plugins}))
      .eql('<iframe src="/oembed/?url=http%3A%2F%2Fyoutube.com%2Fcool-video">\n' +
           '<a href="http://youtube.com/cool-video">http://youtube.com/cool-video</a>\n' +
           '</iframe>')
  });

  it('can render single link on a line as oembed plugin', function() {
    expect(mml.html('http://youtube.com/cool-video', 
                    {plugins: plugins, linkPlugin: 'oembed'}))
      .eql('<iframe src="/oembed/?url=http%3A%2F%2Fyoutube.com%2Fcool-video">\n' +
           '<a href="http://youtube.com/cool-video">http://youtube.com/cool-video</a>\n' +
           '</iframe>')
  });


});
