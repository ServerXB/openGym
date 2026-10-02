import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { secondsUntilRestDeadline } from './rest-timer.js';

const NOW = 1_800_000_000_000;

describe('rest notification deadline validation', () => {
  it('uses the supplied deadline instead of delaying it by request transit time', () => {
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 90_000 }, NOW + 2_000), 88);
  });

  it('retains milliseconds at the deadline boundary', () => {
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 499 }, NOW), 0.499);
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 1 }, NOW), 0.001);
  });

  it('accepts exactly one hour and rejects longer explicit deadlines', () => {
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 3_600_000 }, NOW), 3600);
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 3_600_001 }, NOW), null);
  });

  it('rejects past, present, nonfinite and nonnumeric explicit deadlines', () => {
    for (const deadlineAt of [NOW - 1, NOW, null, undefined, NaN, Infinity, -Infinity, String(NOW + 1000), true]) {
      assert.equal(secondsUntilRestDeadline({ deadlineAt, seconds: 90 }, NOW), null);
    }
  });

  it('retains the legacy seconds endpoint coercion, rounding and clamp', () => {
    for (const [seconds, expected] of [
      [90, 90], ['90.6', 91], [0, 1], [-15, 1], [3601, 3600],
      [undefined, 1], [null, 1], ['invalid', 1], [true, 1]
    ]) {
      assert.equal(secondsUntilRestDeadline({ seconds }, NOW), expected);
    }
    assert.equal(secondsUntilRestDeadline({}, NOW), 1);
  });

  it('gives a valid deadline precedence over a conflicting legacy duration', () => {
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 40_500, seconds: 300 }, NOW), 40.5);
  });

  it('rejects invalid request envelopes or clock values', () => {
    for (const body of [null, undefined, [], '90', 90]) assert.equal(secondsUntilRestDeadline(body, NOW), null);
    assert.equal(secondsUntilRestDeadline({ deadlineAt: NOW + 1000 }, NaN), null);
  });
});
