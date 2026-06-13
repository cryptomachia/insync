// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 (6 decimals, USDC-like) that burns a fixed basis-point fee on every transfer,
///         so the recipient receives less than `amount`. Used to prove the Escrow records the
///         *actual* received balance at fund time and never strands funds (no over-credit).
contract FeeOnTransferToken is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 _feeBps) ERC20("Fee USD", "fUSDC") {
        feeBps = _feeBps;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Burns `feeBps` of every transfer so `to` receives `amount - fee`.
    function _update(address from, address to, uint256 value) internal override {
        // Mints (from == 0) are not taxed so test setup balances are exact.
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        super._update(from, address(0), fee); // burn the fee
    }
}
