// Every guard of the deployed CourtEscalationManager, and the UMA oracle around it, exercised against the live
// contracts on GenLayer Chain, plus the gas the proof's own transactions used.
//
//   node scripts/manager_checks.mjs
//
// The guards are checked with eth_call, which runs the deployed bytecode against current chain state and lets the
// caller name any sender. That is how UMA's oracle, the court and the deployer are impersonated here: nothing is sent,
// nothing is signed, and no state changes. The targets are the assertions of the on chain proof in results/proved.json:
// A was disputed, filed and ruled TRUE; U was asserted and never disputed.
import { JsonRpcProvider, Interface, AbiCoder, keccak256, toUtf8Bytes, ZeroHash, id } from 'ethers';
import fs from 'fs';

const dep = JSON.parse(fs.readFileSync(new URL('../deployment.json', import.meta.url)));
const proved = JSON.parse(fs.readFileSync(new URL('../results/proved.json', import.meta.url)));
const abi = (n) => JSON.parse(fs.readFileSync(new URL(`../evm/abi/${n}.json`, import.meta.url)));
const provider = new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221, { staticNetwork: true });
const em = new Interface(abi('CourtEscalationManager'));
const oo = new Interface(abi('OptimisticOracleV3'));
const EM = dep.court_escalation_manager.address, OO = dep.optimistic_oracle_v3.address, COURT = dep.escalate.address;
const STRANGER = '0x000000000000000000000000000000000000dEaD';
const A = proved.ids.A, U = proved.ids.U;
const FRESH = keccak256(toUtf8Bytes('manager_checks: an assertion nobody made'));

async function call(to, from, data) {
  try { await provider.call({ from, to, data }); return 'ok'; }
  catch (e) {
    const raw = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    if (typeof raw === 'string' && raw.startsWith('0x08c379a0')) return AbiCoder.defaultAbiCoder().decode(['string'], '0x' + raw.slice(10))[0];
    const m = String(e?.shortMessage ?? e?.message ?? e).match(/(Escalate:[\w-]+|Not the Optimistic Oracle V3|Assertion already settled|Assertion not expired)/);
    return m ? m[0] : 'reverted (' + (raw ?? e?.shortMessage ?? 'no data') + ')';
  }
}
const read = async (to, iface, fn, args = []) => iface.decodeFunctionResult(fn, await provider.call({ to, data: iface.encodeFunctionData(fn, args) }));

const results = [];
function check(label, got, want) {
  const ok = want instanceof RegExp ? want.test(String(got)) : got === want;
  results.push({ label, got: String(got), ok });
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '   got: ' + got));
}

const court = (await read(EM, em, 'court'))[0];
const deployer = (await provider.getTransaction(dep.court_escalation_manager.tx)).from;
console.log('CourtEscalationManager', EM, '| UMA OptimisticOracleV3', OO, '| court', court, '\n');

console.log('who may rule');
check('the court named in the manager is the Escalate contract', court.toLowerCase(), COURT.toLowerCase());
check('a stranger calling rule() is refused', await call(EM, STRANGER, em.encodeFunctionData('rule', [A, false, ZeroHash])), 'Escalate:only-court');
check('the deployer calling rule() is refused', await call(EM, deployer, em.encodeFunctionData('rule', [A, false, ZeroHash])), 'Escalate:only-court');
check('UMA\'s oracle calling rule() is refused', await call(EM, OO, em.encodeFunctionData('rule', [A, false, ZeroHash])), 'Escalate:only-court');
check('the court cannot rule twice: assertion A, already ruled, is refused', await call(EM, court, em.encodeFunctionData('rule', [A, false, ZeroHash])), 'Escalate:already-ruled');
check('the court cannot rule on an assertion nobody disputed (U)', await call(EM, court, em.encodeFunctionData('rule', [U, true, ZeroHash])), 'Escalate:not-disputed');
check('the court cannot rule on an assertion that does not exist', await call(EM, court, em.encodeFunctionData('rule', [FRESH, true, ZeroHash])), 'Escalate:not-disputed');

console.log('\nwhat the court reads');
check('a claim cannot be filed twice: A already holds its text', await call(EM, STRANGER, em.encodeFunctionData('fileClaim', [A, toUtf8Bytes('A different claim. Source: https://example.com')])), 'Escalate:already-filed');
check('a claim cannot be filed for an assertion nobody disputed', await call(EM, STRANGER, em.encodeFunctionData('fileClaim', [U, toUtf8Bytes('anything')])), 'Escalate:not-disputed');
const facts = await read(EM, em, 'facts', [A]);
check('the text filed for A is the one UMA hashed into its id', keccak256(toUtf8Bytes((await read(EM, em, 'claimText', [A]))[0])) !== ZeroHash && facts[2] === true, true);

console.log('\nwho may talk to the manager as UMA');
check('a stranger posing as the oracle cannot open a price request', await call(EM, STRANGER, em.encodeFunctionData('requestPrice', [id('ASSERT_TRUTH'), 1n, '0x'])), 'Not the Optimistic Oracle V3');
check('a stranger cannot report a dispute', await call(EM, STRANGER, em.encodeFunctionData('assertionDisputedCallback', [FRESH])), 'Not the Optimistic Oracle V3');
check('a price nobody ruled on cannot be read', await call(EM, STRANGER, em.encodeFunctionData('getPrice', [id('ASSERT_TRUTH'), 1n, '0x'])), 'Escalate:not-ruled');
const pol = await read(EM, em, 'getAssertionPolicy', [A]);
check('policy: the manager arbitrates, never blocks an assertion, never discards UMA\'s result', `${pol[0].blockAssertion} ${pol[0].arbitrateViaEscalationManager} ${pol[0].discardOracle}`, 'false true false');

console.log('\nwho may change the court');
check('setCourt again from the deployer is refused', await call(EM, deployer, em.encodeFunctionData('setCourt', [STRANGER])), 'Escalate:court-set');
check('setCourt from a stranger is refused', await call(EM, STRANGER, em.encodeFunctionData('setCourt', [STRANGER])), 'Escalate:only-deployer');

console.log('\nUMA\'s oracle after the ruling');
check('assertion A is settled on UMA\'s oracle, as the court ruled', `${facts[1]} ${facts[7]}`, 'true true');
check('settling A again on UMA\'s oracle is refused', await call(OO, STRANGER, oo.encodeFunctionData('settleAssertion', [A])), /Assertion already settled|reverted/);

console.log('\ngas used on GenLayer Chain');
const gas = [];
for (const t of proved.evm) {
  const r = await provider.getTransactionReceipt(t.hash);
  if (r) gas.push({ what: t.label, hash: t.hash, gas: Number(r.gasUsed) });
}
const logs = await provider.getLogs({ address: EM, topics: [id('Ruled(bytes32,bool,bytes32,bool)'), A], fromBlock: 0, toBlock: 'latest' }).catch(() => []);
for (const l of logs) { const r = await provider.getTransactionReceipt(l.transactionHash); gas.push({ what: "GenLayer's finalization transaction that carried the court's rule() on A, settlement on UMA included", hash: l.transactionHash, gas: Number(r.gasUsed) }); }
for (const g of gas) console.log('  ' + String(g.gas).padStart(8) + '  ' + g.what);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks against the deployed CourtEscalationManager and UMA's oracle.`);
fs.writeFileSync(new URL('../results/manager_checks.json', import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), manager: EM, court, results, gas }, null, 1));
process.exit(passed === results.length ? 0 : 1);
