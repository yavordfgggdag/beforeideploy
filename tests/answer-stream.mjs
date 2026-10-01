import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnswerStream } from '../engine/src/ai/answer-stream.mjs';

test('human answer only, independent of every chunk boundary', () => {
  const source = '```json\n{"files":[{"answer":"private code"}],"answer":"Hello \\u0411\\u0433 \\ud83d\\ude80\\n`code` \\"quoted\\" \\\\ end","other":"secret"}\n```';
  const expected = 'Hello Бг 🚀\n`code` "quoted" \\ end';
  for (let cut = 0; cut <= source.length; cut++) {
    const stream = new AnswerStream();
    assert.equal(stream.push(source.slice(0, cut)) + stream.push(source.slice(cut)), expected, `boundary ${cut}`);
  }
  const stream = new AnswerStream();
  assert.equal([...source].map(c => stream.push(c)).join(''), expected);
});

test('selects the field declared by the prompt, ignores nested and alternate fields', () => {
  const stream = new AnswerStream('summary');
  assert.equal(stream.push('{"answer":"wrong","details":{"summary":"private"},"summary":"Readable","changes":[{"content":"code"}]}'), 'Readable');
});

test('incomplete and invalid escapes never leak JSON fragments', () => {
  const stream = new AnswerStream();
  assert.equal(stream.push('{"answer":"Safe\\u04'), 'Safe');
  assert.equal(stream.push('16"}'), 'Ж');
  assert.equal(new AnswerStream().push('{"answer":"Safe\\qKEY"}'), 'Safe');
  assert.equal(new AnswerStream().push('{"changes":[{"answer":"hidden"}]}'), '');
});
