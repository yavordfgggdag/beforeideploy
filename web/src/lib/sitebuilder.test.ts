import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefJSON, emptyBrief, errorKey, inlinePreview, pageFromHash, rankThemes, type Theme } from './sitebuilder.ts';

const theme = (id: string, title: string, keywords: string[], description = ''): Theme => ({
  id, title, description, pages: 3, category: 'personal', categoryTitle: 'Personal', icon: 'doc', accent: '#000', featured: true, style: 'calm', questions: [], preview: null, art: 'blobs', keywords, sample: 'X',
});

test('the brief the engine reads: empty service rows out, name trimmed, photos optional', () => {
  const b = emptyBrief('bg');
  b.name = '  Ива ';
  b.services = [{ name: 'Сесия', price: '100 лв.', text: '' }, { name: '', price: '', text: '' }];
  b.photos = [{ path: '/tmp/me.jpg', alt: '' }];
  const j = JSON.parse(briefJSON(b));
  assert.equal(j.schema, 'bid.site-brief/1');
  assert.equal(j.name, 'Ива');
  assert.equal(j.services.length, 1);
  assert.equal(j.scheme, 'auto');
  assert.equal(JSON.parse(briefJSON(b, { photos: false })).photos.length, 0);
});

test('themes rank by the owner\'s words: keywords first, stems both ways, nothing → unchanged', () => {
  const themes = [theme('landing', 'Business landing', ['business', 'agency']), theme('salon', 'Salon', ['салон', 'фризьор', 'hair']), theme('course', 'Course', ['course'], 'lessons for students')];
  assert.deepEqual(rankThemes(themes, 'фризьорски салон').map((t) => t.id), ['salon']);
  assert.deepEqual(rankThemes(themes, 'hairdresser').map((t) => t.id), ['salon']);
  assert.equal(rankThemes(themes, 'lessons')[0].id, 'course');
  assert.equal(rankThemes(themes, '').length, 3);
  assert.equal(rankThemes(themes, 'xyzzy').length, 0);
});

test('a rendered site becomes one document for the iframe: stylesheet inlined, art as data URLs, links kept inside', () => {
  const files = {
    'index.html': '<html><head><link rel="stylesheet" href="/styles.css"></head><body><a href="/about.html">About</a><a href="/#programs">P</a><a href="/">Home</a><img src="/art/hero.svg"><a href="https://x.y/">out</a></body></html>',
    'about.html': '<html><body>about</body></html>',
    'styles.css': 'body{color:red}',
    'art/hero.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
  const html = inlinePreview(files);
  assert.ok(html.includes('<style>body{color:red}</style>'));
  assert.ok(html.includes('src="data:image/svg+xml;base64,'));
  assert.ok(html.includes('href="#page=about.html"') && html.includes('href="#page=index.html#programs"') && html.includes('href="#page=index.html"'));
  assert.ok(html.includes('href="https://x.y/"'), 'external links untouched');
  assert.equal(inlinePreview(files, 'about.html'), '<html><body>about</body></html>');
  assert.equal(pageFromHash('#page=about.html#x'), 'about.html');
  assert.equal(pageFromHash('#x'), null);
});

test('engine codes map to plain-words messages; unknown codes keep the engine\'s text', () => {
  assert.equal(errorKey('quota_exhausted'), 'err.noCredits');
  assert.equal(errorKey('credits_release'), 'err.creditsLater');
  assert.equal(errorKey('network'), 'err.network');
  assert.equal(errorKey('ai_timeout'), 'err.timeout');
  assert.equal(errorKey('site_modified'), 'err.handEdited');
  assert.equal(errorKey('usage'), null);
});
