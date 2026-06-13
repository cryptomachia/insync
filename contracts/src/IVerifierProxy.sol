// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink Data Streams Verifier proxy interface used by the Escrow.
/// @dev The real Chainlink `IVerifierProxy.verify` returns the ABI-encoded report. Here we
/// only need the verified report payload so the Escrow can decode the median price out of it.
/// The MockVerifier (test/mocks) mirrors this and, by convention shared with the
/// datastreams package (`packages/datastreams`), returns ETH/USD = 4000e8 when the report is
/// empty (`0x`).
interface IVerifierProxy {
    /// @param payload  the signed Data Streams report blob (the `report` arg of Escrow fns).
    /// @return verifierResponse the verified report payload (ABI-encoded report struct/data).
    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory verifierResponse);
}
