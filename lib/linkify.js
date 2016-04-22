var linkify = require('linkify-it')({}, {fuzzyEmail: false}).tlds('.onion', true)

linkify.add('#', {
  validate: function (text, pos, self) {
    var tail = text.slice(pos)
    if (!self.re.hashtag) {
      self.re.hashtag =  new RegExp(
        '^([a-zA-Z]+\\w{2,20})(?=$|' + self.re.src_ZPCc + ')')
    }
    var match = tail.match(self.re.hashtag)
    return (match ? match[0].length : 0) 
  },
  normalize: function (match) {
    match.type = 'hashtag'
    match.url = '/t/' + match.url.replace(/^#/, '').toLowerCase()
  }
})

module.exports = linkify
