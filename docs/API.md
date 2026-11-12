# API

## Escalate, the court (Intelligent Contract on GenLayer Bradbury)

`0x1A04EFFf53525738Bb6a5B01326E9BE88a20cf99`, source [`contracts/escalate.py`](../contracts/escalate.py). Every method
returns a JSON string.

| Method | Kind | Arguments | Returns |
|---|---|---|---|
| `arbitrate` | write, open to anybody | `assertion_id` (32 bytes hex) | `{"ok": true, "verdict": "TRUE" or "FALSE", "winner": "<asserter or disputer>"}` |
| `resend` | write, open to anybody | `assertion_id` | repeats a recorded ruling with no model if its message did not land; `{"ok": true}` |
| `case` | view | `assertion_id` | `assertion`, `verdict`, `why`, `sources`, `claim`, `asserter`, `disputer`, `bond`, `asserted_at`, `ruled_at`, `by`, `reason`, or `{"exists": false}` |
| `page` | view | `start`, `count` (at most 50) | rulings newest first: `{"total": n, "items": [...]}` |
| `manager_address` | view | none | the CourtEscalationManager the court rules on |

`arbitrate` refuses, changing nothing, when: the id is malformed; the court already ruled; the assertion was not
disputed or does not name the manager; the manager already holds a ruling; the claim's text has not been filed; or the
round returns no readable verdict. Each refusal is `{"ok": false, "error": "..."}`. A claim that cites no https source
is ruled FALSE without a round.

`arbitrate` and `resend` send a message to the manager, so the caller funds it. See [`SKILL.md`](../SKILL.md) for the
`messageAllocations` to pass.

`verdict` is agreed by the round. `why` is the leading judge's words, kept for the record. `reason` is
sha256 of `escalate|<assertion>|<verdict>`.

## CourtEscalationManager (GenLayer Chain, 4221)

`0x46574d6f1804a4BE27cbA7bEbA55B5e8880b51C5`, source [`evm/CourtEscalationManager.sol`](../evm/CourtEscalationManager.sol),
ABI in [`evm/abi/CourtEscalationManager.json`](../evm/abi/CourtEscalationManager.json). Extends UMA's
`BaseEscalationManager`.

To use it, name it as the `escalationManager` when you call UMA's `assertTruth` on the Optimistic Oracle V3
`0xe2c7f71B000fdc898feE10aC13f6558F891bB4E2`, and cite an https page that shows the fact in the claim.

| Function | Who | What |
|---|---|---|
| `fileClaim(assertionId, claim)` | anybody, once | stores the claim's text, only if it hashes with UMA's stored fields to the id |
| `rule(assertionId, truthful, reason)` | the court | records the price (1e18 true, 0 false) and settles the assertion on UMA's oracle |
| `getAssertionPolicy(id)` | view | arbitrate via this manager; never block, never discard UMA's result, no disputer allowlist |
| `requestPrice`, `assertionDisputedCallback` | UMA's oracle | open the court's case when an assertion is disputed |
| `getPrice(identifier, time, ancillaryData)` | view | the court's ruling, read by UMA's oracle when it settles |
| `facts(assertionId)` | view | `(disputed, ruled, filed, asserter, disputer, bond, assertionTime, settled)` |
| `claimText(assertionId)` | view | the filed claim |
| `cases(assertionId)`, `disputes(i)`, `disputeCount()`, `court`, `deployer` | view | public state |
| `setCourt(court)` | deployer, once | wiring at deployment |

Events: `ClaimFiled(assertionId, by)`, `Ruled(assertionId, truthful, reason, settled)`, `CourtSet(court)`, and UMA's
`PriceRequestAdded`.

Revert strings:

| String | When |
|---|---|
| `Escalate:only-court` | `rule()` from anyone but the court |
| `Escalate:not-disputed` | filing or ruling on an assertion UMA never reported disputed |
| `Escalate:already-filed` | a second `fileClaim` |
| `Escalate:claim-length` | an empty claim or one over 2000 bytes |
| `Escalate:claim-mismatch` | a text that does not hash to the assertion id |
| `Escalate:already-ruled` | a second `rule()` |
| `Escalate:no-claim` | `rule()` before the claim was filed |
| `Escalate:not-ruled` | UMA's oracle reading a price the court has not given |
| `Escalate:only-deployer`, `Escalate:court-set` | `setCourt` from a stranger, or after wiring |
| `Not the Optimistic Oracle V3` | an oracle callback from anyone but UMA's oracle |
