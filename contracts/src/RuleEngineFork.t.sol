// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {RuleRegistry} from "./RuleRegistry.sol";
import {RuleExecutor} from "./RuleExecutor.sol";

/**
 * Fork tests: the same engine, against REAL Coston2 state.
 *
 *   pnpm contracts:test:fork
 *
 * The unit tests in RuleEngine.t.sol prove the accounting is internally
 * consistent. They cannot prove anything about reality, because the mock vault
 * behaves exactly as we assumed it would. These tests are where the assumptions
 * meet the actual FXRP and the actual Firelight/Upshift vault: real decimals,
 * real share rounding, real minimum deposits.
 *
 * The addresses below are the real Coston2 deployments, confirmed by a live
 * chain read on 27 July 2026 and recorded in spec.md §12.5. They are defaults
 * so the suite just runs. Override with FXRP_ADDRESS and VAULT_ADDRESS if
 * Flare redeploys, and re-run the spike:resolve script in apps/operator to get
 * the new values.
 */
contract RuleEngineForkTest is Test {
    RuleRegistry internal registry;
    RuleExecutor internal executor;

    IERC20 internal fxrp;
    IERC4626 internal vault;

    address internal owner = makeAddr("owner");
    address internal account = makeAddr("personalAccount");
    address internal keeper = makeAddr("keeper");

    uint8 internal fxrpDecimals;
    uint128 internal perRun;
    uint128 internal cap;
    uint32 internal constant INTERVAL = 1 hours;

    bool internal configured;
    bool internal funded;

    /// FXRP on Coston2. Symbol FTestXRP, 6 decimals. Confirmed 27 July 2026.
    address internal constant DEFAULT_FXRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    /// Firelight vault, id 1, from MasterAccountController.getVaults().
    address internal constant DEFAULT_VAULT = 0xF97B2bBdB2f4a561806e5038a503eCA81554634E;

    function setUp() public {
        address fxrpAddr = vm.envOr("FXRP_ADDRESS", DEFAULT_FXRP);
        address vaultAddr = vm.envOr("VAULT_ADDRESS", DEFAULT_VAULT);

        // The real question is not "was an address supplied" but "does that
        // address have code on the chain we are running against". On the plain
        // local EDR chain these contracts do not exist, so we skip. On a fork
        // they do, so we run. That makes `pnpm contracts:test` and
        // `pnpm contracts:test:fork` both correct with no configuration.
        configured = _hasCode(fxrpAddr) && _hasCode(vaultAddr);
        if (!configured) return;

        fxrp = IERC20(fxrpAddr);
        vault = IERC4626(vaultAddr);

        // Read the decimals rather than assuming them. Assuming 18 here is the
        // single most likely way to ship a broken amount to the demo.
        fxrpDecimals = IERC20Metadata(fxrpAddr).decimals();
        perRun = uint128(10 ** uint256(fxrpDecimals)); // 1 FXRP
        cap = perRun * 5;

        registry = new RuleRegistry(owner);
        executor = new RuleExecutor(registry, fxrp, owner);

        vm.startPrank(owner);
        registry.setExecutor(address(executor));
        registry.setVaultAllowed(vaultAddr, true);
        vm.stopPrank();

        // Fund the test account by moving REAL FXRP from a real holder.
        //
        // Do not use forge-std `deal` here. It probes for the storage slot that
        // makes `balanceOf` return the value you asked for, and writes that.
        // Flare's FAsset tokens keep checkpointed balance history for
        // delegation and vote power, so `deal` patches the slot `balanceOf`
        // reads while the internal history still says zero. The next transfer
        // subtracts from zero and panics with an arithmetic underflow that
        // points at nothing useful. Verified against Coston2 on 27 July 2026.
        //
        // An actual transfer keeps every internal structure consistent.
        address holder = vm.envOr("FXRP_HOLDER", address(0));
        if (holder != address(0) && fxrp.balanceOf(holder) >= uint256(cap) * 2) {
            vm.prank(holder);
            // Note: FAssets may levy a transfer fee, so the amount that lands
            // can be slightly less than sent. The check below allows for that.
            fxrp.transfer(account, uint256(cap) * 2);
            funded = fxrp.balanceOf(account) >= cap;
        }

        if (!funded) return;

        vm.startPrank(account);
        fxrp.approve(address(executor), cap);
        vm.stopPrank();
    }

    function _hasCode(address a) private view returns (bool) {
        if (a == address(0)) return false;
        uint256 size;
        assembly {
            size := extcodesize(a)
        }
        return size > 0;
    }

    modifier onlyForked() {
        if (!configured) {
            emit log("SKIPPED: not running against a fork. Use: pnpm contracts:test:fork");
            return;
        }
        _;
    }

    /// For tests that need the account to actually hold FXRP.
    modifier onlyFunded() {
        if (!configured) {
            emit log("SKIPPED: not running against a fork. Use: pnpm contracts:test:fork");
            return;
        }
        if (!funded) {
            emit log(
                "SKIPPED: no funded FXRP holder. Get FXRP from the Coston2 faucet, then:\n"
                "  export FXRP_HOLDER=0xYourFundedAddress\n"
                "  pnpm contracts:test:fork\n"
                "deal() cannot be used here: FAsset balances are checkpointed, so a patched "
                "slot makes balanceOf lie and the next transfer underflows."
            );
            return;
        }
        _;
    }

    function _create() internal returns (bytes32) {
        vm.prank(account);
        return registry.createRule(
            RuleRegistry.CreateRuleParams({
                vault: address(vault),
                amountPerRun: perRun,
                totalSpendCap: cap,
                intervalSecs: INTERVAL,
                maxRuns: 5,
                trigger: uint8(RuleRegistry.Trigger.TIME),
                startAt: 0,
                thresholdPrice: 0
            })
        );
    }

    /// The vault must actually accept the asset our rules move.
    function test_fork_vaultAssetIsFxrp() public onlyForked {
        assertEq(vault.asset(), address(fxrp), "vault asset must be FXRP");
    }

    /// Documents the real decimals so a wrong assumption fails here, loudly.
    function test_fork_decimalsAreWhatWeThink() public onlyForked {
        emit log_named_uint("FXRP decimals", fxrpDecimals);
        assertLe(fxrpDecimals, 18);
        assertGt(fxrpDecimals, 0);
    }

    /// A one-unit deposit must mint non-zero shares, or the minimum is too low.
    function test_fork_depositMintsNonZeroShares() public onlyForked {
        uint256 preview = vault.previewDeposit(perRun);
        emit log_named_uint("shares for one FXRP", preview);
        assertGt(preview, 0, "amountPerRun rounds to zero shares: raise it");
    }

    /// The whole loop, against the real vault.
    function test_fork_executeAgainstRealVault() public onlyFunded {
        bytes32 id = _create();

        uint256 sharesBefore = vault.balanceOf(account);
        uint256 fxrpBefore = fxrp.balanceOf(account);
        assertGe(fxrpBefore, perRun, "account must hold at least one run's worth");

        vm.prank(keeper);
        executor.execute(id);

        assertGt(vault.balanceOf(account), sharesBefore, "user gained vault shares");
        assertEq(fxrpBefore - fxrp.balanceOf(account), perRun, "exactly amountPerRun moved");
        assertEq(vault.balanceOf(address(executor)), 0, "I2 holds on the real vault");
        assertEq(fxrp.balanceOf(address(executor)), 0, "I5 holds on the real vault");
        assertEq(registry.getRule(id).runsDone, 1);
    }

    /// Repeated runs must not drift, which is where real rounding shows up.
    function test_fork_repeatedRunsRespectCap() public onlyFunded {
        bytes32 id = _create();

        for (uint256 i; i < 5; ++i) {
            vm.prank(keeper);
            executor.execute(id);
            vm.warp(block.timestamp + INTERVAL);
        }

        RuleRegistry.Rule memory r = registry.getRule(id);
        assertEq(r.totalSpent, cap, "I1 holds against real state");
        assertFalse(r.active);
        assertEq(fxrp.allowance(account, address(executor)), 0);
    }
}
