// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockReputation} from "./mocks/MockReputation.sol";

/// @notice Core stable-path tests: lifecycle, the full SPEC §4 cancellation table,
///         access control, state guards, and reputation hooks.
contract EscrowTest is Test {
    Escrow internal escrow;
    MockERC20 internal usdc; // 6 decimals
    MockVerifier internal verifier;
    MockReputation internal rep;

    address internal owner = address(this);
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    // $80.00 with 8 decimals.
    uint256 internal constant PRICE = 80_00000000;
    uint16 internal constant DEPOSIT_BPS = 1000; // 10%

    // USDC units: price = 80e6, deposit = 8e6, total = 88e6.
    uint256 internal constant PRICE_USDC = 80_000000;
    uint256 internal constant DEPOSIT_USDC = 8_000000;
    uint256 internal constant TOTAL_USDC = 88_000000;

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "USDC", 6);
        verifier = new MockVerifier();
        rep = new MockReputation();
        escrow = new Escrow(address(usdc), address(verifier), address(0));

        usdc.mint(buyer, 1_000_000000); // 1,000,000 USDC
    }

    // ---------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------

    function _list() internal returns (uint256 listingId) {
        vm.prank(seller);
        listingId = escrow.list(PRICE, DEPOSIT_BPS, address(usdc));
    }

    function _fund(uint256 listingId, uint64 freeCancelUntil, uint64 expiry)
        internal
        returns (uint256 dealId)
    {
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL_USDC);
        dealId = escrow.fund(listingId, TOTAL_USDC, freeCancelUntil, expiry);
        vm.stopPrank();
    }

    function _listAndFund(uint64 freeCancelUntil, uint64 expiry) internal returns (uint256 dealId) {
        uint256 listingId = _list();
        dealId = _fund(listingId, freeCancelUntil, expiry);
    }

    // ---------------------------------------------------------------------------------------
    // Listing
    // ---------------------------------------------------------------------------------------

    function test_List_EmitsAndStores() public {
        vm.expectEmit(true, true, false, true);
        emit Escrow.Listed(1, seller, PRICE, DEPOSIT_BPS, address(usdc));
        uint256 listingId = _list();
        assertEq(listingId, 1);

        (address s, uint256 p, uint16 d, address t, bool active) = escrow.getListing(listingId);
        assertEq(s, seller);
        assertEq(p, PRICE);
        assertEq(d, DEPOSIT_BPS);
        assertEq(t, address(usdc));
        assertTrue(active);
    }

    function test_List_RevertZeroPrice() public {
        vm.prank(seller);
        vm.expectRevert(Escrow.InvalidPrice.selector);
        escrow.list(0, DEPOSIT_BPS, address(usdc));
    }

    function test_List_RevertBadDepositBps() public {
        vm.prank(seller);
        vm.expectRevert(Escrow.InvalidDepositBps.selector);
        escrow.list(PRICE, 10_001, address(usdc));
    }

    function test_List_RevertZeroToken() public {
        vm.prank(seller);
        vm.expectRevert(Escrow.ZeroToken.selector);
        escrow.list(PRICE, DEPOSIT_BPS, address(0));
    }

    function test_List_VolatileNeedsVerifier() public {
        Escrow noVerifier = new Escrow(address(usdc), address(0), address(0));
        MockERC20 weth = new MockERC20("WETH", "WETH", 18);
        vm.prank(seller);
        vm.expectRevert(Escrow.VolatileNeedsVerifier.selector);
        noVerifier.list(PRICE, DEPOSIT_BPS, address(weth));
    }

    function test_GetListing_RevertUnknown() public {
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.getListing(999);
    }

    // ---------------------------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------------------------

    function test_Fund_HappyPath() public {
        uint256 listingId = _list();
        uint64 expiry = uint64(block.timestamp + 1 days);

        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL_USDC);
        vm.expectEmit(true, true, true, true);
        emit Escrow.Funded(1, listingId, buyer, seller, TOTAL_USDC, 0, expiry);
        uint256 dealId = escrow.fund(listingId, TOTAL_USDC, 0, expiry);
        vm.stopPrank();

        assertEq(dealId, 1);
        assertEq(usdc.balanceOf(address(escrow)), TOTAL_USDC);

        (uint8 state, address b, address s,, uint256 p, uint256 ta, uint16 db,, uint64 e, bool ci) =
            escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Funded));
        assertEq(b, buyer);
        assertEq(s, seller);
        assertEq(p, PRICE);
        assertEq(ta, TOTAL_USDC);
        assertEq(db, DEPOSIT_BPS);
        assertEq(e, expiry);
        assertFalse(ci);
    }

    function test_Fund_RevertInsufficient() public {
        uint256 listingId = _list();
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL_USDC);
        vm.expectRevert(
            abi.encodeWithSelector(Escrow.InsufficientFunding.selector, TOTAL_USDC, TOTAL_USDC - 1)
        );
        escrow.fund(listingId, TOTAL_USDC - 1, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_Fund_RevertZeroAmount() public {
        uint256 listingId = _list();
        vm.prank(buyer);
        vm.expectRevert(Escrow.ZeroToken.selector);
        escrow.fund(listingId, 0, 0, uint64(block.timestamp + 1 days));
    }

    function test_Fund_RevertExpiryInPast() public {
        uint256 listingId = _list();
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL_USDC);
        vm.expectRevert(Escrow.InvalidExpiry.selector);
        escrow.fund(listingId, TOTAL_USDC, 0, uint64(block.timestamp));
        vm.stopPrank();
    }

    function test_Fund_RevertFreeCancelAfterExpiry() public {
        uint256 listingId = _list();
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL_USDC);
        vm.expectRevert(Escrow.InvalidFreeCancel.selector);
        escrow.fund(listingId, TOTAL_USDC, expiry + 1, expiry);
        vm.stopPrank();
    }

    function test_Fund_RevertUnknownListing() public {
        vm.prank(buyer);
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.fund(999, TOTAL_USDC, 0, uint64(block.timestamp + 1 days));
    }

    function test_GetDeal_RevertUnknown() public {
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.getDeal(999);
    }

    // ---------------------------------------------------------------------------------------
    // checkIn
    // ---------------------------------------------------------------------------------------

    function test_CheckIn_OnlySeller() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        vm.expectRevert(Escrow.NotSeller.selector);
        escrow.checkIn(dealId);
    }

    function test_CheckIn_SetsState() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.expectEmit(true, false, false, false);
        emit Escrow.CheckedIn(dealId);
        vm.prank(seller);
        escrow.checkIn(dealId);

        (uint8 state,,,,,,,,, bool ci) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.SellerCheckedIn));
        assertTrue(ci);
    }

    function test_CheckIn_RevertWrongState() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.checkIn(dealId);
        // Already checked in → state is SellerCheckedIn, not Funded.
        vm.prank(seller);
        vm.expectRevert(Escrow.WrongState.selector);
        escrow.checkIn(dealId);
    }

    // ---------------------------------------------------------------------------------------
    // §4: confirmReceipt (success) — price→seller, deposit→buyer
    // ---------------------------------------------------------------------------------------

    function test_ConfirmReceipt_Success() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.checkIn(dealId);

        vm.expectEmit(true, false, false, true);
        emit Escrow.Completed(dealId, PRICE_USDC, DEPOSIT_USDC);
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, "");

        assertEq(usdc.balanceOf(seller), PRICE_USDC);
        assertEq(usdc.balanceOf(buyer), 1_000_000000 - TOTAL_USDC + DEPOSIT_USDC);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Completed));
    }

    function test_ConfirmReceipt_WithoutCheckIn() public {
        // Buyer can confirm even if the seller didn't formally check in (they're together).
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, "");
        assertEq(usdc.balanceOf(seller), PRICE_USDC);
        assertEq(usdc.balanceOf(buyer), 1_000_000000 - TOTAL_USDC + DEPOSIT_USDC);
    }

    function test_ConfirmReceipt_OnlyBuyer() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        vm.expectRevert(Escrow.NotBuyer.selector);
        escrow.confirmReceipt(dealId, "");
    }

    function test_ConfirmReceipt_RevertAfterTerminal() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, "");
        vm.prank(buyer);
        vm.expectRevert(Escrow.WrongState.selector);
        escrow.confirmReceipt(dealId, "");
    }

    // ---------------------------------------------------------------------------------------
    // §4: agreeCancel (seller co-signs) — full refund → buyer
    // ---------------------------------------------------------------------------------------

    function test_AgreeCancel_FullRefund() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));

        vm.expectEmit(true, false, false, true);
        emit Escrow.Refunded(dealId, TOTAL_USDC);
        vm.prank(seller);
        escrow.agreeCancel(dealId);

        assertEq(usdc.balanceOf(buyer), 1_000_000000); // fully whole
        assertEq(usdc.balanceOf(seller), 0);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Refunded));
    }

    function test_AgreeCancel_OnlySeller() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        vm.expectRevert(Escrow.NotSeller.selector);
        escrow.agreeCancel(dealId);
    }

    function test_AgreeCancel_AfterCheckIn() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.prank(seller);
        escrow.agreeCancel(dealId);
        assertEq(usdc.balanceOf(buyer), 1_000_000000);
    }

    // ---------------------------------------------------------------------------------------
    // §4: buyerCancel BEFORE freeCancelUntil — full refund → buyer
    // ---------------------------------------------------------------------------------------

    function test_BuyerCancel_BeforeFreeWindow_FullRefund() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _listAndFund(freeCancelUntil, uint64(block.timestamp + 1 days));
        // Even if seller checked in, the free window wins.
        vm.prank(seller);
        escrow.checkIn(dealId);

        vm.expectEmit(true, false, false, true);
        emit Escrow.Refunded(dealId, TOTAL_USDC);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, "");

        assertEq(usdc.balanceOf(buyer), 1_000_000000);
        assertEq(usdc.balanceOf(seller), 0);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Refunded));
    }

    // ---------------------------------------------------------------------------------------
    // §4: buyerCancel AFTER free window WITH seller checkIn — deposit→seller, price→buyer
    // ---------------------------------------------------------------------------------------

    function test_BuyerCancel_AfterFree_WithCheckIn_Forfeit() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _listAndFund(freeCancelUntil, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.checkIn(dealId);

        vm.warp(freeCancelUntil + 1);

        vm.expectEmit(true, false, false, true);
        emit Escrow.Forfeited(dealId, PRICE_USDC, DEPOSIT_USDC);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, "");

        assertEq(usdc.balanceOf(seller), DEPOSIT_USDC); // seller keeps deposit
        assertEq(usdc.balanceOf(buyer), 1_000_000000 - DEPOSIT_USDC); // buyer gets price back
        assertEq(usdc.balanceOf(address(escrow)), 0);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Forfeited));
    }

    // ---------------------------------------------------------------------------------------
    // §4: buyerCancel AFTER free window WITHOUT checkIn — full refund (no-show protection)
    // ---------------------------------------------------------------------------------------

    function test_BuyerCancel_AfterFree_NoCheckIn_FullRefund() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _listAndFund(freeCancelUntil, uint64(block.timestamp + 1 days));

        vm.warp(freeCancelUntil + 1);

        vm.expectEmit(true, false, false, true);
        emit Escrow.Refunded(dealId, TOTAL_USDC);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, "");

        assertEq(usdc.balanceOf(buyer), 1_000_000000);
        assertEq(usdc.balanceOf(seller), 0);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Refunded));
    }

    function test_BuyerCancel_OnlyBuyer() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        vm.expectRevert(Escrow.NotBuyer.selector);
        escrow.buyerCancel(dealId, "");
    }

    // Terminal-state guards: once a deal is settled, every action reverts WrongState.
    function test_TerminalState_AllActionsRevert() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, ""); // Completed

        vm.prank(seller);
        vm.expectRevert(Escrow.WrongState.selector);
        escrow.checkIn(dealId);

        vm.prank(seller);
        vm.expectRevert(Escrow.WrongState.selector);
        escrow.agreeCancel(dealId);

        vm.prank(buyer);
        vm.expectRevert(Escrow.WrongState.selector);
        escrow.buyerCancel(dealId, "");

        vm.warp(block.timestamp + 2 days);
        vm.prank(stranger);
        vm.expectRevert(Escrow.WrongState.selector);
        escrow.reclaimExpired(dealId, "");
    }

    // Unknown-deal guards on terminal fns.
    function test_UnknownDeal_Reverts() public {
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.checkIn(999);
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.confirmReceipt(999, "");
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.agreeCancel(999);
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.buyerCancel(999, "");
        vm.expectRevert(Escrow.DealNotFound.selector);
        escrow.reclaimExpired(999, "");
    }

    // ---------------------------------------------------------------------------------------
    // §4: reclaimExpired WITH checkIn — deposit→seller, price→buyer
    // ---------------------------------------------------------------------------------------

    function test_ReclaimExpired_WithCheckIn_Forfeit() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dealId = _listAndFund(0, expiry);
        vm.prank(seller);
        escrow.checkIn(dealId);

        vm.warp(expiry);

        vm.expectEmit(true, false, false, true);
        emit Escrow.Forfeited(dealId, PRICE_USDC, DEPOSIT_USDC);
        // Anyone (CRE keeper) can call.
        vm.prank(stranger);
        escrow.reclaimExpired(dealId, "");

        assertEq(usdc.balanceOf(seller), DEPOSIT_USDC);
        assertEq(usdc.balanceOf(buyer), 1_000_000000 - DEPOSIT_USDC);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Forfeited));
    }

    // ---------------------------------------------------------------------------------------
    // §4: reclaimExpired WITHOUT checkIn — full refund → buyer
    // ---------------------------------------------------------------------------------------

    function test_ReclaimExpired_NoCheckIn_FullRefund() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dealId = _listAndFund(0, expiry);

        vm.warp(expiry);

        vm.expectEmit(true, false, false, true);
        emit Escrow.Refunded(dealId, TOTAL_USDC);
        vm.prank(stranger);
        escrow.reclaimExpired(dealId, "");

        assertEq(usdc.balanceOf(buyer), 1_000_000000);
        assertEq(usdc.balanceOf(seller), 0);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Refunded));
    }

    function test_ReclaimExpired_RevertBeforeExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dealId = _listAndFund(0, expiry);
        vm.prank(stranger);
        vm.expectRevert(Escrow.NotExpired.selector);
        escrow.reclaimExpired(dealId, "");
    }

    // ---------------------------------------------------------------------------------------
    // Owner / access control
    // ---------------------------------------------------------------------------------------

    function test_SetVerifierProxy_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setVerifierProxy(address(1));

        escrow.setVerifierProxy(address(1));
        assertEq(escrow.verifierProxy(), address(1));
    }

    function test_SetReputation_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setReputation(address(rep));

        escrow.setReputation(address(rep));
        assertEq(address(escrow.reputation()), address(rep));
    }

    function test_Constructor_RevertZeroStable() public {
        vm.expectRevert(Escrow.StableTokenDisallowed.selector);
        new Escrow(address(0), address(verifier), address(0));
    }

    // ---------------------------------------------------------------------------------------
    // Reputation hooks fire on terminal transitions when configured
    // ---------------------------------------------------------------------------------------

    function test_Reputation_OnCompleted() public {
        escrow.setReputation(address(rep));
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, "");
        assertEq(rep.completedCount(buyer, seller), 1);
    }

    function test_Reputation_OnMutualCancel() public {
        escrow.setReputation(address(rep));
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.agreeCancel(dealId);
        assertEq(rep.mutualCancelCount(buyer, seller), 1);
    }

    function test_Reputation_OnBuyerFlake() public {
        escrow.setReputation(address(rep));
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _listAndFund(freeCancelUntil, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, "");
        assertEq(rep.buyerFlakeCount(buyer, seller), 1);
    }

    function test_Reputation_OnSellerNoShow_BuyerCancel() public {
        escrow.setReputation(address(rep));
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _listAndFund(freeCancelUntil, uint64(block.timestamp + 1 days));
        vm.warp(freeCancelUntil + 1);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, ""); // after free window, no check-in → seller no-show
        assertEq(rep.sellerNoShowCount(buyer, seller), 1);
    }

    function test_Reputation_OnSellerNoShow_Reclaim() public {
        escrow.setReputation(address(rep));
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dealId = _listAndFund(0, expiry);
        vm.warp(expiry);
        vm.prank(stranger);
        escrow.reclaimExpired(dealId, "");
        assertEq(rep.sellerNoShowCount(buyer, seller), 1);
    }

    function test_Reputation_NoHook_FreeWindowCancel() public {
        // A pure free-window cancel is no-fault → no reputation hook should fire.
        escrow.setReputation(address(rep));
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _listAndFund(freeCancelUntil, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        escrow.buyerCancel(dealId, "");
        assertEq(rep.sellerNoShowCount(buyer, seller), 0);
        assertEq(rep.buyerFlakeCount(buyer, seller), 0);
        assertEq(rep.mutualCancelCount(buyer, seller), 0);
    }

    // No-reputation-configured path must not revert.
    function test_NoReputation_DoesNotRevert() public {
        uint256 dealId = _listAndFund(0, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, "");
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Completed));
    }
}
