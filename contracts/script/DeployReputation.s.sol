// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Reputation} from "../src/Reputation.sol";

/// @title DeployReputation
/// @notice Deploys {Reputation} with the broadcaster as owner.
/// @dev    The owner later calls `setEscrow(<escrow address>)` once the Escrow is deployed
///         (the Escrow address is unknown at Reputation deploy time). Optionally, if the
///         env var `ESCROW_ADDRESS` is set to a non-zero address at deploy time, this script
///         wires it immediately.
///
///         Run (local anvil):
///           forge script script/DeployReputation.s.sol:DeployReputation \
///             --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
contract DeployReputation is Script {
    function run() external returns (Reputation rep) {
        vm.startBroadcast();

        // Broadcaster (msg.sender of the broadcast) becomes the owner.
        address owner = msg.sender;
        rep = new Reputation(owner);
        console2.log("Reputation deployed at:", address(rep));
        console2.log("Reputation owner:", owner);

        // Optional: wire the Escrow now if its address is already known.
        address escrow = vm.envOr("ESCROW_ADDRESS", address(0));
        if (escrow != address(0)) {
            rep.setEscrow(escrow);
            console2.log("Escrow wired at:", escrow);
        } else {
            console2.log("Escrow not set; owner must call setEscrow(escrow) after Escrow deploy.");
        }

        vm.stopBroadcast();
    }
}
