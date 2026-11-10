// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A test dollar for bonds on GenLayer Chain. Worth nothing; anybody may mint up to 1000 at a time.
contract TestUSD is ERC20 {
    constructor() ERC20("Escalate Test Dollar", "tUSD") {}

    function mint(uint256 amount) external {
        require(amount <= 1000e18, "TestUSD:at-most-1000");
        _mint(msg.sender, amount);
    }
}
