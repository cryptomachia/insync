// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Reputation} from "../src/Reputation.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ReputationTest is Test {
    Reputation internal rep;

    address internal owner = makeAddr("owner");
    // The escrow is just a plain test address (no real Escrow.sol in this clone).
    address internal escrow = makeAddr("escrow");
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal stranger = makeAddr("stranger");

    event EscrowSet(address indexed escrow);

    function setUp() public {
        vm.prank(owner);
        rep = new Reputation(owner);
    }

    // --- setEscrow access & once-only -------------------------------------------------

    function test_OwnerIsConstructorArg() public view {
        assertEq(rep.owner(), owner);
    }

    function test_SetEscrow_byOwner_emitsAndStores() public {
        vm.expectEmit(true, false, false, true, address(rep));
        emit EscrowSet(escrow);
        vm.prank(owner);
        rep.setEscrow(escrow);
        assertEq(rep.escrow(), escrow);
    }

    function test_SetEscrow_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rep.setEscrow(escrow);
    }

    function test_SetEscrow_revertsOnSecondCall() public {
        vm.prank(owner);
        rep.setEscrow(escrow);

        vm.expectRevert(Reputation.EscrowAlreadySet.selector);
        vm.prank(owner);
        rep.setEscrow(makeAddr("escrow2"));
    }

    function test_SetEscrow_revertsOnZeroAddress() public {
        vm.expectRevert(Reputation.ZeroAddress.selector);
        vm.prank(owner);
        rep.setEscrow(address(0));
    }

    // --- hook access control ----------------------------------------------------------

    function test_Hooks_revertWhenCallerNotEscrow() public {
        _wireEscrow();

        vm.startPrank(stranger);
        vm.expectRevert(Reputation.NotEscrow.selector);
        rep.onCompleted(buyer, seller);

        vm.expectRevert(Reputation.NotEscrow.selector);
        rep.onBuyerFlake(buyer, seller);

        vm.expectRevert(Reputation.NotEscrow.selector);
        rep.onSellerNoShow(buyer, seller);

        vm.expectRevert(Reputation.NotEscrow.selector);
        rep.onMutualCancel(buyer, seller);
        vm.stopPrank();
    }

    function test_Hooks_revertWhenEscrowUnset() public {
        // escrow defaults to address(0); even the owner is not the escrow.
        vm.expectRevert(Reputation.NotEscrow.selector);
        vm.prank(owner);
        rep.onCompleted(buyer, seller);
    }

    // --- counter / score updates ------------------------------------------------------

    function test_OnCompleted_creditsBothAndScores() public {
        _wireEscrow();
        vm.prank(escrow);
        rep.onCompleted(buyer, seller);

        _assertStats(buyer, 1, 0, 0, 0);
        _assertStats(seller, 1, 0, 0, 0);
        assertEq(rep.scoreOf(buyer), 10);
        assertEq(rep.scoreOf(seller), 10);
    }

    function test_OnBuyerFlake_penalisesOnlyBuyer() public {
        _wireEscrow();
        vm.prank(escrow);
        rep.onBuyerFlake(buyer, seller);

        _assertStats(buyer, 0, 1, 0, 0);
        _assertStats(seller, 0, 0, 0, 0);
        assertEq(rep.scoreOf(buyer), 0); // floored, no completions to offset
        assertEq(rep.scoreOf(seller), 0);
    }

    function test_OnSellerNoShow_penalisesOnlySeller() public {
        _wireEscrow();
        vm.prank(escrow);
        rep.onSellerNoShow(buyer, seller);

        _assertStats(buyer, 0, 0, 0, 0);
        _assertStats(seller, 0, 0, 1, 0);
        assertEq(rep.scoreOf(seller), 0); // floored
    }

    function test_OnMutualCancel_recordsBothNeutralScore() public {
        _wireEscrow();
        vm.prank(escrow);
        rep.onMutualCancel(buyer, seller);

        _assertStats(buyer, 0, 0, 0, 1);
        _assertStats(seller, 0, 0, 0, 1);
        // mutual cancels do not move the score
        assertEq(rep.scoreOf(buyer), 0);
        assertEq(rep.scoreOf(seller), 0);
    }

    function test_Score_completionsOffsetPenalties() public {
        _wireEscrow();
        vm.startPrank(escrow);
        // buyer: 2 completed (+20), 1 flake (-15) => 5
        rep.onCompleted(buyer, seller);
        rep.onCompleted(buyer, seller);
        rep.onBuyerFlake(buyer, seller);
        vm.stopPrank();

        _assertStats(buyer, 2, 1, 0, 0);
        assertEq(rep.scoreOf(buyer), 5);
    }

    function test_Score_flooredAtZeroWhenPenaltiesDominate() public {
        _wireEscrow();
        vm.startPrank(escrow);
        // 1 completed (+10) but 2 flakes (-30) => floored 0, no underflow
        rep.onCompleted(buyer, seller);
        rep.onBuyerFlake(buyer, seller);
        rep.onBuyerFlake(buyer, seller);
        vm.stopPrank();

        _assertStats(buyer, 1, 2, 0, 0);
        assertEq(rep.scoreOf(buyer), 0);
    }

    function test_Score_sellerNoShowAlsoPenalises() public {
        _wireEscrow();
        vm.startPrank(escrow);
        // seller: 3 completed (+30), 1 no-show (-15) => 15
        rep.onCompleted(buyer, seller);
        rep.onCompleted(buyer, seller);
        rep.onCompleted(buyer, seller);
        rep.onSellerNoShow(buyer, seller);
        vm.stopPrank();

        _assertStats(seller, 3, 0, 1, 0);
        assertEq(rep.scoreOf(seller), 15);
    }

    function test_FreshAddressIsZero() public view {
        _assertStats(stranger, 0, 0, 0, 0);
        assertEq(rep.scoreOf(stranger), 0);
    }

    // --- fuzz: score never underflows and matches the documented formula --------------

    function testFuzz_Score(uint8 completed, uint8 flakes, uint8 noShows, uint8 mutuals) public {
        _wireEscrow();
        vm.startPrank(escrow);
        for (uint256 i = 0; i < completed; i++) {
            rep.onCompleted(buyer, seller);
        }
        for (uint256 i = 0; i < flakes; i++) {
            rep.onBuyerFlake(buyer, seller);
        }
        for (uint256 i = 0; i < noShows; i++) {
            rep.onSellerNoShow(buyer, seller); // penalises seller, not buyer
        }
        for (uint256 i = 0; i < mutuals; i++) {
            rep.onMutualCancel(buyer, seller);
        }
        vm.stopPrank();

        // buyer accrues completed + flakes + mutuals (no-show penalises the seller).
        uint256 positive = uint256(completed) * 10;
        uint256 negative = uint256(flakes) * 15;
        uint256 expected = positive > negative ? positive - negative : 0;
        assertEq(rep.scoreOf(buyer), expected);

        (uint256 c, uint256 f, uint256 ns, uint256 mc) = rep.statsOf(buyer);
        assertEq(c, completed);
        assertEq(f, flakes);
        assertEq(ns, 0); // buyer is never the no-show party in onSellerNoShow
        assertEq(mc, mutuals);
    }

    // --- helpers ----------------------------------------------------------------------

    function _wireEscrow() internal {
        vm.prank(owner);
        rep.setEscrow(escrow);
    }

    function _assertStats(
        address who,
        uint256 expCompleted,
        uint256 expFlakes,
        uint256 expNoShows,
        uint256 expMutuals
    ) internal view {
        (uint256 c, uint256 f, uint256 ns, uint256 mc) = rep.statsOf(who);
        assertEq(c, expCompleted, "completed");
        assertEq(f, expFlakes, "buyerFlakes");
        assertEq(ns, expNoShows, "sellerNoShows");
        assertEq(mc, expMutuals, "mutualCancels");
    }
}
