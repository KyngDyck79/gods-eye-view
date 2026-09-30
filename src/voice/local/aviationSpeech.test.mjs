import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeAircraft,
  numberWords,
  speakAge,
  speakAltitude,
  speakCallsign,
  speakHeading,
} from './aviationSpeech.js';

test('callsigns use airline telephony, otherwise phonetics', () => {
  assert.equal(speakCallsign('AAL123'), 'American one two three');
  assert.equal(speakCallsign('swa2401'), 'Southwest two four zero one');
  assert.equal(speakCallsign('N12345'), 'November one two three four five');
  assert.equal(speakCallsign('XYZ9'), 'X-ray Yankee Zulu nine');
  assert.equal(speakCallsign(''), 'unknown aircraft');
});

test('altitudes, flight levels, headings and ages', () => {
  assert.equal(speakAltitude(34000), 'thirty-four thousand feet');
  assert.equal(speakAltitude(3480), 'three thousand five hundred feet');
  assert.equal(speakAltitude(34000, { flightLevels: true }), 'flight level three four zero');
  assert.equal(speakAltitude(12000, { flightLevels: true }), 'twelve thousand feet');
  assert.equal(speakAltitude(0), 'on the ground');
  assert.equal(numberWords(118_750), 'one hundred eighteen thousand seven hundred fifty');
  assert.equal(speakHeading(90), 'zero nine zero');
  assert.equal(speakHeading(0), 'three six zero');
  assert.equal(speakAge(8), 'eight seconds ago');
  assert.equal(speakAge(125), 'two minutes ago');
});

test('the spec example reads as written', () => {
  assert.equal(
    describeAircraft({ callsign: 'AAL123', typeName: 'Boeing 737-800', altitudeFt: 34000, ageSec: 8 }),
    "That's American one two three, a Boeing 737-800, at thirty-four thousand feet, as of eight seconds ago.",
  );
});
