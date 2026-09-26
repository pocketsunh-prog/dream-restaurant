// 臨時除錯：印出開店後若干小時的狀態分佈（JS 參照）
import { createNewGame } from '../src/core/state.js';
import { reduce } from '../src/core/actions.js';
import { stepSimulation, spawnRate, availability } from '../src/sim/simulation.js';
import { dishesForStars } from '../src/data/dishes.js';

const state = createNewGame(20240101);
const extra = dishesForStars(state.stars).filter((d) => !state.menu.some((m) => m.dishId === d.id)).slice(0, 4);
for (const d of extra) reduce(state, { type: 'MENU_ADD', dishId: d.id });
for (const p of [{ x: 3, y: 10 }, { x: 20, y: 10 }]) reduce(state, { type: 'PLACE_FURNITURE', typeId: 'table_2a', x: p.x, y: p.y });
for (const cand of state.candidates.slice(0, 3)) { const r = reduce(state, { type: 'HIRE', candidateId: cand.candidateId }); if (!r.ok) break; }
for (const st of state.staff) {
  reduce(state, { type: 'SET_SHIFT', uid: st.uid, start: 600, end: 1380 });
  reduce(state, { type: 'SET_DUTY', uid: st.uid, duty: 'cleanFloor', on: true });
  reduce(state, { type: 'SET_DUTY', uid: st.uid, duty: 'cleanRestroom', on: true });
}
reduce(state, { type: 'SET_DUTY', uid: state.staff[0].uid, duty: 'cashier', on: true });
console.log('open =', JSON.stringify(reduce(state, { type: 'START_DAY' })));

function countSorted(arr) {
  const m = {};
  for (const v of arr) m[v] = (m[v] || 0) + 1;
  return Object.keys(m).sort().map((k) => `${k}:${m[k]}`).join(',');
}

function dump(tag) {
  const cust = countSorted(state.sim.customers.map((c) => c.state));
  const tasks = countSorted(state.sim.tasks.map((t) => t.kind + (t.stage ? ':' + t.stage : '')));
  const tids = state.sim.tasks.map((t) => `${t.id}:${t.kind}:${t.stage || '-'}:${t.claimedBy || '-'}`).join(',');
  const staff = state.staff.map((s) => `${s.role}/${s.state}/${s.task || '-'}/${s.x},${s.y}/${s.pathIndex}/${s.path.length}/${s.working}`).join(' ');
  const custDetail = state.sim.customers.map((c) => `${c.state}/${c.x.toFixed(3)},${c.y.toFixed(3)}/${c.pathIndex}/${c.path.length}/${c.tableUid || '-'}/${c.queueTarget ? c.queueTarget.x.toFixed(3) + ',' + c.queueTarget.y.toFixed(3) : '-'}/${(c.path || []).map((p) => `${p.x},${p.y}`).join('|')}`).join(' ');
  const kitD = state.sim.kitchen.map((k) => `${k.id}:${Number(k.remaining.toFixed(4))}:${k.customerUid}:${k.dishId}:${k.chefUid || '-'}`).join(',');
  const passD = state.sim.pass.map((p) => `${p.id}:${p.customerUid}`).join(',');
  console.log(`T ${tag} cust=[${cust}] task=[${tasks}] kit=${state.sim.kitchen.length} pass=${state.sim.pass.length}` +
    ` kitD=[${kitD}] passD=[${passD}] chef=${state.staff.filter((s) => s.role === 'chef').map((s) => `sk${s.skill ?? 50}|sm${Number(s.speedMod).toFixed(6)}|fat${Number(s.fatigue).toFixed(3)}|sp${s.speed ?? 50}`).join(';')}` +
    ` staff=[${staff}] custD=[${custDetail}] tids=[${tids}]` +
    ` F rng=${state.rng} g=${state.stats.today.guests} s=${state.stats.today.served} a=${state.stats.today.angry} sp=${state.sim.customersSpawned} acc=${state.sim.spawnAccumulator.toFixed(6)} evT=${state.sim.eventTimer}`);
  const custJ = {};
  for (const c of state.sim.customers) custJ[c.state] = (custJ[c.state] || 0) + 1;
  const tasksJ = {};
  for (const t of state.sim.tasks) tasksJ[t.kind + (t.stage ? ':' + t.stage : '')] = (tasksJ[t.kind + (t.stage ? ':' + t.stage : '')] || 0) + 1;
  const staffJ = {};
  for (const s of state.staff) staffJ[s.role + ':' + s.state + (s.task ? ':' + s.task : '')] = (staffJ[s.role + ':' + s.state + (s.task ? ':' + s.task : '')] || 0) + 1;
  console.log(`[${tag}] minute=${state.minute} phase=${state.phase}`);
  console.log('  customers', JSON.stringify(custJ));
  console.log('  tasks', JSON.stringify(tasksJ));
  console.log('  staff', JSON.stringify(staffJ));
  console.log('  kitchen', state.sim.kitchen.length, 'pass', state.sim.pass.length,
    'stock', JSON.stringify(state.menu.map((m) => state.stock[m.dishId] || 0)));
  console.log('  tables', state.sim.tables.map((t) => `${t.uid}:${t.state}:occ${t.occupants.length}:${t.usable ? 'U' : '-'}`).join(' '));
  console.log('  flow', JSON.stringify({
    guests: state.stats.today.guests, served: state.stats.today.served, angry: state.stats.today.angry,
    spawned: state.sim.customersSpawned, spawnAcc: Number(state.sim.spawnAccumulator.toFixed(3)),
    rng: state.rng, evT: state.sim.eventTimer, traffic: state.sim.trafficMul,
    walkers: state.sim.walkers.length,
    repC: state.reputation.community, repO: state.reputation.outside,
    mood: Number((state.stats.today.moodSum / Math.max(1, state.stats.today.moodCount)).toFixed(2)),
    wait: state.stats.today.waitCount
  }));
  const av = availability(state);
  console.log('  rate', JSON.stringify({
    rate: Number(spawnRate(state).toFixed(6)), free: av.freeSeats, waiting: av.waiting,
    fame: state.fame, stars: state.stars, dec: state.stats.today.decorations,
    weather: state.sim.weather, hour: null, traffic: state.sim.trafficMul
  }));
}

dump('0m');
for (let i = 1; i <= 6; i++) {
  stepSimulation(state, 5);
  dump('tick' + i);
}
for (const [mins, tag] of [[30, '30m'], [60, '1h'], [120, '2h'], [240, '4h']]) {
  while (state.minute < 11 * 60 + mins) stepSimulation(state, 5);
  dump(tag);
}
