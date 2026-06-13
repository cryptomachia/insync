// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReenterTarget {
    function confirmReceipt(uint256 dealId, bytes calldata report) external;
}

/// @notice Malicious ERC20 (6 decimals, USDC-like) that attempts to re-enter the Escrow during
///         a payout `transfer`. Used to prove `nonReentrant` + checks-effects-interactions hold.
contract ReentrantToken is ERC20 {
    address public target;
    uint256 public attackDealId;
    bool public attackArmed;
    bool public reentered;

    constructor() ERC20("Reentrant USD", "rUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address _target, uint256 _dealId) external {
        target = _target;
        attackDealId = _dealId;
        attackArmed = true;
    }

    /// @dev On every transfer (i.e. an Escrow payout) try to re-enter confirmReceipt once.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attackArmed && from == target) {
            attackArmed = false; // single shot
            try IReenterTarget(target).confirmReceipt(attackDealId, "") {
                reentered = true; // should never happen
            } catch {
                // expected: ReentrancyGuard reverts the nested call.
            }
        }
    }
}
