// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReputation} from "../../src/IReputation.sol";

/// @notice Test double for IReputation. Records per-(buyer,seller) hook calls so tests can
///         assert the Escrow fires the correct hook on each terminal transition.
contract MockReputation is IReputation {
    mapping(bytes32 => uint256) internal _completed;
    mapping(bytes32 => uint256) internal _buyerFlake;
    mapping(bytes32 => uint256) internal _sellerNoShow;
    mapping(bytes32 => uint256) internal _mutualCancel;

    function _key(address buyer, address seller) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(buyer, seller));
    }

    function onCompleted(address buyer, address seller) external override {
        _completed[_key(buyer, seller)] += 1;
    }

    function onBuyerFlake(address buyer, address seller) external override {
        _buyerFlake[_key(buyer, seller)] += 1;
    }

    function onSellerNoShow(address buyer, address seller) external override {
        _sellerNoShow[_key(buyer, seller)] += 1;
    }

    function onMutualCancel(address buyer, address seller) external override {
        _mutualCancel[_key(buyer, seller)] += 1;
    }

    function completedCount(address buyer, address seller) external view returns (uint256) {
        return _completed[_key(buyer, seller)];
    }

    function buyerFlakeCount(address buyer, address seller) external view returns (uint256) {
        return _buyerFlake[_key(buyer, seller)];
    }

    function sellerNoShowCount(address buyer, address seller) external view returns (uint256) {
        return _sellerNoShow[_key(buyer, seller)];
    }

    function mutualCancelCount(address buyer, address seller) external view returns (uint256) {
        return _mutualCancel[_key(buyer, seller)];
    }
}
