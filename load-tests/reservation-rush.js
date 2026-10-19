import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Run against a loopback development backend. Every run creates a new flow;
// existing queues, reservations, and durable allocations are never reset.
const base = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const buyers = Math.min(1000, Math.max(1, Number(__ENV.BUYERS || 40)));
const capacity = Math.min(1000, Math.max(1, Number(__ENV.CAPACITY || 20)));
const confirmed = new Counter('confirmed_allocations');
const soldOut = new Counter('sold_out_participants');
const journeyTime = new Trend('participant_journey_ms');
const headers = { 'Content-Type': 'application/json' };

export const options = {
  scenarios: { rush: { executor: 'per-vu-iterations', vus: buyers, iterations: 1, maxDuration: '2m' } },
  thresholds: { checks: ['rate>0.99'], http_req_failed: ['rate<0.01'] },
};
http.setResponseCallback(http.expectedStatuses(200, 201, 204, 409));

function post(path, body) {
  return http.post(`${base}${path}`, body == null ? null : JSON.stringify(body), { headers });
}
function requireOk(response, label) {
  if (!check(response, { [label]: r => r.status === 200 || r.status === 201 })) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  return response.json();
}
export function setup() {
  const flow = `bench-${Date.now()}`;
  requireOk(post(`/api/pools/${flow}/init?prefix=unit&totalUnits=${capacity}`), 'isolated flow created');
  requireOk(http.put(`${base}/api/flows/${flow}/policy`, JSON.stringify({
    maxConcurrent: 10, admissionRate: 10, holdSeconds: 30, adaptive: true,
  }), { headers }), 'admission policy configured');
  requireOk(post(`/api/flows/${flow}/scenario`, { mode: 'NORMAL' }), 'normal backend selected');
  console.log(`External HTTP test flow: ${flow}; ${buyers} participants; ${capacity} resources.`);
  return { flow };
}
export default function ({ flow }) {
  const started = Date.now();
  const person = requireOk(post(`/api/flows/${flow}/sessions`), 'participant session issued');
  const credentials = `userId=${encodeURIComponent(person.claimantId)}&sessionToken=${encodeURIComponent(person.sessionToken)}`;
  requireOk(post(`/api/waiting-room/${flow}/join?${credentials}`), 'participant joined');
  let status;
  for (let attempt = 0; attempt < 300; attempt++) {
    status = requireOk(http.get(`${base}/api/waiting-room/${flow}/status?${credentials}`), 'queue status readable');
    if (status.admitted || ['SOLD_OUT', 'CLOSED'].includes(status.status)) break;
    sleep(0.25);
  }
  if (!status.admitted) {
    soldOut.add(1);
    check(status, { 'waiting ended with explicit exhausted inventory': s => ['SOLD_OUT', 'CLOSED'].includes(s.status) });
    return;
  }

  let hold;
  let request;
  for (let attempt = 0; attempt < capacity; attempt++) {
    const unitId = `unit-${String(((__VU + attempt - 1) % capacity) + 1).padStart(2, '0')}`;
    request = { claimantId: person.claimantId, admissionToken: status.admissionToken, unitId };
    hold = post(`/api/pools/${flow}/hold?sessionToken=${encodeURIComponent(person.sessionToken)}`, request);
    if (hold.status === 200) break;
    if (hold.status !== 409) { requireOk(hold, 'hold request handled'); return; }
  }
  if (!hold || hold.status !== 200) {
    // Admission is permission to attempt a reservation, not a promise of stock.
    soldOut.add(1);
    return;
  }
  const first = requireOk(post(`/api/pools/${flow}/confirm?sessionToken=${encodeURIComponent(person.sessionToken)}`, request), 'allocation confirmed');
  const retry = requireOk(post(`/api/pools/${flow}/confirm?sessionToken=${encodeURIComponent(person.sessionToken)}`, request), 'confirmation retry succeeded');
  check(retry, { 'confirmation retry returns the same durable allocation': result => result.allocationId === first.allocationId });
  confirmed.add(1);
  journeyTime.add(Date.now() - started);
}
export function teardown({ flow }) {
  const inventory = requireOk(http.get(`${base}/api/pools/${flow}/units`), 'final inventory readable');
  const settled = inventory.filter(unit => unit.status === 'CONFIRMED');
  check(inventory, {
    'catalog size remains configured': list => list.length === capacity,
    'confirmed resources do not exceed inventory': () => settled.length <= capacity,
    'resource identifiers are unique': list => new Set(list.map(unit => unit.unitId)).size === capacity,
  });
  console.log(`Flow ${flow}: ${settled.length}/${capacity} resources confirmed. Ledger retained for inspection.`);
}
