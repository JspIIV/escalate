// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "uma/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";

/**
 * @title NoDVM
 * @notice Stands where UMA's DVM would be registered in the Finder. There is no UMA token vote on GenLayer Chain, so a
 * dispute on an assertion that does not name the court's escalation manager has nowhere to go: it is refused, rather
 * than handed to an oracle somebody could answer at will.
 */
contract NoDVM is OracleAncillaryInterface {
    function requestPrice(bytes32, uint256, bytes memory) public pure override {
        revert("Escalate:no-dvm-name-the-court");
    }

    function hasPrice(bytes32, uint256, bytes memory) public pure override returns (bool) {
        return false;
    }

    function getPrice(bytes32, uint256, bytes memory) public pure override returns (int256) {
        revert("Escalate:no-dvm-name-the-court");
    }
}
