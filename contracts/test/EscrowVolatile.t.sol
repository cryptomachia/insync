// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

/// @notice Volatile-token path: price/deposit are computed in USD via the verifier at call time,
///         surplus returns to the buyer, and the shortfall edge (token crashed past buffer) pays
///         the buyer's price portion first.
contract EscrowVolatileTest is Test {
    Escrow internal escrow;
    MockERC20 internal usdc; // 6 decimals (stable, configured)
    MockERC20 internal weth; // 18 decimals (volatile payToken)
    MockVerifier internal verifier;

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 80_00000000; // $80, 8 decimals
    uint16 internal constant DEPOSIT_BPS = 1000; // 10% → $8

    // At ETH/USD = 4000e8:
    //   priceUnits   = 80e8  * 1e18 / 4000e8 = 0.02   WETH = 2e16
    //   depositUnits =  8e8  * 1e18 / 4000e8 = 0.002  WETH = 2e15
    uint256 internal constant PRICE_WETH_AT_4000 = 2e16;
    uint256 internal constant DEPOSIT_WETH_AT_4000 = 2e15;

    uint256 internal constant BUYER_START = 100e18;

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        verifier = new MockVerifier();
        escrow = new Escrow(address(usdc), address(verifier), address(0));

        weth.mint(buyer, BUYER_START);
    }

    function _listVolatile() internal returns (uint256 listingId) {
        return _listVolatile(0, 1 days);
    }

    function _listVolatile(uint64 freeCancelWindow, uint64 dealTtl) internal returns (uint256 listingId) {
        vm.prank(seller);
        listingId = escrow.list(PRICE, DEPOSIT_BPS, address(weth), freeCancelWindow, dealTtl, 0);
    }

    function _fund(uint256 listingId, uint256 amount) internal returns (uint256 dealId) {
        vm.startPrank(buyer);
        weth.approve(address(escrow), amount);
        dealId = escrow.fund(listingId, amount);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------
    // Empty report → MockVerifier default 4000e8 (mock convention)
    // ---------------------------------------------------------------------------------------

    function test_Volatile_ConfirmReceipt_EmptyReportUsesMockPrice() public {
        uint256 listingId = _listVolatile();
        uint256 funded = 0.03e18; // buffer above the 0.022 needed
        uint256 dealId = _fund(listingId, funded);

        vm.prank(buyer);
        escrow.confirmReceipt(dealId, ""); // empty → 4000e8

        // Seller paid the price worth; buyer gets the rest (deposit + surplus).
        assertEq(weth.balanceOf(seller), PRICE_WETH_AT_4000);
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + (funded - PRICE_WETH_AT_4000));
        assertEq(weth.balanceOf(address(escrow)), 0);
    }

    // ---------------------------------------------------------------------------------------
    // Surplus returns to the buyer on confirmReceipt (token gained value vs. funding)
    // ---------------------------------------------------------------------------------------

    function test_Volatile_Surplus_ReturnsToBuyer() public {
        uint256 listingId = _listVolatile();
        uint256 funded = 0.03e18;
        uint256 dealId = _fund(listingId, funded);

        // Report price unchanged (4000) via explicit encoded report.
        bytes memory report = verifier.encodeReport(4000e8);

        vm.prank(buyer);
        escrow.confirmReceipt(dealId, report);

        // sellerPaid = price worth; buyerRefunded = funded - price worth (deposit + surplus).
        uint256 expectedBuyerRefund = funded - PRICE_WETH_AT_4000;
        assertEq(weth.balanceOf(seller), PRICE_WETH_AT_4000);
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + expectedBuyerRefund);
    }

    // ---------------------------------------------------------------------------------------
    // Forfeit (buyerCancel after free window, seller checked in) — volatile
    //   buyer gets price worth, seller gets deposit worth, surplus → buyer
    // ---------------------------------------------------------------------------------------

    function test_Volatile_BuyerCancel_Forfeit_WithSurplus() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 listingId = _listVolatile(1 hours, 1 days);
        uint256 funded = 0.03e18; // needs 0.022, surplus 0.008
        uint256 dealId = _fund(listingId, funded);

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);

        vm.prank(buyer);
        escrow.buyerCancel(dealId, ""); // 4000e8

        // Seller gets deposit worth; buyer gets price worth + surplus.
        uint256 surplus = funded - PRICE_WETH_AT_4000 - DEPOSIT_WETH_AT_4000;
        assertEq(weth.balanceOf(seller), DEPOSIT_WETH_AT_4000);
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + PRICE_WETH_AT_4000 + surplus);
        assertEq(weth.balanceOf(address(escrow)), 0);
    }

    // ---------------------------------------------------------------------------------------
    // SHORTFALL EDGE: token crashed past the buffer. Buyer's price portion is paid FIRST.
    // ---------------------------------------------------------------------------------------

    function test_Volatile_Shortfall_PaysBuyerPriceFirst() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 listingId = _listVolatile(1 hours, 1 days);
        // Fund exactly enough at $4000: price+deposit = 0.022 WETH.
        uint256 funded = 0.022e18;
        uint256 dealId = _fund(listingId, funded);

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);

        // Token crashes to $2000 → price worth now 0.04 WETH, deposit worth 0.004 WETH,
        // total 0.044 > 0.022 held. Buyer's price portion gets ALL of it; seller gets nothing.
        bytes memory crashReport = verifier.encodeReport(2000e8);

        vm.prank(buyer);
        escrow.buyerCancel(dealId, crashReport);

        // priceUnits capped at held (0.022) → buyer gets everything, seller gets 0.
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + funded); // fully refunded
        assertEq(weth.balanceOf(seller), 0);
        assertEq(weth.balanceOf(address(escrow)), 0);
    }

    function test_Volatile_PartialShortfall_SellerGetsRemainder() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 listingId = _listVolatile(1 hours, 1 days);
        // Fund 0.05 WETH (buffer). At a crash to $2000:
        //   price worth = 0.04, deposit worth = 0.004, total 0.044 <= 0.05 held → no shortfall.
        //   Then surplus 0.006 → buyer. This exercises the priced-at-call-time path with a move.
        uint256 funded = 0.05e18;
        uint256 dealId = _fund(listingId, funded);

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);

        bytes memory crashReport = verifier.encodeReport(2000e8);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, crashReport);

        uint256 priceWorth = 0.04e18;
        uint256 depositWorth = 0.004e18;
        uint256 surplus = funded - priceWorth - depositWorth; // 0.006
        assertEq(weth.balanceOf(seller), depositWorth);
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + priceWorth + surplus);
    }

    // Partial shortfall where deposit is squeezed but price fits.
    function test_Volatile_DepositSqueezed_PriceFits() public {
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 listingId = _listVolatile(1 hours, 1 days);
        // Fund 0.042 WETH. Crash to $2000: price worth 0.04 (fits), deposit worth 0.004 but only
        // 0.002 remains → seller gets 0.002, buyer gets 0.04, escrow drained.
        uint256 funded = 0.042e18;
        uint256 dealId = _fund(listingId, funded);

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);

        bytes memory crashReport = verifier.encodeReport(2000e8);
        vm.prank(buyer);
        escrow.buyerCancel(dealId, crashReport);

        uint256 priceWorth = 0.04e18;
        uint256 sellerGets = funded - priceWorth; // 0.002 (squeezed deposit)
        assertEq(weth.balanceOf(seller), sellerGets);
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + priceWorth);
        assertEq(weth.balanceOf(address(escrow)), 0);
    }

    // ---------------------------------------------------------------------------------------
    // reclaimExpired volatile (seller checked in) uses verifier price too
    // ---------------------------------------------------------------------------------------

    function test_Volatile_ReclaimExpired_WithCheckIn() public {
        uint256 listingId = _listVolatile();
        uint256 funded = 0.03e18;
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dealId = _fund(listingId, funded);

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(expiry);

        vm.prank(stranger);
        escrow.reclaimExpired(dealId, ""); // 4000e8

        uint256 surplus = funded - PRICE_WETH_AT_4000 - DEPOSIT_WETH_AT_4000;
        assertEq(weth.balanceOf(seller), DEPOSIT_WETH_AT_4000);
        assertEq(weth.balanceOf(buyer), BUYER_START - funded + PRICE_WETH_AT_4000 + surplus);
    }

    // ---------------------------------------------------------------------------------------
    // Volatile deal can't settle if verifier was removed
    // ---------------------------------------------------------------------------------------

    function test_Volatile_RevertIfVerifierRemoved() public {
        uint256 listingId = _listVolatile();
        uint256 dealId = _fund(listingId, 0.03e18);

        escrow.setVerifierProxy(address(0));

        vm.prank(buyer);
        vm.expectRevert(Escrow.VolatileNeedsVerifier.selector);
        escrow.confirmReceipt(dealId, "");
    }

    // A non-positive verifier price must revert (bad oracle data).
    function test_Volatile_RevertOnNonPositivePrice() public {
        uint256 listingId = _listVolatile();
        uint256 dealId = _fund(listingId, 0.03e18);

        bytes memory badReport = verifier.encodeReport(0);
        vm.prank(buyer);
        vm.expectRevert(Escrow.InvalidPrice.selector);
        escrow.confirmReceipt(dealId, badReport);

        bytes memory negReport = verifier.encodeReport(-1);
        vm.prank(buyer);
        vm.expectRevert(Escrow.InvalidPrice.selector);
        escrow.confirmReceipt(dealId, negReport);
    }
}
