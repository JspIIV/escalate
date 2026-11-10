// Compiles UMA's Optimistic Oracle V3 and its infrastructure (vendor/uma, unmodified, AGPL-3.0) and Escalate's own EVM
// contracts with UMA's settings: solc 0.8.16, optimizer on, 1,000,000 runs (packages/common/src/HardhatConfig.ts).
// The compiler is the official soljson build, checked against binaries.soliditylang.org (sha256 27b2820e...).
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import url from 'url';

const require = createRequire(import.meta.url);
export const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const solc = require('solc/wrapper')(require(path.join(ROOT, 'tools', 'soljson-v0.8.16.cjs')));
const UMA = path.join(ROOT, 'vendor', 'uma', 'packages', 'core', 'contracts');
const OZ = path.join(ROOT, 'node_modules', '@openzeppelin', 'contracts');
export const SETTINGS = { optimizer: { enabled: true, runs: 1000000 } };

export const SOURCES = {
  Finder: 'uma/data-verification-mechanism/implementation/Finder.sol',
  IdentifierWhitelist: 'uma/data-verification-mechanism/implementation/IdentifierWhitelist.sol',
  AddressWhitelist: 'uma/common/implementation/AddressWhitelist.sol',
  Store: 'uma/data-verification-mechanism/implementation/Store.sol',
  OptimisticOracleV3: 'uma/optimistic-oracle-v3/implementation/OptimisticOracleV3.sol',
  NoDVM: 'evm/NoDVM.sol',
  TestUSD: 'evm/TestUSD.sol',
  CourtEscalationManager: 'evm/CourtEscalationManager.sol',
};

function resolve(p) {
  if (p.startsWith('uma/')) return path.join(UMA, p.slice(4));
  if (p.startsWith('@openzeppelin/contracts/')) return path.join(OZ, p.slice('@openzeppelin/contracts/'.length));
  if (p.startsWith('evm/')) return path.join(ROOT, p);
  return path.join(ROOT, p);
}
function findImport(p) {
  const f = resolve(p);
  return fs.existsSync(f) ? { contents: fs.readFileSync(f, 'utf8') } : { error: 'not found: ' + p };
}

const cache = {};
export function compile(name) {
  if (cache[name]) return cache[name];
  const file = SOURCES[name];
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { [file]: { content: findImport(file).contents } },
    settings: { ...SETTINGS, outputSelection: { [file]: { [name]: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } },
  }), { import: findImport }));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts[file][name];
  cache[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, deployed: c.evm.deployedBytecode.object.toLowerCase(),
    refs: c.evm.deployedBytecode.immutableReferences || {}, version: solc.version() };
  return cache[name];
}

if (process.argv[1] && process.argv[1].endsWith('compile.mjs')) {
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  for (const n of (process.argv[2] ? process.argv.slice(2) : Object.keys(SOURCES))) {
    const c = compile(n);
    fs.writeFileSync(path.join(ROOT, 'evm', 'abi', n + '.json'), JSON.stringify(c.abi, null, 2));
    console.log(n.padEnd(26), (c.bytecode.length - 2) / 2, 'bytes', c.version);
  }
}
