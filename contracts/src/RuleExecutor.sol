// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {RuleRegistry} from "./RuleRegistry.sol";

/**
 * @title RuleExecutor
 * @notice The only GiroLedger contract that touches funds.
 *
 * Trust model, and the claim the README makes:
 *
 *   `execute` is PERMISSIONLESS. Anyone can trigger a due rule. The keeper we
 *   run has no special authority and holds no user funds. It is liveness
 *   critical, not safety critical. If it disappears, rules stop firing and
 *   nothing else happens.
 *
 * Safety comes from two places, neither of which the caller controls:
 *
 *   1. The ERC-20 allowance, granted once by the user's PersonalAccount at rule
 *      creation, inside the user operation dispatched from their XRPL payment.
 *      It caps lifetime spend at exactly `totalSpendCap`.
 *   2. The rule parameters in RuleRegistry: interval, cap, run count, vault.
 *
 * Vault shares are always minted to `rule.account`. This contract is a conduit
 * and holds a zero balance between transactions.
 */
contract RuleExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------- immutable --

    RuleRegistry public immutable REGISTRY;
    /// @notice FXRP. The only asset rules operate on.
    IERC20 public immutable ASSET;

    uint256 public constant MAX_BATCH = 50;

    /**
     * @notice Gas handed to each inner execution, and the reason this contract
     *         does not simply let the caller's gas limit decide.
     *
     * `executeBatch` catches individual failures so one bad rule cannot block
     * the batch. That is the feature. The cost is that the OUTER call succeeds
     * even when an INNER call runs out of gas, which blinds `eth_estimateGas`:
     * it binary-searches for the cheapest gas at which the transaction does not
     * revert, finds a figure that starves the inner call, observes no top-level
     * revert, and returns it. Every rule is then skipped, forever, silently.
     *
     * This is not hypothetical. On Coston2 a real execution cost 316,021 gas,
     * the estimator returned 316,693, and the batch still executed nothing for
     * thirty-two minutes: under EIP-150 the parent retains 1/64 of its gas, so
     * the inner call received only ~311k of that 316k.
     *
     * The `gasleft()` check below is the fix. It gives the estimator a
     * top-level revert to find, so the binary search is forced upwards.
     */
    uint256 public constant GAS_PER_RULE = 600_000;

    /// @dev Covers the 1/64 retained by EIP-150 plus the tail of this function.
    uint256 public constant GAS_RESERVE = 40_000;

    // ------------------------------------------------------------ storage --

    bool public paused;

    // ------------------------------------------------------------- events --

    event Deposited(
        bytes32 indexed ruleId,
        address indexed account,
        address indexed vault,
        uint128 amount,
        uint256 shares
    );
    /**
     * @param reason The revert selector of the inner call, or `0x00000000` if
     *        it returned no data. Empty almost always means out of gas, which
     *        is a keeper misconfiguration rather than a problem with the rule.
     *        Emitting it makes a skipped rule diagnosable from logs alone.
     */
    event ExecutionSkipped(bytes32 indexed ruleId, bytes4 reason);
    event PausedSet(bool paused);

    // ------------------------------------------------------------- errors --

    error IsPaused();
    error NotSelf();
    error BatchTooLarge();
    error NothingDue();
    error ResidualBalance();
    error InsufficientGas(uint256 available, uint256 required);

    // -------------------------------------------------------- constructor --

    constructor(RuleRegistry registry, IERC20 asset, address initialOwner) Ownable(initialOwner) {
        if (address(registry) == address(0) || address(asset) == address(0)) {
            revert NothingDue();
        }
        REGISTRY = registry;
        ASSET = asset;
    }

    // ---------------------------------------------------------- modifiers --

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // -------------------------------------------------------------- admin --

    /**
     * @notice Hackathon safety valve. Disclosed as a centralisation caveat in
     *         the README. Would be timelocked or removed for production.
     */
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    // ----------------------------------------------------------- external --

    /// @notice Execute one due rule. Anyone may call this.
    function execute(bytes32 ruleId) external nonReentrant whenNotPaused {
        _execute(ruleId);
    }

    /**
     * @notice Execute several due rules. Individual failures are skipped, not
     *         reverted, so one bad rule cannot block the whole batch.
     */
    function executeBatch(bytes32[] calldata ruleIds)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 succeeded)
    {
        uint256 n = ruleIds.length;
        if (n == 0 || n > MAX_BATCH) revert BatchTooLarge();

        for (uint256 i; i < n; ++i) {
            // Refuse to attempt a rule we cannot fund. This revert is the only
            // signal `eth_estimateGas` gets, and without it the estimator
            // silently under-funds every inner call. See GAS_PER_RULE.
            uint256 available = gasleft();
            if (available < GAS_PER_RULE + GAS_RESERVE) {
                revert InsufficientGas(available, GAS_PER_RULE + GAS_RESERVE);
            }

            // Self-call so a single failure can be caught. `executeOne` is
            // gated to this contract, and is not nonReentrant, so the guard on
            // executeBatch still blocks genuine reentry from a vault or token.
            //
            // The explicit gas cap makes each attempt cost a bounded, knowable
            // amount rather than "whatever is left", which is what made the
            // starved case converge on a plausible-looking estimate.
            try this.executeOne{gas: GAS_PER_RULE}(ruleIds[i]) {
                unchecked {
                    ++succeeded;
                }
            } catch (bytes memory reason) {
                emit ExecutionSkipped(ruleIds[i], _selectorOf(reason));
            }
        }
    }

    /// @dev Internal step of `executeBatch`, external only so it can be try/caught.
    function executeOne(bytes32 ruleId) external {
        if (msg.sender != address(this)) revert NotSelf();
        _execute(ruleId);
    }

    // ----------------------------------------------------------- internal --

    /// @dev First four bytes of revert data, or zero if there was none.
    function _selectorOf(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length >= 4) {
            // Loads 32 bytes; assigning to bytes4 keeps the leading four.
            assembly ("memory-safe") {
                selector := mload(add(reason, 0x20))
            }
        }
    }

    function _execute(bytes32 ruleId) internal {
        RuleRegistry.Rule memory r = REGISTRY.getRule(ruleId);
        uint128 amount = r.amountPerRun;

        // EFFECTS FIRST. markExecuted re-checks that the rule is active, due
        // and within cap, and reverts otherwise. Advancing state before any
        // external call means a reentrant path fails its due check.
        REGISTRY.markExecuted(ruleId, amount);

        // INTERACTIONS.
        ASSET.safeTransferFrom(r.account, address(this), amount);
        ASSET.forceApprove(r.vault, amount);

        // `receiver` is the user's own account. Shares never touch this contract.
        uint256 shares = IERC4626(r.vault).deposit(amount, r.account);

        // Invariant I5: no residue is left behind between transactions.
        if (ASSET.balanceOf(address(this)) != 0) revert ResidualBalance();

        emit Deposited(ruleId, r.account, r.vault, amount, shares);
    }
}
