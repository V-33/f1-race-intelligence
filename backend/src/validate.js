'use strict';
// Input validation for API parameters. Anything that fails gets a 400, never reaches the store.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function season(value) {
  const n = Number(value);
  if (!/^\d{4}$/.test(String(value)) || n < 1950 || n > 2100) throw new HttpError(400, 'season must be a 4-digit year from 1950');
  return n;
}

function round(value) {
  const n = Number(value);
  if (!/^\d{1,2}$/.test(String(value)) || n < 1 || n > 30) throw new HttpError(400, 'round must be a number from 1 to 30');
  return n;
}

function idList(value, { max = 6 } = {}) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'expected a comma-separated list of ids');
  const ids = [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > max) throw new HttpError(400, `between 1 and ${max} ids allowed`);
  for (const id of ids) if (!/^[a-z0-9_]{1,64}$/.test(id)) throw new HttpError(400, `invalid id "${id.slice(0, 64)}"`);
  return ids;
}

module.exports = { HttpError, season, round, idList };
