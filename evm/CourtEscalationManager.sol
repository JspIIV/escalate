// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "uma/optimistic-oracle-v3/implementation/escalation-manager/BaseEscalationManager.sol";

/**
 * @title CourtEscalationManager
 * @notice An escalation manager for UMA's Optimistic Oracle V3 whose arbitrator is Internet Court on GenLayer.
 *
 * An assertion that names this manager is arbitrated here instead of by the UMA DVM. Assertions that are never disputed
 * settle exactly as UMA intends, after their liveness, and the court never sees them. When one is disputed:
 *
 *   1. the Optimistic Oracle V3 asks this manager for a price and tells it which assertion was disputed;
 *   2. anybody files the claim's text with fileClaim(). The manager recomputes the assertion id from that text and the
 *      fields the oracle stored, so only the exact text that was asserted is ever accepted;
 *   3. the court, an Intelligent Contract on GenLayer, reads the claim and the sources it cites, and when its verdict is
 *      final it calls rule() here itself, through its Ghost on GenLayer Chain. No relayer, no key, no owner;
 *   4. rule() records the price (1e18 for true, 0 for false, as the DVM would) and settles the assertion on the oracle
 *      in the same call, so the bonds move at once. If settling fails for any reason, anybody can settle later.
 *
 * Only the court can rule, only on a disputed assertion, and only once.
 */
contract CourtEscalationManager is BaseEscalationManager {
    struct Case {
        bool disputed; // the oracle reported a dispute for this assertion
        bool ruled; // the court has ruled
        bool truthful; // the court's ruling: the assertion was true
        bytes32 reason; // the court's reference for its ruling
        bytes32 request; // key of the oracle's price request for this assertion
    }

    int256 public constant TRUE_PRICE = 1e18;
    uint256 public constant MAX_CLAIM = 2000;

    address public immutable deployer;
    address public court;

    mapping(bytes32 => Case) public cases;
    mapping(bytes32 => bytes) internal claims;
    mapping(bytes32 => bool) public requested;
    mapping(bytes32 => bool) public answered;
    mapping(bytes32 => int256) internal prices;
    bytes32[] public disputes;
    bytes32 private lastRequest;

    event CourtSet(address court);
    event ClaimFiled(bytes32 indexed assertionId, address indexed by);
    event Ruled(bytes32 indexed assertionId, bool truthful, bytes32 reason, bool settled);

    constructor(address _optimisticOracleV3) BaseEscalationManager(_optimisticOracleV3) {
        deployer = msg.sender;
    }

    /// @notice Names the court, once. After this nobody, the deployer included, can change it.
    function setCourt(address _court) external {
        require(msg.sender == deployer, "Escalate:only-deployer");
        require(court == address(0) && _court != address(0), "Escalate:court-set");
        court = _court;
        emit CourtSet(_court);
    }

    /// @notice Every assertion that names this manager is arbitrated by it, and the oracle's result is respected.
    function getAssertionPolicy(bytes32) public pure override returns (AssertionPolicy memory) {
        return AssertionPolicy({ blockAssertion: false, arbitrateViaEscalationManager: true, discardOracle: false, validateDisputers: false });
    }

    function requestPrice(bytes32 identifier, uint256 time, bytes memory ancillaryData) public override onlyOptimisticOracleV3 {
        bytes32 key = keccak256(abi.encode(identifier, time, ancillaryData));
        requested[key] = true;
        lastRequest = key; // the oracle calls assertionDisputedCallback next, in the same dispute
        emit PriceRequestAdded(identifier, time, ancillaryData);
    }

    function assertionDisputedCallback(bytes32 assertionId) public override onlyOptimisticOracleV3 {
        Case storage c = cases[assertionId];
        c.disputed = true;
        c.request = lastRequest;
        lastRequest = bytes32(0);
        disputes.push(assertionId);
    }

    /**
     * @notice Files the text of a disputed assertion. Anybody may call it; the text is accepted only if it hashes, with
     * the fields the oracle stored, to the assertion id. So the court always reads what was really asserted.
     */
    function fileClaim(bytes32 assertionId, bytes calldata claim) external {
        require(cases[assertionId].disputed, "Escalate:not-disputed");
        require(claims[assertionId].length == 0, "Escalate:already-filed");
        require(claim.length > 0 && claim.length <= MAX_CLAIM, "Escalate:claim-length");
        OptimisticOracleV3Interface.Assertion memory a = optimisticOracleV3.getAssertion(assertionId);
        bytes32 id = keccak256(
            abi.encode(
                claim,
                a.bond,
                uint256(a.assertionTime),
                a.expirationTime - a.assertionTime,
                a.currency,
                a.callbackRecipient,
                a.escalationManagerSettings.escalationManager,
                a.identifier,
                a.escalationManagerSettings.assertingCaller
            )
        );
        require(id == assertionId, "Escalate:claim-mismatch");
        claims[assertionId] = claim;
        emit ClaimFiled(assertionId, msg.sender);
    }

    /// @notice The court's ruling. Records the price the oracle will read, then settles the assertion on the oracle.
    function rule(bytes32 assertionId, bool truthful, bytes32 reason) external {
        require(msg.sender == court, "Escalate:only-court");
        Case storage c = cases[assertionId];
        require(c.disputed, "Escalate:not-disputed");
        require(!c.ruled, "Escalate:already-ruled");
        require(claims[assertionId].length > 0, "Escalate:no-claim");
        c.ruled = true;
        c.truthful = truthful;
        c.reason = reason;
        answered[c.request] = true;
        prices[c.request] = truthful ? TRUE_PRICE : int256(0);
        bool settled = true;
        try optimisticOracleV3.settleAssertion(assertionId) {} catch {
            settled = false;
        }
        emit Ruled(assertionId, truthful, reason, settled);
    }

    function getPrice(bytes32 identifier, uint256 time, bytes memory ancillaryData) public view override returns (int256) {
        bytes32 key = keccak256(abi.encode(identifier, time, ancillaryData));
        require(answered[key], "Escalate:not-ruled");
        return prices[key];
    }

    // ------------------------------------------------------------------ reads, flat for any caller

    function claimText(bytes32 assertionId) external view returns (string memory) {
        return string(claims[assertionId]);
    }

    /// @notice What the court needs about an assertion, in one call: its state here and its parties on the oracle.
    function facts(bytes32 assertionId)
        external
        view
        returns (bool disputed, bool ruled, bool filed, address asserter, address disputer, uint256 bond, uint64 assertionTime, bool settled)
    {
        Case storage c = cases[assertionId];
        OptimisticOracleV3Interface.Assertion memory a = optimisticOracleV3.getAssertion(assertionId);
        return (c.disputed, c.ruled, claims[assertionId].length > 0, a.asserter, a.disputer, a.bond, a.assertionTime, a.settled);
    }

    function disputeCount() external view returns (uint256) {
        return disputes.length;
    }
}
