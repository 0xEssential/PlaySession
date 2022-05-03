//SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@0xessential/contracts/fwd/EssentialPlaySession.sol";

contract CounterPlaysession is EssentialPlaySession {
    constructor(address trustedForwarder) EssentialPlaySession(trustedForwarder) {}
}
