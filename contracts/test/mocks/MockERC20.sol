// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal mintable ERC20 with a configurable decimals value, for tests and local anvil.
///         Deploy with decimals=6 for a USDC stand-in, decimals=18 for a WETH stand-in.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open mint for tests / local faucet usage.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
