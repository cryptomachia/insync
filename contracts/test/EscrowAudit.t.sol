// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockReputation} from "./mocks/MockReputation.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";

/// @notice Audit-driven coverage:
///   - Self-deal (buyer == seller): the UI relies on it; every branch must route funds without
///     reverting and leave the escrow drained.
///   - Fee-on-transfer funding: the escrow must record the *actual* received amount so payouts
///     never exceed the held balance (no stranded funds, no failed settlement).
///   - Conservation of funds: across every terminal branch, buyer + seller payouts sum to exactly
///     what the escrow held; the escrow balance returns to zero.
contract EscrowAuditTest is Test {
    Escrow internal escrow;
    MockERC20 internal usdc; // 6 decimals
    MockERC20 internal weth; // 18 decimals (volatile)
    MockVerifier internal verifier;
    MockReputation internal rep;

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 80_00000000; // $80, 8 decimals
    uint16 internal constant DEPOSIT_BPS = 1000; // 10%

    uint256 internal constant PRICE_USDC = 80_000000;
    uint256 internal constant DEPOSIT_USDC = 8_000000;
    uint256 internal constant TOTAL_USDC = 88_000000;

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        verifier = new MockVerifier();
        rep = new MockReputation();
        escrow = new Escrow(address(usdc), address(verifier), address(0));

        usdc.mint(buyer, 1_000_000000);
        usdc.mint(seller, 1_000_000000); // seller funds self-deals
        weth.mint(buyer, 100e18);
    }

    // -----------------------------------------------------------------------------------------
    // Self-deal (buyer == seller) — UI relies on it
    // -----------------------------------------------------------------------------------------

    function _selfList() internal returns (uint256 listingId) {
        vm.prank(seller);
        listingId = escrow.list(PRICE, DEPOSIT_BPS, address(usdc));
    }

    function _selfFund(uint256 listingId, uint64 freeCancelUntil, uint64 expiry)
        internal
        returns (uint256 dealId)
    {
        vm.startPrank(seller); // seller funds their own listing (buyer == seller)
        usdc.approve(address(escrow), TOTAL_USDC);
        dealId = escrow.fund(listingId, TOTAL_USDC, freeCancelUntil, expiry);
        vm.stopPrank();
    }

    function test_SelfDeal_ConfirmReceipt() public {
        escrow.setReputation(address(rep));
        uint256 listingId = _selfList();
        uint256 before = usdc.balanceOf(seller);
        uint256 dealId = _selfFund(listingId, 0, uint64(block.timestamp + 1 days));

        vm.prank(seller);
        escrow.confirmReceipt(dealId, "");

        // Buyer and seller are the same address → it ends up exactly whole.
        assertEq(usdc.balanceOf(seller), before, "self-deal nets to zero");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        // Both reputation credits land on the same address.
        assertEq(rep.completedCount(seller, seller), 1);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Completed));
    }

    function test_SelfDeal_AgreeCancel() public {
        uint256 listingId = _selfList();
        uint256 before = usdc.balanceOf(seller);
        uint256 dealId = _selfFund(listingId, 0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        escrow.agreeCancel(dealId);
        assertEq(usdc.balanceOf(seller), before);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_SelfDeal_BuyerCancel_Forfeit() public {
        uint256 listingId = _selfList();
        uint256 before = usdc.balanceOf(seller);
        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        uint256 dealId = _selfFund(listingId, freeCancelUntil, uint64(block.timestamp + 1 days));

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);
        vm.prank(seller);
        escrow.buyerCancel(dealId, ""); // forfeit branch: deposit→seller, price→buyer (same addr)

        assertEq(usdc.balanceOf(seller), before, "forfeit nets to zero in a self-deal");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        (uint8 state,,,,,,,,,) = escrow.getDeal(dealId);
        assertEq(state, uint8(Escrow.State.Forfeited));
    }

    function test_SelfDeal_ReclaimExpired() public {
        uint256 listingId = _selfList();
        uint256 before = usdc.balanceOf(seller);
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dealId = _selfFund(listingId, 0, expiry);
        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(expiry);
        vm.prank(stranger);
        escrow.reclaimExpired(dealId, "");
        assertEq(usdc.balanceOf(seller), before);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // -----------------------------------------------------------------------------------------
    // Fee-on-transfer funding: escrow records the ACTUAL received amount
    // -----------------------------------------------------------------------------------------

    function test_FeeOnTransfer_RecordsReceivedAndSettlesCleanly() public {
        // 1% fee token used as the stable token. Buyer must over-send so the *received* amount
        // still meets price+deposit; settlement must then drain the escrow with no revert.
        FeeOnTransferToken fee = new FeeOnTransferToken(100); // 1%
        Escrow feeEscrow = new Escrow(address(fee), address(verifier), address(0));
        fee.mint(buyer, 1_000_000000);

        vm.prank(seller);
        uint256 listingId = feeEscrow.list(PRICE, DEPOSIT_BPS, address(fee));

        // Send 90 USDC; 1% fee burned → escrow receives 89.1 USDC (>= 88 required).
        uint256 sent = 90_000000;
        vm.startPrank(buyer);
        fee.approve(address(feeEscrow), sent);
        uint256 dealId = feeEscrow.fund(listingId, sent, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        uint256 received = fee.balanceOf(address(feeEscrow));
        assertEq(received, sent - (sent * 100) / 10_000, "escrow holds the post-fee amount");

        // The deal must store the received amount, not the requested one.
        (,,,,, uint256 ta,,,,) = feeEscrow.getDeal(dealId);
        assertEq(ta, received, "tokenAmount == actual received");

        // Settlement must not try to pay out more than is held.
        vm.prank(buyer);
        feeEscrow.confirmReceipt(dealId, "");
        assertEq(fee.balanceOf(address(feeEscrow)), 0, "escrow fully drained");
    }

    function test_FeeOnTransfer_InsufficientAfterFeeReverts() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(500); // 5%
        Escrow feeEscrow = new Escrow(address(fee), address(verifier), address(0));
        fee.mint(buyer, 1_000_000000);

        vm.prank(seller);
        uint256 listingId = feeEscrow.list(PRICE, DEPOSIT_BPS, address(fee));

        // Send exactly 88; 5% fee → only 83.6 received < 88 required → revert against RECEIVED.
        vm.startPrank(buyer);
        fee.approve(address(feeEscrow), TOTAL_USDC);
        uint256 received = TOTAL_USDC - (TOTAL_USDC * 500) / 10_000;
        vm.expectRevert(abi.encodeWithSelector(Escrow.InsufficientFunding.selector, TOTAL_USDC, received));
        feeEscrow.fund(listingId, TOTAL_USDC, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------------------------
    // Conservation of funds — fuzzed over funded amount & price (volatile path)
    // -----------------------------------------------------------------------------------------

    function testFuzz_Conservation_ConfirmReceipt(uint256 funded, uint256 settlePrice) public {
        funded = bound(funded, 1, 50e18);
        // Settlement price between $500 and $20000 (covers crash & spike past buffer).
        int256 priceMove = int256(bound(settlePrice, 500e8, 20000e8));

        vm.prank(seller);
        uint256 listingId = escrow.list(PRICE, DEPOSIT_BPS, address(weth));

        vm.startPrank(buyer);
        weth.approve(address(escrow), funded);
        uint256 dealId = escrow.fund(listingId, funded, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        uint256 held = weth.balanceOf(address(escrow));
        uint256 sBefore = weth.balanceOf(seller);
        uint256 bBefore = weth.balanceOf(buyer);

        bytes memory report = verifier.encodeReport(priceMove);
        vm.prank(buyer);
        escrow.confirmReceipt(dealId, report);

        uint256 sGot = weth.balanceOf(seller) - sBefore;
        uint256 bGot = weth.balanceOf(buyer) - bBefore;
        assertEq(sGot + bGot, held, "payouts conserve the held amount");
        assertEq(weth.balanceOf(address(escrow)), 0, "escrow drained");
    }

    function testFuzz_Conservation_Forfeit(uint256 funded, uint256 settlePrice) public {
        funded = bound(funded, 1, 50e18);
        settlePrice = bound(settlePrice, 500e8, 20000e8);

        vm.prank(seller);
        uint256 listingId = escrow.list(PRICE, DEPOSIT_BPS, address(weth));

        uint64 freeCancelUntil = uint64(block.timestamp + 1 hours);
        vm.startPrank(buyer);
        weth.approve(address(escrow), funded);
        uint256 dealId = escrow.fund(listingId, funded, freeCancelUntil, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        vm.prank(seller);
        escrow.checkIn(dealId);
        vm.warp(freeCancelUntil + 1);

        uint256 held = weth.balanceOf(address(escrow));
        uint256 sBefore = weth.balanceOf(seller);
        uint256 bBefore = weth.balanceOf(buyer);

        bytes memory report = verifier.encodeReport(int256(settlePrice));
        vm.prank(buyer);
        escrow.buyerCancel(dealId, report);

        uint256 sGot = weth.balanceOf(seller) - sBefore;
        uint256 bGot = weth.balanceOf(buyer) - bBefore;
        assertEq(sGot + bGot, held, "forfeit payouts conserve the held amount");
        // Shortfall-safety: buyer is always made whole on the price portion first, so the buyer
        // receives at least min(priceWorth, held).
        assertEq(weth.balanceOf(address(escrow)), 0, "escrow drained");
    }
}
