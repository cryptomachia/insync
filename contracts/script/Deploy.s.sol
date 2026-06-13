// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {Escrow} from "../src/Escrow.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockVerifier} from "../test/mocks/MockVerifier.sol";

/// @notice Deploys the Handoff Escrow stack.
///
/// Local / mock mode (default): deploys a 6-decimal MockERC20 (USDC stand-in) + a MockVerifier,
/// then Escrow(stable=USDC, verifier=MockVerifier, reputation=0). Run against anvil:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
///
/// Live mode: set USDC_ADDRESS (and optionally VERIFIER_PROXY_ADDRESS / REPUTATION_ADDRESS) in
/// env to reuse real deployed addresses instead of deploying mocks. A MockVerifier is only
/// deployed if no VERIFIER_PROXY_ADDRESS is provided AND USE_MOCK_VERIFIER is true.
contract Deploy is Script {
    function run() external returns (address escrow, address usdc, address verifier, address reputation) {
        vm.startBroadcast();

        // --- USDC (stable token) ---
        usdc = _envAddress("USDC_ADDRESS");
        if (usdc == address(0)) {
            MockERC20 mockUsdc = new MockERC20("Mock USD Coin", "USDC", 6);
            usdc = address(mockUsdc);
            console2.log("Deployed MockERC20 (USDC, 6 decimals):", usdc);
            // Seed the deployer + the first standard anvil accounts so the mock/demo
            // wallet (and the e2e) can fund deals out of the box.
            uint256 seed = 1_000_000 * 1e6; // 1,000,000 USDC
            mockUsdc.mint(msg.sender, seed);
            mockUsdc.mint(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, seed); // anvil #0
            mockUsdc.mint(0x70997970C51812dc3A010C7d01b50e0d17dc79C8, seed); // anvil #1
            mockUsdc.mint(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, seed); // anvil #2
        } else {
            console2.log("Using existing USDC:", usdc);
        }

        // --- Verifier proxy (Data Streams) ---
        verifier = _envAddress("VERIFIER_PROXY_ADDRESS");
        if (verifier == address(0)) {
            // Default to a MockVerifier so volatile deals work locally without live keys.
            // Set USE_MOCK_VERIFIER=false to deploy with no verifier (stable-only Escrow).
            bool useMock = _envBoolOrDefault("USE_MOCK_VERIFIER", true);
            if (useMock) {
                MockVerifier mockVerifier = new MockVerifier();
                verifier = address(mockVerifier);
                console2.log("Deployed MockVerifier:", verifier);
            } else {
                console2.log("No verifier configured (stable-only Escrow).");
            }
        } else {
            console2.log("Using existing VerifierProxy:", verifier);
        }

        // --- Reputation (optional; owned by AGENT 2, address(0) by default) ---
        reputation = _envAddress("REPUTATION_ADDRESS");
        if (reputation != address(0)) {
            console2.log("Using existing Reputation:", reputation);
        }

        // --- Escrow ---
        Escrow escrowContract = new Escrow(usdc, verifier, reputation);
        escrow = address(escrowContract);
        console2.log("Deployed Escrow:", escrow);

        vm.stopBroadcast();

        console2.log("----------------------------------------");
        console2.log("ESCROW_ADDRESS=", escrow);
        console2.log("USDC_ADDRESS=", usdc);
        console2.log("VERIFIER_PROXY_ADDRESS=", verifier);
        console2.log("REPUTATION_ADDRESS=", reputation);
        console2.log("----------------------------------------");
    }

    function _envAddress(string memory key) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a;
        } catch {
            return address(0);
        }
    }

    function _envBoolOrDefault(string memory key, bool dflt) internal view returns (bool) {
        try vm.envBool(key) returns (bool b) {
            return b;
        } catch {
            return dflt;
        }
    }
}
