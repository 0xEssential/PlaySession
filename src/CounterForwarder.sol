// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@0xessential/contracts/fwd/EssentialForwarder.sol";

contract CounterForwarder is EssentialForwarder {
    constructor(string memory name, string[] memory _urls) EssentialForwarder(name, _urls) {}
}
