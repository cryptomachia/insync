// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReputation} from "./IReputation.sol";

/// @title Reputation
/// @notice On-chain tally of escrow outcomes for Handoff (SPEC §3b). Counters are written
///         **only by the Escrow** contract via the four {IReputation} hooks, each guarded by
///         {onlyEscrow}. Anyone may read a participant's stats and derived score.
/// @dev    The `escrow` address is set exactly once by the owner (see {setEscrow}); after that
///         it is immutable. Hooks are idempotent w.r.t. correctness — they simply increment the
///         relevant counters — so re-entrancy is not a concern (no external calls, no ETH/token
///         movement). The score is intentionally simple and deterministic so the frontend can
///         display it without an oracle.
contract Reputation is IReputation, Ownable {
    /// @notice Per-participant outcome counters.
    /// @param completed      Deals this address completed successfully (as buyer or seller).
    /// @param buyerFlakes    Times this address (as buyer) flaked after the free window while the
    ///                       seller had checked in, forfeiting the deposit.
    /// @param sellerNoShows  Times this address (as seller) failed to show, triggering a refund.
    /// @param mutualCancels  Deals this address mutually/amicably cancelled.
    struct Stats {
        uint256 completed;
        uint256 buyerFlakes;
        uint256 sellerNoShows;
        uint256 mutualCancels;
    }

    /// @notice Weight applied to each completed deal in {scoreOf}.
    uint256 public constant COMPLETED_WEIGHT = 10;
    /// @notice Penalty applied per buyer flake in {scoreOf}.
    uint256 public constant FLAKE_PENALTY = 15;
    /// @notice Penalty applied per seller no-show in {scoreOf}.
    uint256 public constant NO_SHOW_PENALTY = 15;

    /// @notice The Escrow contract authorised to write reputation. Settable once (see {setEscrow}).
    address public escrow;

    /// @notice Outcome counters keyed by participant address.
    mapping(address => Stats) private _stats;

    /// @notice Emitted once when the Escrow address is wired up.
    event EscrowSet(address indexed escrow);

    /// @notice Caller is not the configured Escrow contract.
    error NotEscrow();
    /// @notice {setEscrow} was called more than once.
    error EscrowAlreadySet();
    /// @notice Attempted to set the Escrow to the zero address.
    error ZeroAddress();

    /// @notice Restricts a hook to the configured Escrow contract.
    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    /// @param owner_ Initial owner (may set the Escrow address once).
    constructor(address owner_) Ownable(owner_) {}

    /// @notice Wire up the authorised Escrow contract. Owner-only, callable exactly once.
    /// @param escrow_ The Escrow contract address (must be non-zero).
    function setEscrow(address escrow_) external onlyOwner {
        if (escrow != address(0)) revert EscrowAlreadySet();
        if (escrow_ == address(0)) revert ZeroAddress();
        escrow = escrow_;
        emit EscrowSet(escrow_);
    }

    /// @inheritdoc IReputation
    /// @dev Successful handoff: credits both participants a completed deal.
    function onCompleted(address buyer, address seller) external onlyEscrow {
        _stats[buyer].completed += 1;
        _stats[seller].completed += 1;
    }

    /// @inheritdoc IReputation
    /// @dev Buyer flaked (cancelled after the free window with the seller present); the buyer's
    ///      deposit was forfeited to the seller. Only the buyer is penalised.
    function onBuyerFlake(address buyer, address /*seller*/ ) external onlyEscrow {
        _stats[buyer].buyerFlakes += 1;
    }

    /// @inheritdoc IReputation
    /// @dev Seller never showed; the buyer was refunded. Only the seller is penalised.
    function onSellerNoShow(address, /*buyer*/ address seller) external onlyEscrow {
        _stats[seller].sellerNoShows += 1;
    }

    /// @inheritdoc IReputation
    /// @dev Amicable/mutual cancellation: recorded for both, penalises neither's score.
    function onMutualCancel(address buyer, address seller) external onlyEscrow {
        _stats[buyer].mutualCancels += 1;
        _stats[seller].mutualCancels += 1;
    }

    /// @notice Derived reputation score for `who`.
    /// @dev Score = completed*COMPLETED_WEIGHT − buyerFlakes*FLAKE_PENALTY −
    ///      sellerNoShows*NO_SHOW_PENALTY, floored at 0. Mutual cancels are neutral. The floor
    ///      means penalties never underflow and a fresh address starts at 0.
    /// @param who The participant to score.
    /// @return The non-negative reputation score.
    function scoreOf(address who) external view returns (uint256) {
        Stats storage s = _stats[who];
        uint256 positive = s.completed * COMPLETED_WEIGHT;
        uint256 negative = s.buyerFlakes * FLAKE_PENALTY + s.sellerNoShows * NO_SHOW_PENALTY;
        return positive > negative ? positive - negative : 0;
    }

    /// @notice Raw outcome counters for `who`.
    /// @param who The participant to query.
    /// @return completed     Successful deals.
    /// @return buyerFlakes   Deposit-forfeiting buyer flakes.
    /// @return sellerNoShows Seller no-shows.
    /// @return mutualCancels Mutual cancellations.
    function statsOf(address who)
        external
        view
        returns (uint256 completed, uint256 buyerFlakes, uint256 sellerNoShows, uint256 mutualCancels)
    {
        Stats storage s = _stats[who];
        return (s.completed, s.buyerFlakes, s.sellerNoShows, s.mutualCancels);
    }
}
