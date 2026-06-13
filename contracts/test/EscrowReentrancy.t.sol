// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// @notice Proves money-moving fns are reentrancy-safe. The malicious token tries to re-enter
///         confirmReceipt during a payout transfer; ReentrancyGuard + CEI must block it, and
///         the deal must still settle correctly exactly once.
contract EscrowReentrancyTest is Test {
    Escrow internal escrow;
    ReentrantToken internal token; // 6 decimals, used as the stable token

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");

    uint256 internal constant PRICE = 80_00000000;
    uint16 internal constant DEPOSIT_BPS = 1000;
    uint256 internal constant PRICE_UNITS = 80_000000;
    uint256 internal constant DEPOSIT_UNITS = 8_000000;
    uint256 internal constant TOTAL = 88_000000;

    function setUp() public {
        token = new ReentrantToken();
        // Use the reentrant token AS the stable token so confirmReceipt takes the no-oracle path
        // and the payout transfer triggers the reentrancy attempt.
        escrow = new Escrow(address(token), address(0), address(0));
        token.mint(buyer, 1_000_000000);
    }

    function test_ConfirmReceipt_ReentrancyBlocked() public {
        vm.prank(seller);
        uint256 listingId = escrow.list(PRICE, DEPOSIT_BPS, address(token));

        vm.startPrank(buyer);
        token.approve(address(escrow), TOTAL);
        uint256 dealId = escrow.fund(listingId, TOTAL, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        // Arm the token to re-enter on the first transfer FROM the escrow.
        token.arm(address(escrow), dealId);

        vm.prank(buyer);
        escrow.confirmReceipt(dealId, "");

        // The nested re-entry must have failed (caught), state settled exactly once.
        assertFalse(token.reentered(), "reentrancy should be blocked");
        assertEq(token.balanceOf(seller), PRICE_UNITS);
        assertEq(token.balanceOf(buyer), 1_000_000000 - TOTAL + DEPOSIT_UNITS);
        assertEq(token.balanceOf(address(escrow)), 0);

        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Completed));
    }
}
