import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answersEqual,
  bankAnswerToTexts,
  configureBank,
  confirmCorrect,
  courseScope,
  lookupAnswers,
  lookupBankAnswers,
  platformKeyToBankAnswer,
  recordIncorrect,
  textsToBankAnswer,
  toBankQuestion,
} from '../src/bank.ts';

const single = {
  id: 'q1',
  rawType: 'single_choice',
  type: 'single',
  stem: 'Choose the best answer.',
  passage: '  A short passage.  ',
  instruction: 'section instruction must not enter the fingerprint',
  images: ['https://example.invalid/a.png?signature=volatile'],
  options: [
    { index: 0, text: 'Alpha', optionId: 'o1', value: 'o1', label: 'A' },
    { index: 1, text: 'Beta', optionId: 'o2', value: 'o2', label: 'B' },
  ],
  blankCount: 0,
  childIds: ['c1'],
};

const multiple = {
  ...single,
  id: 'q2',
  rawType: 'multiple_choice',
  type: 'multiple',
  stem: 'Choose all that apply.',
  passage: undefined,
};

const judge = {
  id: 'q3',
  rawType: 'true_false',
  type: 'judge',
  stem: 'The statement is correct.',
  options: [
    { index: 0, text: '正确', optionId: 'j1', value: 'j1', label: 'T' },
    { index: 1, text: '错误', optionId: 'j2', value: 'j2', label: 'F' },
  ],
  blankCount: 0,
  childIds: ['c3'],
};

const blank = {
  id: 'q4',
  rawType: 'fill_blanks',
  type: 'fill',
  stem: 'Fill {{1}} and {{2}}.',
  options: [],
  blankCount: 2,
  childIds: ['b1', 'b2'],
};

test('toBankQuestion maps the four objective kinds and drops volatile context', () => {
  assert.deepEqual(toBankQuestion(single), {
    kind: 'single',
    text: 'Choose the best answer.',
    options: [
      { id: 'o1', text: 'Alpha' },
      { id: 'o2', text: 'Beta' },
    ],
    context: 'A short passage.',
  });
  assert.equal(toBankQuestion(multiple).kind, 'multiple');
  assert.equal(toBankQuestion(judge).kind, 'judge');
  assert.deepEqual(toBankQuestion(blank), {
    kind: 'blank',
    text: 'Fill {{1}} and {{2}}.',
    options: [],
    blanks: 2,
  });
});

test('toBankQuestion derives blank counts and option ids', () => {
  assert.equal(toBankQuestion({ ...blank, blankCount: 0, childIds: ['a', 'b', 'c'] }).blanks, 3);
  assert.equal(toBankQuestion({ ...blank, blankCount: 0, childIds: [] }).blanks, 1);
  assert.equal(
    toBankQuestion({
      ...blank,
      rawType: 'fill_blanks_choice',
      blankCount: 0,
      childIds: ['a', 'b'],
      options: [
        { text: 'apple', value: 'w1', label: 'apple' },
        { text: 'pear', value: 'w2', label: 'pear' },
      ],
    }).kind,
    'blank',
  );

  const fallback = toBankQuestion({
    ...single,
    options: [
      { index: 0, text: 'One', optionId: 'dup' },
      { index: 1, text: 'Two', optionId: 'dup', value: '' },
      { index: 2, text: 'Three', value: '' },
    ],
  });
  assert.deepEqual(fallback.options, [
    { id: 'dup', text: 'One' },
    { id: 'dup#1', text: 'Two' },
    { id: '2', text: 'Three' },
  ]);
});

test('toBankQuestion refuses uncacheable or ambiguous questions', () => {
  for (const rawType of [
    'matching',
    'text_match',
    'sequence',
    'writing',
    'translation',
    'short_answer',
    'oral_personal_state',
  ]) {
    assert.equal(toBankQuestion({ ...single, rawType }), null, rawType);
  }
  assert.equal(toBankQuestion({ ...single, stem: '   ' }), null);
  assert.equal(
    toBankQuestion({
      ...single,
      options: [
        { text: 'same', optionId: 'a' },
        { text: 'same ', optionId: 'b' },
      ],
    }),
    null,
  );
  assert.equal(
    toBankQuestion({ ...judge, options: [] }),
    null,
  );
  assert.equal(
    toBankQuestion({ ...single, options: [{ index: 0, text: '   ', optionId: 'a' }] }),
    null,
  );
});

test('platformKeyToBankAnswer accepts ids, labels, text and JSON arrays', () => {
  assert.deepEqual(platformKeyToBankAnswer(single, 'o2'), ['o2']);
  assert.deepEqual(platformKeyToBankAnswer(single, 'B'), ['o2']);
  assert.deepEqual(platformKeyToBankAnswer(single, 'Beta'), ['o2']);
  assert.deepEqual(platformKeyToBankAnswer(single, '["o1"]'), ['o1']);
  assert.deepEqual(platformKeyToBankAnswer(single, ['o1']), ['o1']);
  assert.equal(platformKeyToBankAnswer(single, '["o1","o2"]'), null);
  assert.equal(platformKeyToBankAnswer(single, 'unknown'), null);

  assert.deepEqual(platformKeyToBankAnswer(multiple, 'A,B'), ['o1', 'o2']);
  assert.deepEqual(platformKeyToBankAnswer(multiple, 'AB'), ['o1', 'o2']);
  assert.deepEqual(platformKeyToBankAnswer(multiple, '["o2","o1"]'), ['o2', 'o1']);
  assert.deepEqual(platformKeyToBankAnswer(multiple, ['Beta', 'Alpha']), ['o2', 'o1']);
  assert.deepEqual(platformKeyToBankAnswer(multiple, 'o2'), ['o2']);
});

test('platformKeyToBankAnswer resolves judge semantics only', () => {
  assert.deepEqual(platformKeyToBankAnswer(judge, 'j1'), ['true']);
  assert.deepEqual(platformKeyToBankAnswer(judge, 'T'), ['true']);
  assert.deepEqual(platformKeyToBankAnswer(judge, '正确'), ['true']);
  assert.deepEqual(platformKeyToBankAnswer(judge, 'false'), ['false']);
  assert.deepEqual(platformKeyToBankAnswer(judge, 'F'), ['false']);
  assert.deepEqual(platformKeyToBankAnswer(judge, '错误'), ['false']);
  assert.deepEqual(platformKeyToBankAnswer(judge, '["true"]'), ['true']);

  const ambiguous = {
    ...judge,
    options: [
      { index: 0, text: 'A', optionId: 'x1', label: 'A' },
      { index: 1, text: 'B', optionId: 'x2', label: 'B' },
    ],
  };
  assert.equal(platformKeyToBankAnswer(ambiguous, 'A'), null);
  assert.equal(platformKeyToBankAnswer(ambiguous, 'x1'), null);
});

test('platformKeyToBankAnswer handles single and multi blank values', () => {
  assert.deepEqual(platformKeyToBankAnswer(blank, ['one', 'two']), ['one', 'two']);
  assert.deepEqual(platformKeyToBankAnswer(blank, 'one\ntwo'), ['one', 'two']);
  assert.deepEqual(platformKeyToBankAnswer(blank, '["one","two"]'), ['one', 'two']);
  assert.equal(platformKeyToBankAnswer(blank, ['one']), null);
  assert.equal(platformKeyToBankAnswer(blank, ['one', '']), null);
});

test('bankAnswerToTexts and textsToBankAnswer round-trip', () => {
  const singleQuestion = toBankQuestion(single);
  assert.deepEqual(bankAnswerToTexts(single, ['o2']), ['Beta']);
  assert.deepEqual(textsToBankAnswer(single, ['Beta']), ['o2']);
  assert.deepEqual(bankAnswerToTexts(single, textsToBankAnswer(single, ['Beta'])), ['Beta']);
  assert.equal(bankAnswerToTexts(single, ['unknown']), null);

  assert.deepEqual(bankAnswerToTexts(judge, ['true']), ['正确']);
  assert.deepEqual(textsToBankAnswer(judge, ['正确']), ['true']);
  assert.deepEqual(textsToBankAnswer(judge, ['错误']), ['false']);

  assert.deepEqual(bankAnswerToTexts(blank, ['one', 'two']), ['one', 'two']);
  assert.deepEqual(textsToBankAnswer(blank, ['one', 'two']), ['one', 'two']);
  assert.equal(bankAnswerToTexts(blank, ['one']), null);

  assert.equal(singleQuestion.kind, 'single');
});

test('answersEqual ignores order for multiple only', () => {
  assert.equal(answersEqual(multiple, ['o1', 'o2'], ['o2', 'o1']), true);
  assert.equal(answersEqual(blank, ['one', 'two'], ['two', 'one']), false);
  assert.equal(answersEqual(single, ['o1'], ['o2']), false);
});

test('courseScope is the shared book scope', () => {
  assert.equal(courseScope({ bookId: 'book-1', bookVersion: 'v2' }), 'book-1/v2');
});

test('lookupAnswers collects hits and swallows per-question failures', async () => {
  const calls = [];
  configureBank(async (method, params) => {
    calls.push({ method, params });
    if (params.question.text === 'explode') throw new Error('boom');
    return { correct: ['o2'], wrong: [], updated_at: 1 };
  }, () => {});

  const hits = await lookupAnswers('session-1', 'book-1/v2', [
    single,
    { ...single, id: 'q9', stem: 'explode' },
    { ...single, rawType: 'writing' },
  ]);
  assert.deepEqual(hits, [
    { questionId: 'q1', texts: ['Beta'], confidence: 1, source: 'bank' },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'cw.question_bank.lookup');
  assert.equal(calls[0].params.session, 'session-1');
  assert.equal(calls[0].params.course, 'book-1/v2');
  assert.equal(calls[0].params.question.kind, 'single');
});

test('lookupBankAnswers keeps ids for the paper answer field', async () => {
  configureBank(async (method, params) => {
    if (params.question.kind === 'judge') return { correct: ['true'] };
    return { correct: ['o2'] };
  }, () => {});
  const hits = await lookupBankAnswers('session-1', 'book-1/v2', [single, judge]);
  assert.deepEqual(hits, [
    { questionId: 'q1', answer: ['o2'], texts: ['Beta'] },
    { questionId: 'q3', answer: ['true'], texts: ['正确'] },
  ]);
});

test('confirmCorrect and recordIncorrect send the host contract and never throw', async () => {
  const calls = [];
  configureBank(async (method, params) => {
    calls.push({ method, params });
  }, () => {});

  await confirmCorrect('session-1', 'book-1/v2', single, ['o2'], 'chapter:1:2:q1');
  await recordIncorrect('session-1', 'book-1/v2', single, ['o1']);
  assert.equal(calls[0].method, 'cw.question_bank.confirm');
  assert.deepEqual(calls[0].params.confirmation, {
    confirmed: true,
    source: 'platform',
    reference: 'chapter:1:2:q1',
  });
  assert.deepEqual(calls[1].params.evidence, { result: 'incorrect', source: 'platform' });

  configureBank(async () => {
    throw new Error('offline');
  }, () => {});
  await confirmCorrect('session-1', 'book-1/v2', single, ['o2'], 'ref');
  await recordIncorrect('session-1', 'book-1/v2', single, ['o1']);
});
