// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {RuleExecutor} from "../RuleExecutor.sol";

/**
 * TEST ONLY. Do not deploy to any network.
 *
 * These stand in for FXRP and a Firelight/Upshift vault in local tests. They
 * are a convenience, not evidence: a mock does exactly what you expect, which
 * is precisely why it cannot catch the bugs that matter. The tests that count
 * are the fork tests (`pnpm contracts:test:fork`) against real FXRP and the
 * real vaults on Coston2, where decimals, rounding and minimum deposits are
 * whatever they actually are rather than whatever we assumed.
 */
contract MockFXRP is ERC20 {
    uint8 private immutable _DECIMALS;

    constructor(uint8 decimals_) ERC20("Mock FXRP", "FXRP") {
        _DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// TEST ONLY. Plain ERC-4626, matching how Flare describes the Coston2 vault mocks.
contract MockVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Vault", "mVLT") ERC4626(asset_) {}
}

/**
 * TEST ONLY. Attempts to reenter RuleExecutor during `deposit`.
 *
 * Used to prove invariant I6. Two defences should stop it: the ReentrancyGuard
 * on `execute`, and the fact that `markExecuted` already advanced `nextRunAt`
 * before any external call, so the rule is no longer due.
 */
contract ReentrantVault is ERC4626 {
    RuleExecutor public executor;
    bytes32 public target;
    bool public attacked;

    constructor(IERC20 asset_) ERC20("Evil Vault", "EVIL") ERC4626(asset_) {}

    function arm(RuleExecutor executor_, bytes32 ruleId) external {
        executor = executor_;
        target = ruleId;
        attacked = false;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        if (address(executor) != address(0) && !attacked) {
            attacked = true;
            // Should revert. Swallowed so the outer deposit still completes and
            // the test can assert on the resulting state rather than a bubble.
            try executor.execute(target) {} catch {}
        }
        return super.deposit(assets, receiver);
    }
}
