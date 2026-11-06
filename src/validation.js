export function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['type', 'mode'].includes(key))
      || body.type !== 'simulation'
      || !['complete', 'fail'].includes(body.mode)) {
    return 'Expected only { "type": "simulation", "mode": "complete" | "fail" }';
  }
  return null;
}

export const isJobId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
