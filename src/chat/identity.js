function normalizeUserId(value, fieldName = 'userId') {
  if (value == null || !/^\d+$/.test(String(value)) || Number(value) <= 0) {
    throw new Error(`${fieldName} is invalid`);
  }
  return String(value);
}

function canonicalPair(left, right) {
  const first = normalizeUserId(left, 'firstUserId');
  const second = normalizeUserId(right, 'secondUserId');
  if (first === second) throw new Error('user pair cannot contain the same user');
  return BigInt(first) < BigInt(second)
    ? { low: first, high: second }
    : { low: second, high: first };
}

module.exports = { normalizeUserId, canonicalPair };
