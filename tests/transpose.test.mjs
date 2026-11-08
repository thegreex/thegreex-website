import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  noteToIndex, transposeChord, transposeKey, semitonesBetween
} from '../band/transpose.js';

// noteToIndex
test('noteToIndex: sharp notes', () => {
  assert.equal(noteToIndex('C'),  0);
  assert.equal(noteToIndex('C#'), 1);
  assert.equal(noteToIndex('F'),  5);
  assert.equal(noteToIndex('G'),  7);
  assert.equal(noteToIndex('B'),  11);
});

test('noteToIndex: flat notes', () => {
  assert.equal(noteToIndex('Db'), 1);
  assert.equal(noteToIndex('Bb'), 10);
  assert.equal(noteToIndex('Ab'), 8);
});

test('noteToIndex: unknown returns -1', () => {
  assert.equal(noteToIndex('X'), -1);
});

// transposeChord – zero semitones
test('transposeChord: zero semitones is unchanged', () => {
  assert.equal(transposeChord('Am7', 0, 'Am'), 'Am7');
  assert.equal(transposeChord('D/F#', 0, 'G'), 'D/F#');
});

// transposeChord – sharp keys
test('transposeChord: G up 2 → A (sharp key)', () => {
  assert.equal(transposeChord('G', 2, 'A'), 'A');
});

test('transposeChord: C up 1 uses sharp in G key', () => {
  assert.equal(transposeChord('C', 1, 'G'), 'C#');
});

test('transposeChord: F up 1 uses sharp in G key', () => {
  assert.equal(transposeChord('F', 1, 'G'), 'F#');
});

// transposeChord – flat keys
test('transposeChord: A up 1 → Bb (flat key)', () => {
  assert.equal(transposeChord('A', 1, 'Bb'), 'Bb');
});

test('transposeChord: D up 3 → F (flat key)', () => {
  assert.equal(transposeChord('D', 3, 'F'), 'F');
});

test('transposeChord: E up 1 → F (flat key Bb)', () => {
  assert.equal(transposeChord('E', 1, 'Bb'), 'F');
});

// transposeChord – qualities preserved
test('transposeChord: quality preserved on minor', () => {
  assert.equal(transposeChord('Am', 2, 'B'), 'Bm');
});

test('transposeChord: quality preserved on maj7', () => {
  assert.equal(transposeChord('Cmaj7', 7, 'G'), 'Gmaj7');
});

test('transposeChord: quality preserved on sus4', () => {
  assert.equal(transposeChord('Dsus4', 5, 'G'), 'Gsus4');
});

test('transposeChord: quality preserved on dim', () => {
  assert.equal(transposeChord('Bdim', 1, 'C'), 'Cdim');
});

// transposeChord – slash chords
test('transposeChord: slash chord D/F# up 2', () => {
  assert.equal(transposeChord('D/F#', 2, 'E'), 'E/G#');
});

test('transposeChord: slash chord C/G up 5', () => {
  assert.equal(transposeChord('C/G', 5, 'F'), 'F/C');
});

// transposeKey
test('transposeKey: zero is unchanged', () => {
  assert.equal(transposeKey('G', 0), 'G');
});

test('transposeKey: G up 2 → A', () => {
  assert.equal(transposeKey('G', 2), 'A');
});

test('transposeKey: A up 1 → Bb (not A#)', () => {
  assert.equal(transposeKey('A', 1), 'Bb');
});

test('transposeKey: F up 2 → G', () => {
  assert.equal(transposeKey('F', 2), 'G');
});

test('transposeKey: C up 7 → G', () => {
  assert.equal(transposeKey('C', 7), 'G');
});

// semitonesBetween
test('semitonesBetween: same key → 0', () => {
  assert.equal(semitonesBetween('G', 'G'), 0);
});

test('semitonesBetween: C→G = 7', () => {
  assert.equal(semitonesBetween('C', 'G'), 7);
});

test('semitonesBetween: G→A = 2', () => {
  assert.equal(semitonesBetween('G', 'A'), 2);
});

test('semitonesBetween: A→Bb = 1', () => {
  assert.equal(semitonesBetween('A', 'Bb'), 1);
});

test('semitonesBetween: G→Bb = 3', () => {
  assert.equal(semitonesBetween('G', 'Bb'), 3);
});
