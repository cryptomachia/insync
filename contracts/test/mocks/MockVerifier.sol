// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifierProxy} from "../../src/IVerifierProxy.sol";

/// @notice Mock Chainlink Data Streams Verifier proxy for tests and local anvil.
/// @dev CONVENTION shared with the datastreams package (`packages/datastreams`) and the Escrow:
///      - An EMPTY report (`0x`) verifies to ETH/USD = 4000e8 (the package's mock price).
///      - A NON-EMPTY report is treated as `abi.encode(int256 priceUsd1e8)` so tests can
///        simulate arbitrary prices (e.g. a token crash) for the volatility shortfall edge.
///      The returned `verifierResponse` is `abi.encode(int256 priceUsd1e8)`, matching what
///      `Escrow._verifiedPriceUsd1e8` decodes.
contract MockVerifier is IVerifierProxy {
    int256 public constant DEFAULT_ETH_USD_1E8 = 4000e8;

    function verify(bytes calldata payload, bytes calldata /* parameterPayload */)
        external
        payable
        override
        returns (bytes memory verifierResponse)
    {
        int256 price;
        if (payload.length == 0) {
            price = DEFAULT_ETH_USD_1E8;
        } else {
            price = abi.decode(payload, (int256));
        }
        return abi.encode(price);
    }

    /// @notice Helper for callers/tests to build a non-empty report blob for a given price.
    function encodeReport(int256 priceUsd1e8) external pure returns (bytes memory) {
        return abi.encode(priceUsd1e8);
    }
}
