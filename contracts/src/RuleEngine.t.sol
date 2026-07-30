// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RuleRegistry} from "./RuleRegistry.sol";
import {RuleExecutor} from "./RuleExecutor.sol";
import {MockFXRP, MockVault, ReentrantVault} from "./mocks/Mocks.sol";

/**
 * Invariants I1 to I6 from spec.md §5.2.
 *
 * `account` stands in for a Flare Smart Accounts PersonalAccount. In production
 * it is CREATE2-derived from an XRPL address and calls `createRule` inside the
 * user operation dispatched from a single XRPL payment. Here it is a plain
 * address we prank, because the authorisation path is Flare's concern and the
 * accounting is ours.
 */
contract RuleEngineTest is Test {
    RuleRegistry internal registry;
    RuleExecutor internal executor;
    MockFXRP internal fxrp;
    MockVault internal vault;

    address internal owner = makeAddr("owner");
    address internal account = makeAddr("personalAccount");
    address internal stranger = makeAddr("stranger");
    address internal keeper = makeAddr("keeper");

    uint128 internal constant PER_RUN = 10e6; // FXRP is 6 decimals
    uint128 internal constant CAP = 50e6; // exactly 5 runs
    uint32 internal constant INTERVAL = 1 hours;

    function setUp() public {
        fxrp = new MockFXRP(6);
        vault = new MockVault(IERC20(address(fxrp)));

        registry = new RuleRegistry(owner);
        executor = new RuleExecutor(registry, IERC20(address(fxrp)), owner);

        vm.startPrank(owner);
        registry.setExecutor(address(executor));
        registry.setVaultAllowed(address(vault), true);
        vm.stopPrank();

        fxrp.mint(account, 1_000e6);
    }

    // ------------------------------------------------------------ helpers --

    function _params(address vault_, uint128 perRun, uint128 cap, uint16 maxRuns)
        internal
        pure
        returns (RuleRegistry.CreateRuleParams memory)
    {
        return RuleRegistry.CreateRuleParams({
            vault: vault_,
            amountPerRun: perRun,
            totalSpendCap: cap,
            intervalSecs: INTERVAL,
            maxRuns: maxRuns,
            trigger: uint8(RuleRegistry.Trigger.TIME),
            startAt: 0,
            thresholdPrice: 0
        });
    }

    /// Mirrors the real flow: approve the executor for exactly the cap, then create.
    function _createRule(uint128 perRun, uint128 cap, uint16 maxRuns)
        internal
        returns (bytes32 ruleId)
    {
        vm.startPrank(account);
        fxrp.approve(address(executor), cap);
        ruleId = registry.createRule(_params(address(vault), perRun, cap, maxRuns));
        vm.stopPrank();
    }

    function _defaultRule() internal returns (bytes32) {
        return _createRule(PER_RUN, CAP, 0);
    }

    // ------------------------------------------------------------- basics --

    function test_createRule() public {
        bytes32 id = _defaultRule();
        RuleRegistry.Rule memory r = registry.getRule(id);

        assertEq(r.account, account);
        assertEq(r.vault, address(vault));
        assertEq(r.amountPerRun, PER_RUN);
        assertEq(r.totalSpendCap, CAP);
        assertTrue(r.active);
        assertTrue(registry.isDue(id), "startAt=0 means due immediately");
    }

    function test_createRule_rejectsUnknownVault() public {
        vm.prank(account);
        vm.expectRevert(RuleRegistry.VaultNotAllowed.selector);
        registry.createRule(_params(makeAddr("rogueVault"), PER_RUN, CAP, 0));
    }

    function test_createRule_rejectsCapBelowPerRun() public {
        vm.prank(account);
        vm.expectRevert(RuleRegistry.CapExceeded.selector);
        registry.createRule(_params(address(vault), 10e6, 9e6, 0));
    }

    function test_createRule_rejectsPriceTriggerForNow() public {
        RuleRegistry.CreateRuleParams memory p = _params(address(vault), PER_RUN, CAP, 0);
        p.trigger = uint8(RuleRegistry.Trigger.PRICE_BELOW);

        vm.prank(account);
        vm.expectRevert(RuleRegistry.TriggerNotEnabled.selector);
        registry.createRule(p);
    }

    function test_createRule_rejectsOutOfRangeInterval() public {
        RuleRegistry.CreateRuleParams memory p = _params(address(vault), PER_RUN, CAP, 0);
        p.intervalSecs = 30;

        vm.prank(account);
        vm.expectRevert(RuleRegistry.InvalidParams.selector);
        registry.createRule(p);
    }

    function test_execute_isPermissionless() public {
        bytes32 id = _defaultRule();

        vm.prank(stranger); // not the keeper, not the owner, not the account
        executor.execute(id);

        assertEq(registry.getRule(id).runsDone, 1);
    }

    // ------------------------------- I1: spend never exceeds the cap ------

    function test_I1_totalSpentNeverExceedsCap() public {
        bytes32 id = _defaultRule();

        for (uint256 i; i < 5; ++i) {
            vm.prank(keeper);
            executor.execute(id);
            vm.warp(block.timestamp + INTERVAL);
        }

        RuleRegistry.Rule memory r = registry.getRule(id);
        assertEq(r.totalSpent, CAP, "cap consumed exactly");
        assertEq(r.runsDone, 5);
        assertFalse(r.active, "rule auto-closes when the cap is exhausted");

        vm.prank(keeper);
        vm.expectRevert();
        executor.execute(id);
    }

    function test_I1_allowanceAloneBoundsSpend() public {
        // Even if the registry were wrong, the ERC-20 allowance is a hard ceiling.
        bytes32 id = _createRule(PER_RUN, CAP, 0);
        assertEq(fxrp.allowance(account, address(executor)), CAP);

        for (uint256 i; i < 5; ++i) {
            vm.prank(keeper);
            executor.execute(id);
            vm.warp(block.timestamp + INTERVAL);
        }
        assertEq(fxrp.allowance(account, address(executor)), 0, "allowance fully consumed");
    }

    // ---------------------- I2: shares go to the user, never the executor --

    function test_I2_sharesMintToAccountNotExecutor() public {
        bytes32 id = _defaultRule();

        vm.prank(keeper);
        executor.execute(id);

        assertGt(vault.balanceOf(account), 0, "user holds the shares");
        assertEq(vault.balanceOf(address(executor)), 0, "executor holds none");
        assertEq(vault.balanceOf(keeper), 0, "keeper holds none");
    }

    // ------------------------- I3: cannot execute twice inside an interval --

    function test_I3_cannotExecuteTwiceWithinInterval() public {
        bytes32 id = _defaultRule();

        vm.prank(keeper);
        executor.execute(id);

        assertFalse(registry.isDue(id));
        vm.prank(keeper);
        vm.expectRevert(RuleRegistry.RuleNotDue.selector);
        executor.execute(id);

        vm.warp(block.timestamp + INTERVAL);
        assertTrue(registry.isDue(id));
    }

    function test_I3_dueExactlyOnBoundary() public {
        bytes32 id = _defaultRule();
        vm.prank(keeper);
        executor.execute(id);

        vm.warp(block.timestamp + INTERVAL - 1);
        assertFalse(registry.isDue(id));

        vm.warp(block.timestamp + 1);
        assertTrue(registry.isDue(id));
    }

    // --------------- I4: inactive, cancelled or exhausted rules revert ----

    function test_I4_cancelledRuleCannotExecute() public {
        bytes32 id = _defaultRule();

        vm.prank(account);
        registry.cancelRule(id);

        assertFalse(registry.isDue(id));
        vm.prank(keeper);
        vm.expectRevert(RuleRegistry.RuleNotActive.selector);
        executor.execute(id);
    }

    function test_I4_cancelIsIdempotent() public {
        bytes32 id = _defaultRule();
        vm.startPrank(account);
        registry.cancelRule(id);
        registry.cancelRule(id); // must not revert
        vm.stopPrank();
        assertFalse(registry.getRule(id).active);
    }

    function test_I4_onlyOwnerCanCancel() public {
        bytes32 id = _defaultRule();
        vm.prank(stranger);
        vm.expectRevert(RuleRegistry.NotAccount.selector);
        registry.cancelRule(id);
    }

    function test_I4_maxRunsExhausts() public {
        bytes32 id = _createRule(PER_RUN, CAP, 2);

        vm.prank(keeper);
        executor.execute(id);
        vm.warp(block.timestamp + INTERVAL);
        vm.prank(keeper);
        executor.execute(id);

        RuleRegistry.Rule memory r = registry.getRule(id);
        assertEq(r.runsDone, 2);
        assertFalse(r.active, "closed after maxRuns even though cap remains");
        assertLt(r.totalSpent, r.totalSpendCap);
    }

    function test_I4_unknownRuleReverts() public {
        vm.prank(keeper);
        vm.expectRevert(RuleRegistry.UnknownRule.selector);
        executor.execute(keccak256("nope"));
    }

    // ---------------------- I5: executor holds no balance between txs -----

    function test_I5_executorHoldsNoResidue() public {
        bytes32 id = _defaultRule();
        assertEq(fxrp.balanceOf(address(executor)), 0);

        vm.prank(keeper);
        executor.execute(id);

        assertEq(fxrp.balanceOf(address(executor)), 0, "conduit, not a custodian");
    }

    // ---------------------------------- I6: reentrancy cannot double spend --

    function test_I6_reentrantVaultCannotDoubleSpend() public {
        ReentrantVault evil = new ReentrantVault(IERC20(address(fxrp)));
        vm.prank(owner);
        registry.setVaultAllowed(address(evil), true);

        vm.startPrank(account);
        fxrp.approve(address(executor), CAP);
        bytes32 id = registry.createRule(_params(address(evil), PER_RUN, CAP, 0));
        vm.stopPrank();

        evil.arm(executor, id);

        vm.prank(keeper);
        executor.execute(id);

        assertTrue(evil.attacked(), "the vault did try to reenter");

        RuleRegistry.Rule memory r = registry.getRule(id);
        assertEq(r.runsDone, 1, "reentry must not produce a second run");
        assertEq(r.totalSpent, PER_RUN, "reentry must not spend twice");
    }

    // ------------------------------------------------------------- batch --

    function test_batchSkipsFailuresInsteadOfReverting() public {
        bytes32 good = _defaultRule();

        vm.startPrank(account);
        bytes32 cancelled = registry.createRule(_params(address(vault), PER_RUN, CAP, 0));
        registry.cancelRule(cancelled);
        vm.stopPrank();

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cancelled;
        ids[1] = good;

        vm.prank(keeper);
        uint256 ok = executor.executeBatch(ids);

        assertEq(ok, 1, "one succeeded, one skipped");
        assertEq(registry.getRule(good).runsDone, 1);
    }

    /**
     * The regression that cost thirty-two minutes of live keeper time.
     *
     * A batch given too little gas MUST revert at the top level. If it instead
     * returns 0, `eth_estimateGas` sees a successful transaction, accepts the
     * starved figure, and every batch thereafter executes nothing while
     * reporting success. On Coston2 the estimator returned 316,693 gas for a
     * call that needs 316,021, and it still starved the inner call, because
     * EIP-150 leaves the child only 63/64 of what the parent holds.
     */
    function test_batchRevertsRatherThanSilentlyStarvingTheInnerCall() public {
        bytes32 id = _defaultRule();

        uint256 tooLittle = executor.GAS_PER_RULE(); // no room for GAS_RESERVE

        vm.prank(keeper);
        (bool ok,) = address(executor).call{gas: tooLittle}(
            abi.encodeCall(RuleExecutor.executeBatch, (_ids(id)))
        );

        assertFalse(ok, "starved batch must revert, never return 0 successes");
        assertEq(registry.getRule(id).runsDone, 0, "and must not have executed");
    }

    /// The same batch with an honest gas budget goes through.
    function test_batchSucceedsWithAdequateGas() public {
        bytes32 id = _defaultRule();

        vm.prank(keeper);
        (bool ok, bytes memory ret) = address(executor).call{
            gas: executor.GAS_PER_RULE() + executor.GAS_RESERVE() + 200_000
        }(abi.encodeCall(RuleExecutor.executeBatch, (_ids(id))));

        assertTrue(ok, "adequately funded batch must not revert");
        assertEq(abi.decode(ret, (uint256)), 1, "one rule executed");
        assertEq(registry.getRule(id).runsDone, 1);
    }

    /// A skipped rule must say why, so a keeper can act on logs alone.
    function test_skippedRuleReportsItsRevertSelector() public {
        vm.startPrank(account);
        bytes32 cancelled = registry.createRule(_params(address(vault), PER_RUN, CAP, 0));
        registry.cancelRule(cancelled);
        vm.stopPrank();

        vm.expectEmit(true, false, false, true, address(executor));
        emit RuleExecutor.ExecutionSkipped(cancelled, RuleRegistry.RuleNotActive.selector);

        vm.prank(keeper);
        executor.executeBatch(_ids(cancelled));
    }

    function _ids(bytes32 id) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = id;
    }

    function test_batchRejectsOversizedInput() public {
        bytes32[] memory ids = new bytes32[](executor.MAX_BATCH() + 1);
        vm.expectRevert(RuleExecutor.BatchTooLarge.selector);
        executor.executeBatch(ids);
    }

    // ------------------------------------------------------- due paging --

    function test_dueRulesIsPaginatedAndBounded() public {
        for (uint256 i; i < 5; ++i) {
            _createRule(PER_RUN, CAP, 0);
        }

        (bytes32[] memory ids, uint256 next) = registry.dueRules(0, 3);
        assertEq(ids.length, 3);
        assertEq(next, 3);

        (ids, next) = registry.dueRules(next, 3);
        assertEq(ids.length, 2);
        assertEq(next, 5);

        (ids, next) = registry.dueRules(next, 3);
        assertEq(ids.length, 0, "past the end returns empty");
    }

    function test_dueRulesRejectsUnboundedPage() public {
        // Read MAX_PAGE first. vm.expectRevert applies to the very next call,
        // and an inline registry.MAX_PAGE() would consume it.
        uint256 tooBig = registry.MAX_PAGE() + 1;

        vm.expectRevert(RuleRegistry.PageTooLarge.selector);
        registry.dueRules(0, tooBig);

        vm.expectRevert(RuleRegistry.PageTooLarge.selector);
        registry.dueRules(0, 0);
    }

    function test_dueRulesExcludesNotYetDue() public {
        _defaultRule();
        (bytes32[] memory ids,) = registry.dueRules(0, 10);
        assertEq(ids.length, 1);

        vm.prank(keeper);
        executor.execute(ids[0]);

        (ids,) = registry.dueRules(0, 10);
        assertEq(ids.length, 0, "not due again until the interval elapses");
    }

    // --------------------------------------------------------- pause ----

    function test_pauseBlocksExecution() public {
        bytes32 id = _defaultRule();

        vm.prank(owner);
        executor.setPaused(true);

        vm.prank(keeper);
        vm.expectRevert(RuleExecutor.IsPaused.selector);
        executor.execute(id);

        vm.prank(owner);
        executor.setPaused(false);
        vm.prank(keeper);
        executor.execute(id);
        assertEq(registry.getRule(id).runsDone, 1);
    }

    function test_onlyExecutorCanMarkExecuted() public {
        bytes32 id = _defaultRule();
        vm.prank(stranger);
        vm.expectRevert(RuleRegistry.NotExecutor.selector);
        registry.markExecuted(id, PER_RUN);
    }

    // ---------------------------------------------------------- fuzzing --

    function testFuzz_I1_spendNeverExceedsCap(uint128 perRun, uint8 runs) public {
        perRun = uint128(bound(perRun, 1e6, 20e6));
        uint16 maxRuns = uint16(bound(runs, 1, 10));
        uint128 cap = perRun * maxRuns;

        fxrp.mint(account, uint256(cap));
        bytes32 id = _createRule(perRun, cap, maxRuns);

        for (uint256 i; i < maxRuns; ++i) {
            vm.prank(keeper);
            executor.execute(id);
            vm.warp(block.timestamp + INTERVAL);
        }

        RuleRegistry.Rule memory r = registry.getRule(id);
        assertLe(r.totalSpent, r.totalSpendCap, "I1 holds for every shape of rule");
        assertEq(fxrp.balanceOf(address(executor)), 0, "I5 holds too");
    }
}
