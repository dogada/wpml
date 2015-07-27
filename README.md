# WPML &mdash; Markup Language for Web Publications

Language designed especially for editing web publications (articles, messages, comments).

Web-site owner can limit allowed tags, classes, ids and HTML-attributes.

WPML-document can contain meta information (title, lang, tags, etc) that is not converted to HTML but available as a javascript dictionary.

Support plugins that allow to embed rich formating in safe mode.

Example:

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
