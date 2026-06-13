// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice FROZEN interface (SPEC §3). Escrow (AGENT 1) calls these on terminal transitions
/// when a reputation contract is configured; Reputation (AGENT 2) implements them with an
/// onlyEscrow guard. Do not change the signatures.
interface IReputation {
    function onCompleted(address buyer, address seller) external;
    function onBuyerFlake(address buyer, address seller) external; // buyer cancelled, deposit forfeited
    function onSellerNoShow(address buyer, address seller) external; // refunded, seller absent
    function onMutualCancel(address buyer, address seller) external;
}
