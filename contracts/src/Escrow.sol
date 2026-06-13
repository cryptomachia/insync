// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IReputation} from "./IReputation.sol";
import {IVerifierProxy} from "./IVerifierProxy.sol";

/// @title Handoff Escrow — trustless in-person escrow with a commitment-deposit model.
/// @notice The buyer locks the item price + a seller-set deposit in `payToken` before anyone
///         travels (the seller can verify the funds are real and locked). At the in-person meet
///         the buyer scans the seller's QR and calls {confirmReceipt}, settling finally with no
///         chargeback. Cancellation outcomes follow the SPEC §4 commitment-deposit table:
///         the item price is always recoverable by the buyer; only the deposit is ever at risk,
///         and only when the buyer flakes after the seller has shown up (checked in).
///
/// @dev Denomination (SPEC §3):
///      - `priceUsd1e8`: item price in USD with 8 decimals ($80.00 = 80_00000000).
///      - `depositBps`: deposit as basis points of the price (1000 = 10%).
///      - The configured `stableToken` (USDC, 6 decimals) needs no oracle:
///        usdcAmount = priceUsd1e8 / 100. For a volatile `payToken` the USD worth of the price
///        and deposit is computed at call time via a Data Streams Verifier proxy.
///
///      VOLATILITY SHORTFALL EDGE CASE (SPEC §4): for a volatile token, on every terminal call
///      we recompute how many tokens are worth $price and $deposit at the *current* price. If
///      the token has crashed past the buffer the buyer locked at fund time, the held
///      `tokenAmount` may be worth less than price+deposit. In that case we pay out only what is
///      available, **preferring the buyer's price portion first** (the buyer must always be made
///      as whole as possible on the item price), and the deposit recipient absorbs the shortfall.
///      Surplus tokens (when the token held more value than needed) always return to the buyer.
contract Escrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------

    enum State {
        None,
        Funded,
        SellerCheckedIn,
        Completed,
        Refunded,
        Forfeited
    }

    struct Listing {
        address seller;
        uint256 priceUsd1e8;
        uint16 depositBps;
        address payToken;
        bool active;
    }

    struct Deal {
        State state;
        address buyer;
        address seller;
        address payToken;
        uint256 priceUsd1e8;
        uint256 tokenAmount; // total payToken held in escrow for this deal
        uint16 depositBps;
        uint64 freeCancelUntil;
        uint64 expiry;
        bool sellerCheckedIn;
    }

    // ---------------------------------------------------------------------------------------
    // Constants / config
    // ---------------------------------------------------------------------------------------

    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice The stable settlement token (USDC). Deals in this token need no oracle.
    address public immutable stableToken;

    /// @notice Chainlink Data Streams Verifier proxy. May be address(0) → only stable deals allowed.
    address public verifierProxy;

    /// @notice Optional on-chain reputation sink. When set, hooks fire on terminal transitions.
    IReputation public reputation;

    // ---------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------

    uint256 public nextListingId = 1;
    uint256 public nextDealId = 1;

    mapping(uint256 => Listing) internal listings;
    mapping(uint256 => Deal) internal deals;

    // ---------------------------------------------------------------------------------------
    // Events (FROZEN — SPEC §3; indexers / CRE / frontend depend on these)
    // ---------------------------------------------------------------------------------------

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 priceUsd1e8,
        uint16 depositBps,
        address payToken
    );
    event Funded(
        uint256 indexed dealId,
        uint256 indexed listingId,
        address indexed buyer,
        address seller,
        uint256 tokenAmount,
        uint64 freeCancelUntil,
        uint64 expiry
    );
    event CheckedIn(uint256 indexed dealId);
    event Completed(uint256 indexed dealId, uint256 sellerPaid, uint256 buyerRefunded);
    event Refunded(uint256 indexed dealId, uint256 amount);
    event Forfeited(uint256 indexed dealId, uint256 toBuyer, uint256 toSeller);

    // Config events (not in the frozen set, but useful for indexers/owner ops).
    event VerifierProxyUpdated(address indexed verifierProxy);
    event ReputationUpdated(address indexed reputation);

    // ---------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------

    error InvalidPrice();
    error InvalidDepositBps();
    error ZeroToken();
    error ListingNotActive();
    error InvalidExpiry();
    error InvalidFreeCancel();
    error InsufficientFunding(uint256 required, uint256 provided);
    error DealNotFound();
    error WrongState();
    error NotBuyer();
    error NotSeller();
    error NotExpired();
    error VolatileNeedsVerifier();
    error StableTokenDisallowed();

    // ---------------------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------------------

    /// @param _stableToken   the stable settlement token (USDC). Must be non-zero.
    /// @param _verifierProxy Data Streams Verifier proxy; address(0) → only stable deals allowed.
    /// @param _reputation    optional reputation contract; address(0) → no hooks.
    constructor(address _stableToken, address _verifierProxy, address _reputation) Ownable(msg.sender) {
        if (_stableToken == address(0)) revert StableTokenDisallowed();
        stableToken = _stableToken;
        verifierProxy = _verifierProxy;
        reputation = IReputation(_reputation);
    }

    // ---------------------------------------------------------------------------------------
    // Owner config
    // ---------------------------------------------------------------------------------------

    function setVerifierProxy(address _verifierProxy) external onlyOwner {
        verifierProxy = _verifierProxy;
        emit VerifierProxyUpdated(_verifierProxy);
    }

    function setReputation(address _reputation) external onlyOwner {
        reputation = IReputation(_reputation);
        emit ReputationUpdated(_reputation);
    }

    // ---------------------------------------------------------------------------------------
    // Listing
    // ---------------------------------------------------------------------------------------

    /// @notice Seller publishes an item for sale. `payToken` may be the stable token or, if a
    ///         verifier is configured, any volatile ERC20 priced via Data Streams at settlement.
    function list(uint256 priceUsd1e8, uint16 depositBps, address payToken)
        external
        returns (uint256 listingId)
    {
        if (priceUsd1e8 == 0) revert InvalidPrice();
        if (depositBps > BPS_DENOMINATOR) revert InvalidDepositBps();
        if (payToken == address(0)) revert ZeroToken();
        // A volatile listing is only usable if a verifier is configured.
        if (payToken != stableToken && verifierProxy == address(0)) revert VolatileNeedsVerifier();

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            priceUsd1e8: priceUsd1e8,
            depositBps: depositBps,
            payToken: payToken,
            active: true
        });

        emit Listed(listingId, msg.sender, priceUsd1e8, depositBps, payToken);
    }

    function getListing(uint256 listingId)
        external
        view
        returns (address seller, uint256 priceUsd1e8, uint16 depositBps, address payToken, bool active)
    {
        Listing storage l = listings[listingId];
        if (l.seller == address(0)) revert DealNotFound();
        return (l.seller, l.priceUsd1e8, l.depositBps, l.payToken, l.active);
    }

    // ---------------------------------------------------------------------------------------
    // Funding (buyer locks tokens)
    // ---------------------------------------------------------------------------------------

    /// @notice Buyer locks `tokenAmount` of the listing's `payToken`. The amount must cover
    ///         price + deposit. For a stable token the required amount is exact; for a volatile
    ///         token the buyer is expected to include a buffer (priced at fund time off-chain) so
    ///         the on-chain settlement can still cover price+deposit despite price moves.
    /// @param freeCancelUntil buyer may cancel for a full refund before this timestamp.
    /// @param expiry          after this timestamp anyone/CRE may {reclaimExpired}.
    function fund(uint256 listingId, uint256 tokenAmount, uint64 freeCancelUntil, uint64 expiry)
        external
        nonReentrant
        returns (uint256 dealId)
    {
        Listing storage l = listings[listingId];
        if (l.seller == address(0)) revert DealNotFound();
        if (!l.active) revert ListingNotActive();
        if (tokenAmount == 0) revert ZeroToken();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        // freeCancelUntil must not be after expiry (a free-cancel window past expiry is meaningless).
        if (freeCancelUntil > expiry) revert InvalidFreeCancel();

        // For the stable path we can require the exact price+deposit up front (no buffer needed).
        // For the volatile path we only sanity-check the funded amount is non-zero here; the USD
        // worth is recomputed against the verifier at settlement.
        if (l.payToken == stableToken) {
            uint256 required = _stablePriceUnits(l.priceUsd1e8) + _stableDepositUnits(l.priceUsd1e8, l.depositBps);
            if (tokenAmount < required) revert InsufficientFunding(required, tokenAmount);
        }

        dealId = nextDealId++;
        deals[dealId] = Deal({
            state: State.Funded,
            buyer: msg.sender,
            seller: l.seller,
            payToken: l.payToken,
            priceUsd1e8: l.priceUsd1e8,
            tokenAmount: tokenAmount,
            depositBps: l.depositBps,
            freeCancelUntil: freeCancelUntil,
            expiry: expiry,
            sellerCheckedIn: false
        });

        // Effects done; interaction last (CEI). nonReentrant for defense in depth.
        IERC20(l.payToken).safeTransferFrom(msg.sender, address(this), tokenAmount);

        emit Funded(dealId, listingId, msg.sender, l.seller, tokenAmount, freeCancelUntil, expiry);
    }

    function getDeal(uint256 dealId)
        external
        view
        returns (
            uint8 state,
            address buyer,
            address seller,
            address payToken,
            uint256 priceUsd1e8,
            uint256 tokenAmount,
            uint16 depositBps,
            uint64 freeCancelUntil,
            uint64 expiry,
            bool sellerCheckedIn
        )
    {
        Deal storage d = deals[dealId];
        if (d.buyer == address(0)) revert DealNotFound();
        return (
            uint8(d.state),
            d.buyer,
            d.seller,
            d.payToken,
            d.priceUsd1e8,
            d.tokenAmount,
            d.depositBps,
            d.freeCancelUntil,
            d.expiry,
            d.sellerCheckedIn
        );
    }

    // ---------------------------------------------------------------------------------------
    // Lifecycle transitions
    // ---------------------------------------------------------------------------------------

    /// @notice Seller checks in at the meet. This gates deposit-forfeiture: only a checked-in
    ///         seller can ever keep the buyer's deposit on a buyer cancel / expiry.
    function checkIn(uint256 dealId) external {
        Deal storage d = deals[dealId];
        if (d.buyer == address(0)) revert DealNotFound();
        if (d.state != State.Funded) revert WrongState();
        if (msg.sender != d.seller) revert NotSeller();

        d.sellerCheckedIn = true;
        d.state = State.SellerCheckedIn;

        emit CheckedIn(dealId);
    }

    /// @notice Buyer confirms receipt at the meet (success): price → seller, deposit → buyer.
    /// @param report Data Streams payload for volatile tokens; ignored/empty for the stable token.
    function confirmReceipt(uint256 dealId, bytes calldata report) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.buyer == address(0)) revert DealNotFound();
        if (d.state != State.Funded && d.state != State.SellerCheckedIn) revert WrongState();
        if (msg.sender != d.buyer) revert NotBuyer();

        (uint256 priceUnits, uint256 depositUnits) = _settlementUnits(d, report);

        // Success: seller gets the price, buyer gets the deposit + any surplus.
        uint256 sellerPaid = priceUnits;
        uint256 buyerRefunded = d.tokenAmount - sellerPaid; // deposit + surplus, shortfall-safe

        d.state = State.Completed;

        _payout(d.payToken, d.seller, sellerPaid);
        _payout(d.payToken, d.buyer, buyerRefunded);

        _onCompleted(d.buyer, d.seller);

        emit Completed(dealId, sellerPaid, buyerRefunded);
        // `depositUnits` is unused on the success path but computed for symmetry/validation.
        depositUnits;
    }

    /// @notice Seller co-signs a cancellation: full refund → buyer (price + deposit + surplus).
    function agreeCancel(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.buyer == address(0)) revert DealNotFound();
        if (d.state != State.Funded && d.state != State.SellerCheckedIn) revert WrongState();
        if (msg.sender != d.seller) revert NotSeller();

        uint256 amount = d.tokenAmount;
        d.state = State.Refunded;

        _payout(d.payToken, d.buyer, amount);

        _onMutualCancel(d.buyer, d.seller);

        emit Refunded(dealId, amount);
    }

    /// @notice Buyer cancels. Outcome depends on timing and seller check-in (SPEC §4):
    ///         - before `freeCancelUntil`: full refund → buyer.
    ///         - after the free window AND seller checked in: deposit → seller, price → buyer.
    ///         - after the free window, seller NOT checked in: full refund → buyer (no-show protection).
    /// @param report Data Streams payload for volatile tokens; ignored/empty for the stable token.
    function buyerCancel(uint256 dealId, bytes calldata report) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.buyer == address(0)) revert DealNotFound();
        if (d.state != State.Funded && d.state != State.SellerCheckedIn) revert WrongState();
        if (msg.sender != d.buyer) revert NotBuyer();

        bool freeWindow = block.timestamp < d.freeCancelUntil;

        if (freeWindow || !d.sellerCheckedIn) {
            // Full refund to the buyer (free window, or seller never showed → no-show protection).
            uint256 amount = d.tokenAmount;
            d.state = State.Refunded;

            _payout(d.payToken, d.buyer, amount);

            // A seller no-show after the free window is the seller's fault → record it.
            if (!freeWindow) {
                _onSellerNoShow(d.buyer, d.seller);
            }
            // (A pure free-window cancel is a no-fault refund; no reputation hook fires.)

            emit Refunded(dealId, amount);
        } else {
            // After the free window with a checked-in seller: buyer flaked → deposit forfeited.
            _settleForfeit(dealId, d, report);
        }
    }

    /// @notice After `expiry`, anyone (the CRE keeper) may resolve a stuck deal (SPEC §4):
    ///         - seller checked in: deposit → seller, price → buyer (buyer ghosted a present seller).
    ///         - seller NOT checked in: full refund → buyer (seller never showed).
    /// @param report Data Streams payload for volatile tokens; ignored/empty for the stable token.
    function reclaimExpired(uint256 dealId, bytes calldata report) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.buyer == address(0)) revert DealNotFound();
        if (d.state != State.Funded && d.state != State.SellerCheckedIn) revert WrongState();
        if (block.timestamp < d.expiry) revert NotExpired();

        if (d.sellerCheckedIn) {
            // Buyer ghosted a present seller → deposit → seller, price (+surplus) → buyer.
            _settleForfeit(dealId, d, report);
        } else {
            // Seller never showed → full refund to buyer.
            uint256 amount = d.tokenAmount;
            d.state = State.Refunded;

            _payout(d.payToken, d.buyer, amount);

            _onSellerNoShow(d.buyer, d.seller);

            emit Refunded(dealId, amount);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Internal settlement helpers
    // ---------------------------------------------------------------------------------------

    /// @dev Shared "deposit → seller, price → buyer" forfeiture path. Pays the buyer the price
    ///      portion FIRST (shortfall-safe) and gives the seller the remainder up to the deposit
    ///      worth; any surplus over price+deposit returns to the buyer.
    function _settleForfeit(uint256 dealId, Deal storage d, bytes calldata report) internal {
        (uint256 priceUnits, uint256 depositUnits) = _settlementUnits(d, report);

        uint256 total = d.tokenAmount;

        // Buyer's price portion first (must be made whole on the item price).
        uint256 toBuyer = priceUnits;
        uint256 remaining = total - toBuyer; // shortfall-safe: priceUnits is capped at total

        // Seller gets up to the deposit worth out of what's left.
        uint256 toSeller = depositUnits <= remaining ? depositUnits : remaining;
        remaining -= toSeller;

        // Any surplus (token over-delivered value) goes back to the buyer.
        toBuyer += remaining;

        d.state = State.Forfeited;

        _payout(d.payToken, d.seller, toSeller);
        _payout(d.payToken, d.buyer, toBuyer);

        _onBuyerFlake(d.buyer, d.seller);

        emit Forfeited(dealId, toBuyer, toSeller);
    }

    /// @dev Computes the token units worth the item price and the deposit for this deal,
    ///      capping each at the held `tokenAmount` so callers can rely on shortfall-safety.
    ///      Stable token: exact units from priceUsd1e8 (no oracle). Volatile token: USD worth
    ///      priced via the verifier at call time, converted to token units at the token's decimals.
    function _settlementUnits(Deal storage d, bytes calldata report)
        internal
        returns (uint256 priceUnits, uint256 depositUnits)
    {
        if (d.payToken == stableToken) {
            priceUnits = _stablePriceUnits(d.priceUsd1e8);
            depositUnits = _stableDepositUnits(d.priceUsd1e8, d.depositBps);
        } else {
            uint256 price1e8 = _verifiedPriceUsd1e8(report);
            uint8 dec = IERC20Metadata(d.payToken).decimals();
            uint256 depositUsd1e8 = (d.priceUsd1e8 * d.depositBps) / BPS_DENOMINATOR;
            // tokenUnits = usdValue1e8 * 10^dec / price1e8
            priceUnits = (d.priceUsd1e8 * (10 ** dec)) / price1e8;
            depositUnits = (depositUsd1e8 * (10 ** dec)) / price1e8;
        }

        uint256 held = d.tokenAmount;
        // Shortfall-safe caps: never try to distribute more than is held; buyer's price first.
        if (priceUnits > held) priceUnits = held;
        uint256 left = held - priceUnits;
        if (depositUnits > left) depositUnits = left;
    }

    /// @dev USDC units for the item price: priceUsd1e8 / 100 (8-dec USD → 6-dec USDC).
    function _stablePriceUnits(uint256 priceUsd1e8) internal pure returns (uint256) {
        return priceUsd1e8 / 100;
    }

    /// @dev USDC units for the deposit: (priceUsd1e8 / 100) * depositBps / 10000.
    function _stableDepositUnits(uint256 priceUsd1e8, uint16 depositBps) internal pure returns (uint256) {
        return (_stablePriceUnits(priceUsd1e8) * depositBps) / BPS_DENOMINATOR;
    }

    /// @dev Verifies a Data Streams report through the proxy and decodes the USD price (1e8).
    ///      MOCK CONVENTION (shared with the datastreams package + MockVerifier): an empty report
    ///      (`0x`) yields ETH/USD = 4000e8. The verifier returns `abi.encode(int256 price1e8)`.
    function _verifiedPriceUsd1e8(bytes calldata report) internal returns (uint256) {
        if (verifierProxy == address(0)) revert VolatileNeedsVerifier();
        bytes memory verified = IVerifierProxy(verifierProxy).verify(report, "");
        int256 price = abi.decode(verified, (int256));
        if (price <= 0) revert InvalidPrice();
        return uint256(price);
    }

    /// @dev Single SafeERC20 payout point (skips zero-value transfers).
    function _payout(address token, address to, uint256 amount) internal {
        if (amount > 0) {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Reputation hooks (fire only when configured)
    // ---------------------------------------------------------------------------------------

    function _onCompleted(address buyer, address seller) internal {
        IReputation r = reputation;
        if (address(r) != address(0)) {
            r.onCompleted(buyer, seller);
        }
    }

    function _onBuyerFlake(address buyer, address seller) internal {
        IReputation r = reputation;
        if (address(r) != address(0)) {
            r.onBuyerFlake(buyer, seller);
        }
    }

    function _onSellerNoShow(address buyer, address seller) internal {
        IReputation r = reputation;
        if (address(r) != address(0)) {
            r.onSellerNoShow(buyer, seller);
        }
    }

    function _onMutualCancel(address buyer, address seller) internal {
        IReputation r = reputation;
        if (address(r) != address(0)) {
            r.onMutualCancel(buyer, seller);
        }
    }
}
